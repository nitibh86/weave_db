export async function register() {
  // Only run in the Node.js runtime (not edge), and only on the server
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (!process.env.GITHUB_TOKEN) {
    console.log('[startup] GITHUB_TOKEN not set — skipping auto-collect')
    return
  }

  // Lazy import so better-sqlite3 isn't bundled for edge
  const { getDb }   = await import('@/lib/db')
  const { collect } = await import('@/lib/collect')

  const db = getDb()
  const { n } = db.prepare('SELECT COUNT(*) as n FROM pr_directories').get() as { n: number }

  if (n > 0) {
    console.log(`[startup] DB already has ${n} PRs — skipping auto-collect`)
    return
  }

  console.log('[startup] DB empty — starting initial data collection…')
  try {
    await collect(90)
  } catch (err) {
    console.error('[startup] auto-collect failed:', err)
  }
}
