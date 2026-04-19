/**
 * GitHub GraphQL → SQLite data collector.
 *
 * TypeScript port of reference/collect.py.
 * Logic must match the Python reference exactly.
 *
 * Fetches all merged PRs from PostHog/posthog in the last `days` days.
 * Writes pr_directories and pr_reviews tables to SQLite.
 */

import { getDb } from './db'

const GQL_URL = 'https://api.github.com/graphql'
const CLOSES_RE = /(?:closes|fixes|resolves)\s+#(\d+)/gi

// ── GraphQL query (identical to reference/collect.py) ─────────────
const QUERY = `
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
          title
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
`

// ── Types for GraphQL response ─────────────────────────────────────
interface GQLReview {
  author: { login: string } | null
  submittedAt: string
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'
}

interface GQLNode {
  number: number
  title: string
  mergedAt: string | null
  createdAt: string
  author: { login: string } | null
  bodyText: string
  labels: { nodes: Array<{ name: string }> }
  files: { nodes: Array<{ path: string }> }
  reviews: { nodes: GQLReview[] }
}

interface GQLResponse {
  data: {
    repository: {
      pullRequests: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
        nodes: GQLNode[]
      }
    }
  }
  errors?: Array<{ message: string }>
}

// ── Helpers ────────────────────────────────────────────────────────

function dirsFromPaths(paths: string[]): string[] {
  const set = new Set(paths.map(p => p.includes('/') ? p.split('/')[0] : '_root'))
  return Array.from(set)
}

function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  return (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

// ── Main collect function ──────────────────────────────────────────

export async function collect(days = 90): Promise<{
  prCount: number
  reviewCount: number
  engineerCount: number
}> {
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN environment variable not set')

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  console.log(`[collect] starting — window: last ${days} days (since ${since.toISOString()})`)
  const t0 = Date.now()
  const db = getDb()

  const insertDir = db.prepare(`
    INSERT OR REPLACE INTO pr_directories
    (pr_number, author_login, merged_at, directories, linked_issues, labels, title)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `)

  const insertReview = db.prepare(`
    INSERT OR REPLACE INTO pr_reviews
    (pr_number, reviewer, reviewed_at, opened_at, merged_at,
     hours_open_to_review, hours_review_to_merge, review_state)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let cursor: string | null = null
  let prCount = 0
  let reviewCount = 0
  let pageNum = 0

  // Wrap all inserts in a transaction per page for speed
  const insertPage = db.transaction((nodes: GQLNode[]) => {
    for (const pr of nodes) {
      const mergedAt   = pr.mergedAt!
      const openedAt   = pr.createdAt
      const author     = pr.author?.login ?? 'ghost'
      const labels     = pr.labels.nodes.map(l => l.name)
      const files      = pr.files.nodes.map(f => f.path)
      const dirs       = dirsFromPaths(files)
      const bodyText   = pr.bodyText ?? ''

      // Extract linked issues from body text
      const linkedIssues: number[] = []
      let m: RegExpExecArray | null
      const re = new RegExp(CLOSES_RE.source, 'gi')
      while ((m = re.exec(bodyText)) !== null) {
        linkedIssues.push(parseInt(m[1], 10))
      }

      insertDir.run(
        pr.number,
        author,
        mergedAt,
        JSON.stringify(dirs),
        JSON.stringify(linkedIssues),
        JSON.stringify(labels),
        pr.title ?? '',
      )

      for (const review of pr.reviews.nodes) {
        const reviewer    = review.author?.login
        const reviewedAt  = review.submittedAt
        if (!reviewer || !reviewedAt) continue

        const hOpen  = hoursBetween(openedAt, reviewedAt)
        const hMerge = hoursBetween(reviewedAt, mergedAt)

        insertReview.run(
          pr.number,
          reviewer,
          reviewedAt,
          openedAt,
          mergedAt,
          hOpen  !== null ? Math.round(hOpen  * 100) / 100 : null,
          hMerge !== null ? Math.round(hMerge * 100) / 100 : null,
          review.state,
        )
        reviewCount++
      }

      prCount++
    }
  })

  // ── Paginate ───────────────────────────────────────────────────
  while (true) {
    pageNum++

    const resp = await fetch(GQL_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: QUERY, variables: { cursor } }),
    })

    if (!resp.ok) {
      const body = await resp.text()
      console.error(`[collect] GitHub API error on page ${pageNum}: HTTP ${resp.status}`, body.slice(0, 200))
      throw new Error(`GitHub API error ${resp.status}: ${body}`)
    }

    const payload = await resp.json() as GQLResponse

    if (payload.errors?.length) {
      console.warn(`[collect] GraphQL errors on page ${pageNum}:`, payload.errors.slice(0, 2))
    }

    const page     = payload.data.repository.pullRequests
    const nodes    = page.nodes
    let   hasNext  = page.pageInfo.hasNextPage
    cursor         = page.pageInfo.endCursor

    // Filter nodes within the time window.
    // GitHub ordering is not guaranteed to be monotonic in `mergedAt`, so we
    // must not stop early on the first out-of-window PR in a page.
    const inWindow: GQLNode[] = []
    for (const pr of nodes) {
      const mergedDt = pr.mergedAt ? new Date(pr.mergedAt) : null
      if (mergedDt && mergedDt >= since) inWindow.push(pr)
    }

    if (inWindow.length > 0) {
      insertPage(inWindow)
    }

    const oldest = inWindow.at(-1)?.mergedAt ?? '—'
    console.log(`[collect] page ${pageNum}: +${inWindow.length} PRs (total: ${prCount}) oldest: ${oldest}`)

    if (inWindow.length === 0) hasNext = false
    if (!hasNext) break

    await sleep(200)
  }

  const engineerCount = (
    db.prepare('SELECT COUNT(DISTINCT author_login) as n FROM pr_directories').get() as { n: number }
  ).n

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[collect] done in ${elapsed}s — ${prCount} PRs, ${reviewCount} reviews, ${engineerCount} engineers`)

  return { prCount, reviewCount, engineerCount }
}
