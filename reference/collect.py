#!/usr/bin/env python3
"""
PostHog impact data collector.

Writes two SQLite tables that together contain every field needed to
compute Breadth, Acceleration, and Substance scores without any
additional API calls.

Schema contract (what score.py depends on)
------------------------------------------
pr_directories
  pr_number     PK
  author_login  GitHub login of PR author
  merged_at     ISO-8601 timestamp
  directories   JSON array of unique top-level dirs touched
  linked_issues JSON array of ints  (from "Closes #N" in body)
  labels        JSON array of label name strings

pr_reviews
  (pr_number, reviewer, reviewed_at)  PK
  reviewer              GitHub login
  reviewed_at           ISO-8601
  opened_at             ISO-8601  (PR createdAt)
  merged_at             ISO-8601  (PR mergedAt, denormalised for query convenience)
  hours_open_to_review  REAL  — PR opened → this review
  hours_review_to_merge REAL  — this review → PR merged  (Acceleration input)
  review_state          TEXT  — APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED

Usage
-----
  GITHUB_TOKEN=ghp_xxx python collect.py
  GITHUB_TOKEN=ghp_xxx DAYS=30 python collect.py
"""

import json
import os
import re
import sqlite3
import time
from datetime import datetime, timedelta, timezone

import requests

# ── Config ────────────────────────────────────────────────────────────────────

DB_PATH   = os.environ.get("DB_PATH",   "./impact.db")
TOKEN     = os.environ["GITHUB_TOKEN"]
DAYS      = int(os.environ.get("DAYS", 90))
PAGE_SIZE = 100   # GraphQL max per page; 90 days ≈ 8–13 pages for PostHog

HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
GQL_URL = "https://api.github.com/graphql"
SINCE   = datetime.now(timezone.utc) - timedelta(days=DAYS)

# ── Regex ─────────────────────────────────────────────────────────────────────

# PostHog uses squash-merge exclusively, so PR numbers appear as "(#1234)"
# in the commit/PR title. We parse linked issues from the PR body instead.
CLOSES_RE = re.compile(r'(?:closes|fixes|resolves)\s+#(\d+)', re.IGNORECASE)

# ── GraphQL query ─────────────────────────────────────────────────────────────
#
# Single paginated query.  Fetches per PR:
#   - metadata: number, mergedAt, createdAt, author, bodyText
#   - labels   → Substance scoring
#   - files    → Breadth scoring (replaces git diff)
#   - reviews  → Acceleration scoring
#     * submittedAt  — to find last review before merge
#     * state        — APPROVED only qualifies as an "unblock"
#
# files(first:100) covers ~99% of PRs; the rare >100-file PR gets truncated
# directories, which is acceptable for directory-breadth scoring.

QUERY = """
query($cursor: String) {
  repository(owner: "PostHog", name: "posthog") {
    pullRequests(
      first: 100
      after: $cursor
      states: MERGED
      orderBy: { field: UPDATED_AT, direction: DESC }
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        mergedAt
        createdAt
        author   { login }
        bodyText
        labels   (first: 20) { nodes { name } }
        files    (first: 100) { nodes { path } }
        reviews  (first: 50) {
          nodes {
            author      { login }
            submittedAt
            state
          }
        }
      }
    }
  }
}
"""

# ── SQLite schema ─────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS pr_directories (
    pr_number     INTEGER PRIMARY KEY,
    author_login  TEXT    NOT NULL,
    merged_at     TEXT    NOT NULL,   -- ISO-8601
    directories   TEXT    NOT NULL,   -- JSON array of unique top-level dirs
    linked_issues TEXT    NOT NULL,   -- JSON array of ints  (Closes #N)
    labels        TEXT    NOT NULL    -- JSON array of label name strings
);

CREATE TABLE IF NOT EXISTS pr_reviews (
    pr_number             INTEGER NOT NULL,
    reviewer              TEXT    NOT NULL,
    reviewed_at           TEXT    NOT NULL,   -- ISO-8601
    opened_at             TEXT,               -- ISO-8601
    merged_at             TEXT,               -- ISO-8601  (denormalised)
    hours_open_to_review  REAL,               -- opened → reviewed
    hours_review_to_merge REAL,               -- reviewed → merged
    review_state          TEXT    NOT NULL,   -- APPROVED|CHANGES_REQUESTED|COMMENTED|DISMISSED
    PRIMARY KEY (pr_number, reviewer, reviewed_at)
);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON pr_reviews(reviewer);
CREATE INDEX IF NOT EXISTS idx_reviews_pr       ON pr_reviews(pr_number);
CREATE INDEX IF NOT EXISTS idx_dirs_author      ON pr_directories(author_login);
"""

# ── Helpers ───────────────────────────────────────────────────────────────────

def parse_iso(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None

def hours_between(a: datetime | None, b: datetime | None) -> float | None:
    if a and b:
        return round((b - a).total_seconds() / 3600, 2)
    return None

def dirs_from_paths(paths: list[str]) -> list[str]:
    """Unique top-level directories from a list of file paths."""
    return list({p.split("/")[0] if "/" in p else "_root" for p in paths})

# ── Pagination ────────────────────────────────────────────────────────────────

def paginate() -> list[dict]:
    """
    Cursor-paginate through MERGED PRs newest-first, stopping when
    mergedAt falls outside the DAYS window.
    """
    cursor, prs, page_num = None, [], 0

    while True:
        page_num += 1
        resp = requests.post(
            GQL_URL,
            headers=HEADERS,
            json={"query": QUERY, "variables": {"cursor": cursor}},
            timeout=30,
        )
        resp.raise_for_status()
        payload = resp.json()

        if "errors" in payload:
            # Surface but don't crash — partial data is better than nothing
            print(f"  GraphQL errors on page {page_num}: {payload['errors'][:2]}")

        page     = payload["data"]["repository"]["pullRequests"]
        nodes    = page["nodes"]
        has_next = page["pageInfo"]["hasNextPage"]
        cursor   = page["pageInfo"]["endCursor"]

        in_window = 0
        for pr in nodes:
            merged_dt = parse_iso(pr.get("mergedAt"))
            if not merged_dt or merged_dt < SINCE:
                has_next = False   # newest-first; once past window we're done
                break
            prs.append(pr)
            in_window += 1

        print(f"  Page {page_num}: {in_window} PRs in window (total: {len(prs)})")

        if not has_next:
            break

        time.sleep(0.2)   # ~5 req/s — well within GitHub's GraphQL budget

    return prs

# ── Transform ─────────────────────────────────────────────────────────────────

def transform(prs: list[dict]) -> tuple[list[tuple], list[tuple]]:
    """
    Returns (dir_rows, review_rows) ready for executemany.

    dir_rows   → pr_directories  (one row per PR)
    review_rows → pr_reviews      (one row per review event)
    """
    dir_rows, review_rows = [], []

    for pr in prs:
        number    = pr["number"]
        merged_at = pr.get("mergedAt")
        opened_at = pr.get("createdAt")
        author    = (pr.get("author") or {}).get("login", "ghost")
        body      = pr.get("bodyText", "") or ""
        labels    = [l["name"] for l in pr["labels"]["nodes"]]
        files     = [f["path"] for f in pr["files"]["nodes"]]

        # pr_directories row — labels live here, not on reviews
        dir_rows.append((
            number,
            author,
            merged_at,
            json.dumps(dirs_from_paths(files)),
            json.dumps([int(x) for x in CLOSES_RE.findall(body)]),
            json.dumps(labels),
        ))

        opened_dt = parse_iso(opened_at)
        merged_dt = parse_iso(merged_at)

        for review in pr["reviews"]["nodes"]:
            reviewer    = (review.get("author") or {}).get("login")
            reviewed_at = review.get("submittedAt")
            state       = review.get("state", "COMMENTED")
            if not reviewer or not reviewed_at:
                continue

            reviewed_dt = parse_iso(reviewed_at)
            review_rows.append((
                number,
                reviewer,
                reviewed_at,
                opened_at,
                merged_at,
                hours_between(opened_dt, reviewed_dt),
                hours_between(reviewed_dt, merged_dt),
                state,
            ))

    return dir_rows, review_rows

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    conn.commit()

    print(f"Fetching merged PRs — last {DAYS} days…")
    prs = paginate()
    print(f"\nTotal: {len(prs)} PRs fetched")

    print("Transforming and writing…")
    dir_rows, review_rows = transform(prs)

    conn.executemany(
        "INSERT OR REPLACE INTO pr_directories VALUES (?,?,?,?,?,?)", dir_rows
    )
    conn.executemany(
        "INSERT OR REPLACE INTO pr_reviews VALUES (?,?,?,?,?,?,?,?)", review_rows
    )
    conn.commit()

    # Sanity counts
    pr_count  = conn.execute("SELECT COUNT(*)                   FROM pr_directories").fetchone()[0]
    rev_count = conn.execute("SELECT COUNT(*)                   FROM pr_reviews").fetchone()[0]
    eng_count = conn.execute("SELECT COUNT(DISTINCT reviewer)   FROM pr_reviews").fetchone()[0]
    auth_count= conn.execute("SELECT COUNT(DISTINCT author_login) FROM pr_directories").fetchone()[0]
    appr_count= conn.execute(
        "SELECT COUNT(*) FROM pr_reviews WHERE review_state = 'APPROVED'"
    ).fetchone()[0]

    print(f"\n✓  {pr_count} PRs · {rev_count} review events ({appr_count} approvals)")
    print(f"   {auth_count} authors · {eng_count} reviewers → {DB_PATH}")
    conn.close()


if __name__ == "__main__":
    main()
