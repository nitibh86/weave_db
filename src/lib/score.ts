/**
 * SQLite → EngineerScore[] scorer.
 *
 * TypeScript port of reference/score.py.
 * Logic must match the Python reference exactly.
 */

import { getDb } from './db'
import type { EngineerScore, PrDirectoryRow, PrReviewRow } from './types'

// ── Config (mirrors score.py) ──────────────────────────────────────
const UNBLOCK_WINDOW_H = 48

const HIGH_INTENT_EXACT    = new Set(['bug', 'enhancement', 'experiment'])
const HIGH_INTENT_PREFIXES = ['feature/']
const LOW_INTENT_EXACT     = new Set([
  'dependencies', 'deploy', 'ci', 'chore', 'backlog', 'bot-ips', 'codex', 'canary'
])
const LOW_INTENT_PREFIXES  = ['chore']   // matches chore/* labels (mirrors score.py)

function labelWeight(label: string): number {
  const lo = label.toLowerCase()
  if (HIGH_INTENT_EXACT.has(lo) || HIGH_INTENT_PREFIXES.some(p => lo.startsWith(p))) return 1.0
  if (LOW_INTENT_EXACT.has(lo) || LOW_INTENT_PREFIXES.some(p => lo.startsWith(p))) return 0.0
  return 0.5
}

// ── Conventional-commit title intent (PostHog fallback) ───────────
// PostHog PRs use conventional commit prefixes; GitHub labels are sparse
// and mostly neutral (stamphog, team/*, update-snapshots).  When labels
// provide no signal (all neutral or absent), parse the title prefix.
const TITLE_HIGH = new Set(['feat', 'feature', 'fix', 'bug', 'perf', 'security'])
const TITLE_LOW  = new Set(['chore', 'ci', 'build', 'style', 'release', 'revert'])
// refactor/docs/test → 0.5 (neutral — intentionally omitted from both sets)

function titleIntent(title: string): number | null {
  const m = title.match(/^([a-z]+)[\s(:!]/)
  if (!m) return null
  const prefix = m[1].toLowerCase()
  if (TITLE_HIGH.has(prefix)) return 1.0
  if (TITLE_LOW.has(prefix))  return 0.0
  return 0.5
}

// ── PR intent score ────────────────────────────────────────────────
// Uses label weights when labels carry meaningful signal (any weight ≠ 0.5);
// falls back to conventional-commit title prefix otherwise.
function prIntent(labels: string[], nLinkedIssues: number, title = ''): number {
  let base = 0.5
  if (labels.length > 0) {
    const labelBase = labels.reduce((s, l) => s + labelWeight(l), 0) / labels.length
    // Only trust labels if at least one is non-neutral
    base = labels.some(l => labelWeight(l) !== 0.5) ? labelBase : (titleIntent(title) ?? 0.5)
  } else {
    base = titleIntent(title) ?? 0.5
  }
  const bonus = Math.min(nLinkedIssues * 0.1, 1.0 - base)
  return Math.round((base + bonus) * 10000) / 10000
}

// ── Normalise 0–100 (mirrors score.py _normalise) ─────────────────
function normalise(values: number[], invert = false): number[] {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  if (hi === lo) return values.map(() => 50)
  const normed = values.map(v => ((v - lo) / (hi - lo)) * 100)
  return invert ? normed.map(n => 100 - n) : normed
}

// ── Variance ───────────────────────────────────────────────────────
function variance(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
}

// ── Median ─────────────────────────────────────────────────────────
function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

// ── Internal accumulator ───────────────────────────────────────────
interface EngAcc {
  login: string
  dirsAuthored:   Set<string>
  collaborators:  Set<string>
  unblockHours:   number[]
  intentScores:   number[]
  prs:            Array<{ number: number; title: string; intent: number }>
}

// ── Main score function ────────────────────────────────────────────
export function score(minPrs = 3, topN = 10): EngineerScore[] {
  const db = getDb()

  // Check if tables have data
  const prCount = (db.prepare('SELECT COUNT(*) as n FROM pr_directories').get() as { n: number }).n
  if (prCount === 0) return []

  const accMap = new Map<string, EngAcc>()

  function getAcc(login: string): EngAcc {
    if (!accMap.has(login)) {
      accMap.set(login, {
        login,
        dirsAuthored:  new Set(),
        collaborators: new Set(),
        unblockHours:  [],
        intentScores:  [],
        prs:           [],
      })
    }
    return accMap.get(login)!
  }

  // ── 1. Breadth + Substance from pr_directories ─────────────────
  const dirRows = db
    .prepare('SELECT pr_number, author_login, directories, linked_issues, labels, title FROM pr_directories')
    .all() as PrDirectoryRow[]

  const prAuthors = new Map<number, string>()

  for (const row of dirRows) {
    prAuthors.set(row.pr_number, row.author_login)
    const acc     = getAcc(row.author_login)
    const dirs    = JSON.parse(row.directories) as string[]
    const issues  = JSON.parse(row.linked_issues) as number[]
    const labels  = JSON.parse(row.labels) as string[]
    const intent  = prIntent(labels, issues.length, row.title)

    dirs.forEach(d => acc.dirsAuthored.add(d))
    acc.intentScores.push(intent)
    acc.prs.push({ number: row.pr_number, title: row.title, intent })
  }

  // ── 2. Acceleration + collaborators from pr_reviews ────────────
  // Group by PR, sorted by reviewed_at ascending
  const reviewRows = db
    .prepare(`
      SELECT pr_number, reviewer, reviewed_at, merged_at,
             hours_review_to_merge, review_state
      FROM pr_reviews
      ORDER BY pr_number, reviewed_at ASC
    `)
    .all() as PrReviewRow[]

  const byPr = new Map<number, PrReviewRow[]>()
  for (const row of reviewRows) {
    if (!byPr.has(row.pr_number)) byPr.set(row.pr_number, [])
    byPr.get(row.pr_number)!.push(row)
  }

  for (const [prNumber, reviews] of byPr) {
    const author = prAuthors.get(prNumber)

    // Collaborator edges: reviewer ↔ author
    for (const r of reviews) {
      if (author && r.reviewer !== author) {
        getAcc(author).collaborators.add(r.reviewer)
        getAcc(r.reviewer).collaborators.add(author)
      }
    }

    // Acceleration: last APPROVED review only (mirrors score.py exactly)
    const approved = reviews.filter(r => r.review_state === 'APPROVED')
    if (approved.length === 0) continue

    const last = approved[approved.length - 1]  // sorted ascending → last = most recent
    const h    = last.hours_review_to_merge

    if (h === null || h < 0) continue   // review after merge = data artifact
    if (h <= UNBLOCK_WINDOW_H) {
      getAcc(last.reviewer).unblockHours.push(h)
    }
  }

  // ── 3. Filter to engineers with enough PRs ─────────────────────
  const active = Array.from(accMap.values()).filter(
    e => e.intentScores.length >= minPrs
  )

  if (active.length === 0) return []

  // ── 4. Compute raw scores ──────────────────────────────────────
  const breadthRaw   = active.map(e => e.dirsAuthored.size + e.collaborators.size)
  const substanceRaw = active.map(e =>
    e.intentScores.reduce((s, v) => s + v, 0) / e.intentScores.length
  )

  // For acceleration: median unblock hours (lower = better)
  // Engineers with no qualifying unblocks get worst possible score
  const rawAccel  = active.map(e => e.unblockHours.length > 0 ? median(e.unblockHours) : Infinity)
  const maxFinite = Math.max(...rawAccel.filter(v => isFinite(v)))
  const accelRaw  = rawAccel.map(v => isFinite(v) ? v : (maxFinite * 2 || 100))

  // ── 5. Normalise ───────────────────────────────────────────────
  const bNorm = normalise(breadthRaw,   false)
  const aNorm = normalise(accelRaw,     true)   // invert: lower hours = better
  const sNorm = normalise(substanceRaw, false)

  // ── 5b. Variance-derived weights ──────────────────────────────
  // A metric where everyone scores similarly contributes little signal.
  // Weight each dimension by its share of total variance across the cohort.
  const varB = variance(bNorm)
  const varA = variance(aNorm)
  const varS = variance(sNorm)
  const totalVar = varB + varA + varS

  // Fall back to equal weights if all metrics are somehow flat
  const wB = totalVar > 0 ? varB / totalVar : 1 / 3
  const wA = totalVar > 0 ? varA / totalVar : 1 / 3
  const wS = totalVar > 0 ? varS / totalVar : 1 / 3

  const weights = {
    breadth:      Math.round(wB * 1000) / 1000,
    acceleration: Math.round(wA * 1000) / 1000,
    substance:    Math.round(wS * 1000) / 1000,
  }

  // ── 6. Compose, sort, rank ─────────────────────────────────────
  const scored = active.map((e, i): EngineerScore => ({
    rank:         0,   // filled below
    login:        e.login,
    composite:    Math.round((bNorm[i] * wB + aNorm[i] * wA + sNorm[i] * wS) * 10) / 10,
    breadth:      Math.round(bNorm[i] * 10) / 10,
    acceleration: Math.round(aNorm[i] * 10) / 10,
    substance:    Math.round(sNorm[i] * 10) / 10,
    nPrs:         e.intentScores.length,
    nUnblocks:    e.unblockHours.length,
    nDirs:        e.dirsAuthored.size,
    nCollabs:     e.collaborators.size,
    medianUnblockH: e.unblockHours.length > 0
      ? Math.round(median(e.unblockHours) * 10) / 10
      : null,
    weights,
    topPrs: e.prs
      .filter(p => p.title)
      .sort((a, b) => b.intent - a.intent)
      .slice(0, 3)
      .map(p => ({ number: p.number, title: p.title })),
  }))

  return scored
    .sort((a, b) => b.composite - a.composite)
    .slice(0, topN)
    .map((e, i) => ({ ...e, rank: i + 1 }))
}
