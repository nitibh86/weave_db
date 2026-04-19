import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

type DbConfig = { dbPath: string }

function defaultDbConfig(): DbConfig {
  if (process.env.DB_PATH) return { dbPath: process.env.DB_PATH }

  if (process.env.VERCEL) {
    // Vercel is read-only except /tmp. Seed /tmp from a bundled DB if present.
    const tmp = path.join('/tmp', 'impact.db')
    const bundled = path.join(process.cwd(), 'data', 'impact.db')
    try {
      if (!fs.existsSync(tmp) && fs.existsSync(bundled)) {
        fs.copyFileSync(bundled, tmp)
      }
    } catch {
      // If seeding fails, we'll attempt to create/open below.
    }
    return { dbPath: tmp }
  }

  return { dbPath: path.join(process.cwd(), 'impact.db') }
}

let dbConfig = defaultDbConfig()

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    try {
      _db = new Database(dbConfig.dbPath)
    } catch (err) {
      // If the default path isn't writable (common on Vercel), fall back to /tmp.
      const tmp = path.join('/tmp', 'impact.db')
      if (!process.env.DB_PATH && dbConfig.dbPath !== tmp) {
        dbConfig = { dbPath: tmp }
        _db = new Database(dbConfig.dbPath)
      } else {
        throw err
      }
    }

    _db.pragma('journal_mode = WAL')
    _db.pragma('synchronous = NORMAL')
    initSchema(_db)
  }
  return _db
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pr_directories (
      pr_number     INTEGER PRIMARY KEY,
      author_login  TEXT    NOT NULL,
      merged_at     TEXT    NOT NULL,
      directories   TEXT    NOT NULL,
      linked_issues TEXT    NOT NULL,
      labels        TEXT    NOT NULL,
      title         TEXT    NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pr_reviews (
      pr_number             INTEGER NOT NULL,
      reviewer              TEXT    NOT NULL,
      reviewed_at           TEXT    NOT NULL,
      opened_at             TEXT,
      merged_at             TEXT,
      hours_open_to_review  REAL,
      hours_review_to_merge REAL,
      review_state          TEXT    NOT NULL,
      PRIMARY KEY (pr_number, reviewer, reviewed_at)
    );

    CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON pr_reviews(reviewer);
    CREATE INDEX IF NOT EXISTS idx_reviews_pr       ON pr_reviews(pr_number);
    CREATE INDEX IF NOT EXISTS idx_dirs_author      ON pr_directories(author_login);
  `)

  // Migrate existing DBs that pre-date the title column
  const cols = (db.pragma('table_info(pr_directories)') as Array<{ name: string }>).map(r => r.name)
  if (!cols.includes('title')) {
    db.exec(`ALTER TABLE pr_directories ADD COLUMN title TEXT NOT NULL DEFAULT ''`)
  }
}
