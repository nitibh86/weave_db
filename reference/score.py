#!/usr/bin/env python3
"""
PostHog impact scorer.

Reads impact.db (written by collect.py) and computes three scores
per engineer, combining them into a final RAIL-derived composite.

Scores
------
Breadth     (35%)  — unique collaborators + unique top-level directories
Acceleration (35%) — median hours from last APPROVED review to merge,
                     for reviews where that window was <= 48 hours
                     (i.e. reviewer demonstrably unblocked the PR)
Substance   (30%)  — weighted intent ratio: high-intent labels and
                     linked issues push up; low-intent labels push down;
                     unlabelled PRs are neutral

All three dimension scores are normalised 0–100 before weighting.

Usage
-----
  python score.py               # reads ./impact.db, prints top 10
  DB_PATH=./impact.db TOP=5 python score.py
"""

import json
import os
import sqlite3
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

DB_PATH = os.environ.get("DB_PATH", "./impact.db")
TOP_N   = int(os.environ.get("TOP", 10))

# ── Acceleration config ───────────────────────────────────────────────────────

# Maximum hours between an APPROVED review and merge to count as an unblock.
# Beyond this threshold the delay is likely author-side or process-side,
# not reviewer-side, so we exclude it from the reviewer's score.
UNBLOCK_WINDOW_H = 48

# ── Substance label taxonomy ──────────────────────────────────────────────────
#
# PostHog uses a rich label namespace.  We classify by prefix/exact match.
# Anything not matched → neutral weight (0.5).
#
# High-intent: user-facing work  →  1.0
# Low-intent:  housekeeping       →  0.0
# Neutral:     team/area tags     →  0.5

HIGH_INTENT_EXACT    = {"bug", "enhancement", "experiment"}
HIGH_INTENT_PREFIXES = ("feature/",)          # e.g. feature/actions, feature/replay

LOW_INTENT_EXACT     = {"dependencies", "deploy", "ci", "chore", "backlog",
                         "bot-ips", "codex", "canary"}
LOW_INTENT_PREFIXES  = ("chore",)             # future-proofing


def label_weight(label: str) -> float:
    lo = label.lower()
    if lo in HIGH_INTENT_EXACT or any(lo.startswith(p) for p in HIGH_INTENT_PREFIXES):
        return 1.0
    if lo in LOW_INTENT_EXACT or any(lo.startswith(p) for p in LOW_INTENT_PREFIXES):
        return 0.0
    return 0.5   # neutral — team/area tags, ux, design, etc.


# ── Data model ────────────────────────────────────────────────────────────────

@dataclass
class Engineer:
    login: str

    # Breadth inputs
    dirs_authored:    set  = field(default_factory=set)   # all dirs across authored PRs
    collaborators:    set  = field(default_factory=set)   # reviewers of their PRs + PRs they reviewed

    # Acceleration inputs — list of qualifying unblock hours (APPROVED, <=48h)
    unblock_hours:    list = field(default_factory=list)

    # Substance inputs
    pr_intent_scores: list = field(default_factory=list)  # 0.0–1.0 per authored PR

    # Computed (filled by score())
    breadth_raw:      float = 0.0
    accel_raw:        float = 0.0
    substance_raw:    float = 0.0

    breadth:          float = 0.0
    acceleration:     float = 0.0
    substance:        float = 0.0
    composite:        float = 0.0


# ── Load and aggregate ────────────────────────────────────────────────────────

def load(conn: sqlite3.Connection) -> dict[str, Engineer]:
    engineers: dict[str, Engineer] = defaultdict(lambda: Engineer(login=""))

    def eng(login: str) -> Engineer:
        if login not in engineers:
            engineers[login] = Engineer(login=login)
        return engineers[login]

    # ── pr_directories: Breadth + Substance inputs ────────────────────────────
    rows = conn.execute(
        "SELECT pr_number, author_login, directories, linked_issues, labels "
        "FROM pr_directories"
    ).fetchall()

    pr_authors: dict[int, str] = {}

    for pr_number, author, dirs_json, issues_json, labels_json in rows:
        pr_authors[pr_number] = author
        e = eng(author)

        dirs    = json.loads(dirs_json)
        issues  = json.loads(issues_json)
        labels  = json.loads(labels_json)

        # Breadth — accumulate directories this author has touched
        e.dirs_authored.update(dirs)

        # Substance — compute intent score for this PR
        intent = _pr_intent(labels, len(issues))
        e.pr_intent_scores.append(intent)

    # ── pr_reviews: Breadth (collaborators) + Acceleration ───────────────────
    #
    # Acceleration query:
    #   For each PR, find the LAST APPROVED review before merge.
    #   If that reviewer's hours_review_to_merge is within UNBLOCK_WINDOW_H,
    #   record it as a qualifying unblock event for that reviewer.
    #
    # We do this in Python (not SQL) to keep the logic transparent.

    review_rows = conn.execute(
        "SELECT pr_number, reviewer, reviewed_at, "
        "       merged_at, hours_review_to_merge, review_state "
        "FROM pr_reviews "
        "ORDER BY pr_number, reviewed_at"   # ascending so last row per PR is the latest
    ).fetchall()

    # Group by PR
    by_pr: dict[int, list] = defaultdict(list)
    for row in review_rows:
        by_pr[row[0]].append(row)

    for pr_number, reviews in by_pr.items():
        author = pr_authors.get(pr_number)

        # Collaborator edges: reviewer ↔ author
        for (_, reviewer, *_rest) in reviews:
            if author and reviewer != author:
                eng(author).collaborators.add(reviewer)
                eng(reviewer).collaborators.add(author)

        # Acceleration: last APPROVED review only
        approved = [r for r in reviews if r[5] == "APPROVED"]
        if not approved:
            continue

        # approved is sorted ascending by reviewed_at; last = most recent
        last = approved[-1]
        reviewer   = last[1]
        h_to_merge = last[4]   # hours_review_to_merge

        if h_to_merge is None:
            continue
        if h_to_merge < 0:
            # Review submitted after merge timestamp — data artifact, skip
            continue
        if h_to_merge <= UNBLOCK_WINDOW_H:
            eng(reviewer).unblock_hours.append(h_to_merge)

    return dict(engineers)


def _pr_intent(labels: list[str], n_linked_issues: int) -> float:
    """
    Returns a 0.0–1.0 intent score for a single PR.

    Logic:
      1. Start with the mean weight of all labels (or 0.5 if unlabelled).
      2. Each linked issue adds a +0.1 bonus, capped so total stays ≤ 1.0.
    """
    if labels:
        base = sum(label_weight(l) for l in labels) / len(labels)
    else:
        base = 0.5   # unlabelled → neutral per PRD spec

    bonus = min(n_linked_issues * 0.1, 1.0 - base)
    return round(base + bonus, 4)


# ── Normalise and score ───────────────────────────────────────────────────────

def _normalise(values: list[float], invert: bool = False) -> list[float]:
    """Scale a list of raw values to [0, 100]."""
    if not values or max(values) == min(values):
        return [50.0] * len(values)
    lo, hi = min(values), max(values)
    normed = [(v - lo) / (hi - lo) * 100 for v in values]
    if invert:
        normed = [100 - n for n in normed]
    return normed


def score(engineers: dict[str, Engineer]) -> list[Engineer]:
    logins = list(engineers.keys())
    engs   = [engineers[l] for l in logins]

    # ── Raw values ────────────────────────────────────────────────────────────

    # Breadth: unique dirs + unique collaborators, combined
    for e in engs:
        e.breadth_raw = len(e.dirs_authored) + len(e.collaborators)

    # Acceleration: median unblock hours (lower = better → invert normalisation)
    for e in engs:
        e.accel_raw = (
            statistics.median(e.unblock_hours)
            if e.unblock_hours
            else float("inf")   # no qualifying unblocks → worst score
        )

    # Substance: mean PR intent score across all authored PRs
    for e in engs:
        e.substance_raw = (
            sum(e.pr_intent_scores) / len(e.pr_intent_scores)
            if e.pr_intent_scores
            else 0.5
        )

    # ── Normalise ─────────────────────────────────────────────────────────────

    breadth_vals   = [e.breadth_raw   for e in engs]
    accel_vals     = [e.accel_raw     for e in engs]
    substance_vals = [e.substance_raw for e in engs]

    # Replace inf with max finite value before normalising Acceleration
    finite_accel = [v for v in accel_vals if v != float("inf")]
    worst_accel  = max(finite_accel) * 2 if finite_accel else 100
    accel_vals   = [v if v != float("inf") else worst_accel for v in accel_vals]

    b_normed = _normalise(breadth_vals,   invert=False)
    a_normed = _normalise(accel_vals,     invert=True)   # lower hours = better
    s_normed = _normalise(substance_vals, invert=False)

    for e, b, a, s in zip(engs, b_normed, a_normed, s_normed):
        e.breadth      = round(b, 1)
        e.acceleration = round(a, 1)
        e.substance    = round(s, 1)
        e.composite    = round(b * 0.35 + a * 0.35 + s * 0.30, 1)

    return sorted(engs, key=lambda e: e.composite, reverse=True)


# ── Output ────────────────────────────────────────────────────────────────────

def fmt_bar(score: float, width: int = 20) -> str:
    filled = round(score / 100 * width)
    return "█" * filled + "░" * (width - filled)


def print_results(ranked: list[Engineer]) -> None:
    print(f"\n{'='*60}")
    print(f"  PostHog Impact Rankings — Top {TOP_N}")
    print(f"{'='*60}\n")

    for i, e in enumerate(ranked[:TOP_N], 1):
        print(f"#{i}  {e.login:<25}  Composite: {e.composite:>5.1f}/100")
        print(f"    Breadth      {fmt_bar(e.breadth)}  {e.breadth:>5.1f}")
        print(f"    Acceleration {fmt_bar(e.acceleration)}  {e.acceleration:>5.1f}")
        print(f"    Substance    {fmt_bar(e.substance)}  {e.substance:>5.1f}")

        # Inline explanation
        parts = []
        if e.unblock_hours:
            parts.append(
                f"median unblock {statistics.median(e.unblock_hours):.1f}h "
                f"({len(e.unblock_hours)} qualifying reviews)"
            )
        if e.dirs_authored:
            parts.append(f"{len(e.dirs_authored)} dirs, {len(e.collaborators)} collaborators")
        if e.pr_intent_scores:
            parts.append(
                f"intent {sum(e.pr_intent_scores)/len(e.pr_intent_scores):.2f} "
                f"across {len(e.pr_intent_scores)} PRs"
            )
        if parts:
            print(f"    → {' · '.join(parts)}")
        print()


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    conn    = sqlite3.connect(DB_PATH)
    engs    = load(conn)
    conn.close()

    print(f"Loaded {len(engs)} engineers from {DB_PATH}")

    # Filter to engineers with at least some meaningful activity
    # (avoids ranking bots and one-off external contributors)
    active = {l: e for l, e in engs.items() if len(e.pr_intent_scores) >= 3}
    print(f"{len(active)} engineers with ≥ 3 authored PRs in window")

    ranked = score(active)
    print_results(ranked)

    # Machine-readable summary for downstream use (dashboard, etc.)
    output = [
        {
            "rank":         i + 1,
            "login":        e.login,
            "composite":    e.composite,
            "breadth":      e.breadth,
            "acceleration": e.acceleration,
            "substance":    e.substance,
            "n_prs":        len(e.pr_intent_scores),
            "n_unblocks":   len(e.unblock_hours),
            "n_dirs":       len(e.dirs_authored),
            "n_collabs":    len(e.collaborators),
            "median_unblock_h": (
                round(statistics.median(e.unblock_hours), 1)
                if e.unblock_hours else None
            ),
        }
        for i, e in enumerate(ranked[:TOP_N])
    ]
    with open("scores.json", "w") as f:
        json.dump(output, f, indent=2)
    print(f"\nscores.json written ({len(output)} engineers)")


if __name__ == "__main__":
    main()
