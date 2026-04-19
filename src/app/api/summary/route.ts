import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const minPrs = parseInt(searchParams.get('minPrs') ?? '3', 10)

  try {
    const db = getDb()

    const totalPrs = (
      db.prepare('SELECT COUNT(*) as n FROM pr_directories').get() as { n: number }
    ).n

    const totalEngineers = (
      db.prepare('SELECT COUNT(DISTINCT author_login) as n FROM pr_directories').get() as { n: number }
    ).n

    const scoredEngineers = (
      db.prepare(`
        SELECT COUNT(*) as n
        FROM (
          SELECT author_login
          FROM pr_directories
          GROUP BY author_login
          HAVING COUNT(*) >= ?
        )
      `).get(minPrs) as { n: number }
    ).n

    const lastMergedAt = (
      db.prepare('SELECT MAX(merged_at) as v FROM pr_directories').get() as { v: string | null }
    ).v

    const firstMergedAt = (
      db.prepare('SELECT MIN(merged_at) as v FROM pr_directories').get() as { v: string | null }
    ).v

    const daysCovered =
      firstMergedAt && lastMergedAt
        ? Math.round(
            (new Date(lastMergedAt).getTime() - new Date(firstMergedAt).getTime()) / (24 * 60 * 60 * 1000)
          )
        : null

    return NextResponse.json({
      totalPrs,
      totalEngineers,
      scoredEngineers,
      minPrs,
      firstMergedAt,
      lastMergedAt,
      daysCovered,
    })
  } catch (err) {
    console.error('[/api/summary]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
