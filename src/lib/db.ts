import Database from 'better-sqlite3'
import path from 'path'

function defaultDbPath(): string {
  if (process.env.DB_PATH) return process.env.DB_PATH
  // Vercel/Serverless filesystems are typically read-only except /tmp.
  if (process.env.VERCEL) return path.join('/tmp', 'impact.db')
  return path.join(process.cwd(), 'impact.db')
}

let dbPath = defaultDbPath()

let _db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!_db) {
    try {
      _db = new Database(dbPath)
    } catch (err) {
      // If the default path isn't writable (common on Vercel), fall back to /tmp.
      if (!process.env.DB_PATH && dbPath !== path.join('/tmp', 'impact.db')) {
        dbPath = path.join('/tmp', 'impact.db')
        _db = new Database(dbPath)
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
