#!/usr/bin/env node

// greymemory migrate
// Run: npx greymemory migrate
// Run: npx greymemory migrate --dir .greymemory
//
// Migrates an existing v0.2.x greymemory database to v0.3
// Safe to run multiple times — all operations are idempotent

import Database from 'better-sqlite3'
import fs       from 'fs'
import path     from 'path'

// parse --dir flag
const args    = process.argv.slice(2)
const dirFlag = args.indexOf('--dir')
const dir     = dirFlag !== -1 ? args[dirFlag + 1] : '.greymemory'
const dbFile  = path.join(dir, 'greymemory.db')

// check database exists
if (!fs.existsSync(dbFile)) {
  console.error(`[greymemory] no database found at ${dbFile}`)
  console.error(`[greymemory] use --dir to specify a custom location`)
  process.exit(1)
}

console.log(`[greymemory] migrating ${dbFile}`)

try {
  const db = new Database(dbFile)

  // step 1: facts table rebuild — remove UNIQUE(key, container)
  const factsDef = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='facts'`
  ).get()

  if (factsDef?.sql?.includes('UNIQUE(key, container)')) {
    console.log('[greymemory] rebuilding facts table — removing UNIQUE constraint')

    db.transaction(() => {
      db.exec(`
        DROP TRIGGER IF EXISTS facts_ai;
        DROP TRIGGER IF EXISTS facts_au;
        DROP TRIGGER IF EXISTS facts_ad;
      `)
      db.exec(`ALTER TABLE facts RENAME TO facts_old`)

      const oldCols = new Set(db.pragma('table_info(facts_old)').map(c => c.name))
      const v3columns = [
        ['memory_type',     "TEXT NOT NULL DEFAULT 'fact'"],
        ['document_date',   'TEXT'],
        ['event_date',      'TEXT'],
        ['expires_at',      'TEXT'],
        ['is_latest',       'INTEGER NOT NULL DEFAULT 1'],
        ['superseded_by',   'INTEGER'],
        ['superseded_from', 'INTEGER'],
        ['relation_type',   'TEXT'],
        ['related_to',      'INTEGER'],
        ['chunk_id',        'INTEGER'],
        ['confidence',      'REAL NOT NULL DEFAULT 1.0'],
        ['metadata',        "TEXT NOT NULL DEFAULT '{}'"],
      ]
      for (const [col, def] of v3columns) {
        if (!oldCols.has(col)) db.exec(`ALTER TABLE facts_old ADD COLUMN ${col} ${def}`)
      }

      db.exec(`
        UPDATE facts_old SET
          document_date = COALESCE(created_at, datetime('now')),
          memory_type   = 'fact',
          is_latest     = 1,
          confidence    = 1.0,
          metadata      = '{}'
        WHERE document_date IS NULL
      `)

      db.exec(`
        CREATE TABLE facts (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          key             TEXT    NOT NULL,
          value           TEXT    NOT NULL,
          container       TEXT    NOT NULL DEFAULT 'default',
          created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
          updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
          memory_type     TEXT    NOT NULL DEFAULT 'fact',
          document_date   TEXT,
          event_date      TEXT,
          expires_at      TEXT,
          is_latest       INTEGER NOT NULL DEFAULT 1,
          superseded_by   INTEGER,
          superseded_from INTEGER,
          relation_type   TEXT,
          related_to      INTEGER,
          chunk_id        INTEGER,
          confidence      REAL    NOT NULL DEFAULT 1.0,
          metadata        TEXT    NOT NULL DEFAULT '{}'
        )
      `)

      db.exec(`
        INSERT INTO facts
          (id, key, value, container, created_at, updated_at,
           memory_type, document_date, event_date, expires_at, is_latest,
           superseded_by, superseded_from, relation_type, related_to,
           chunk_id, confidence, metadata)
        SELECT
          id, key, value, container, created_at, updated_at,
          memory_type, document_date, event_date, expires_at, is_latest,
          superseded_by, superseded_from, relation_type, related_to,
          chunk_id, confidence, metadata
        FROM facts_old
      `)

      db.exec(`DROP TABLE facts_old`)
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS facts_ai
        AFTER INSERT ON facts BEGIN
          INSERT INTO facts_fts(rowid, key, value, container)
          VALUES (new.id, new.key, new.value, new.container);
        END;
        CREATE TRIGGER IF NOT EXISTS facts_au
        AFTER UPDATE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, key, value, container)
          VALUES ('delete', old.id, old.key, old.value, old.container);
          INSERT INTO facts_fts(rowid, key, value, container)
          VALUES (new.id, new.key, new.value, new.container);
        END;
        CREATE TRIGGER IF NOT EXISTS facts_ad
        AFTER DELETE ON facts BEGIN
          INSERT INTO facts_fts(facts_fts, rowid, key, value, container)
          VALUES ('delete', old.id, old.key, old.value, old.container);
        END;
      `)
      db.exec(`INSERT INTO facts_fts(facts_fts) VALUES('rebuild')`)
    })()

    console.log('[greymemory] facts table rebuilt')
  }

  // step 2: embeddings table rebuild — fact_key → fact_id
  const embDef = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='embeddings'`
  ).get()

  if (embDef?.sql?.includes('UNIQUE(fact_key, container)')) {
    console.log('[greymemory] rebuilding embeddings table — switching to fact_id')

    db.transaction(() => {
      db.exec(`ALTER TABLE embeddings RENAME TO embeddings_old`)
      db.exec(`
        CREATE TABLE embeddings (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          fact_id    INTEGER NOT NULL REFERENCES facts(id),
          container  TEXT    NOT NULL DEFAULT 'default',
          vector     TEXT    NOT NULL,
          model      TEXT    NOT NULL DEFAULT 'mxbai-embed-large',
          created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )
      `)
      db.exec(`
        INSERT INTO embeddings (fact_id, container, vector, model, created_at)
        SELECT f.id, e.container, e.vector, e.model, e.created_at
        FROM embeddings_old e
        JOIN facts f ON e.fact_key = f.key AND e.container = f.container
        WHERE f.is_latest = 1
      `)
      db.exec(`DROP TABLE embeddings_old`)
    })()

    console.log('[greymemory] embeddings table rebuilt')
  }

  // step 3: add missing columns
  const existing = new Set(db.pragma('table_info(facts)').map(c => c.name))
  const columns  = [
    ['memory_type',     "TEXT NOT NULL DEFAULT 'fact'"],
    ['document_date',   'TEXT'],
    ['event_date',      'TEXT'],
    ['expires_at',      'TEXT'],
    ['is_latest',       'INTEGER NOT NULL DEFAULT 1'],
    ['superseded_by',   'INTEGER'],
    ['superseded_from', 'INTEGER'],
    ['relation_type',   'TEXT'],
    ['related_to',      'INTEGER'],
    ['chunk_id',        'INTEGER'],
    ['confidence',      'REAL NOT NULL DEFAULT 1.0'],
    ['metadata',        "TEXT NOT NULL DEFAULT '{}'"],
  ]
  for (const [col, def] of columns) {
    if (!existing.has(col)) {
      db.exec(`ALTER TABLE facts ADD COLUMN ${col} ${def}`)
      console.log(`[greymemory] added column: ${col}`)
    }
  }

  // step 4: backfill defaults
  db.exec(`
    UPDATE facts SET
      document_date = COALESCE(created_at, datetime('now')),
      memory_type   = 'fact',
      is_latest     = 1,
      confidence    = 1.0,
      metadata      = '{}'
    WHERE document_date IS NULL
  `)

  // step 5: indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_facts_latest  ON facts(container, is_latest);
    CREATE INDEX IF NOT EXISTS idx_facts_type    ON facts(container, memory_type);
    CREATE INDEX IF NOT EXISTS idx_facts_docdate ON facts(container, document_date);
    CREATE INDEX IF NOT EXISTS idx_facts_expires ON facts(expires_at) WHERE expires_at IS NOT NULL;
  `)

  const factCount  = db.prepare(`SELECT COUNT(*) as count FROM facts`).get().count
  const chunkCount = db.prepare(`SELECT COUNT(*) as count FROM chunks`).get()?.count ?? 0

  console.log(`[greymemory] migration complete`)
  console.log(`[greymemory] ${factCount} facts preserved`)
  console.log(`[greymemory] ${chunkCount} chunks preserved`)
  console.log(`[greymemory] database is ready for v0.3`)

  db.close()

} catch (err) {
  console.error(`[greymemory] migration failed: ${err.message}`)
  process.exit(1)
}