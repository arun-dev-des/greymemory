import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export class Storage {
  constructor(dir = ".greymemory", container = "default", existingDb = null) {
    this.container = container;

    if (existingDb) {
      this.db = existingDb;
      this.dir = null;
    } else {
      this.dir = dir;
      this.dbFile = path.join(dir, "greymemory.db");

      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      this.db = new Database(this.dbFile);
    }

    this._init();
    this._migrate(); // v0.3 — add new columns to existing facts table
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        key           TEXT    NOT NULL,
        value         TEXT    NOT NULL,
        container     TEXT    NOT NULL DEFAULT 'default',
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        memory_type   TEXT    NOT NULL DEFAULT 'fact',
        document_date TEXT,
        event_date    TEXT,
        expires_at    TEXT,
        is_latest     INTEGER NOT NULL DEFAULT 1,
        superseded_by   INTEGER,
        superseded_from INTEGER,
        relation_type TEXT,
        related_to    INTEGER,
        confidence    REAL    NOT NULL DEFAULT 1.0,
        metadata      TEXT    NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_id    INTEGER NOT NULL REFERENCES facts(id),
        container  TEXT    NOT NULL DEFAULT 'default',
        vector     TEXT    NOT NULL,
        model      TEXT    NOT NULL DEFAULT 'mxbai-embed-large',
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        content     TEXT NOT NULL,
        container   TEXT NOT NULL DEFAULT 'default',
        session_id  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id    INTEGER NOT NULL,
        container   TEXT NOT NULL DEFAULT 'default',
        vector      TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(chunk_id)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts
      USING fts5(
        key,
        value,
        container UNINDEXED,
        content='facts',
        content_rowid='id'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
      USING fts5(
        content,
        container UNINDEXED,
        content='chunks',
        content_rowid='id'
      );

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

      CREATE TRIGGER IF NOT EXISTS chunks_ai
      AFTER INSERT ON chunks BEGIN
        INSERT INTO chunks_fts(rowid, content, container)
        VALUES (new.id, new.content, new.container);
      END;

      CREATE TRIGGER IF NOT EXISTS chunks_ad
      AFTER DELETE ON chunks BEGIN
        INSERT INTO chunks_fts(chunks_fts, rowid, content, container)
        VALUES ('delete', old.id, old.content, old.container);
      END;
    `);
  }

  // v0.3 — safe, idempotent migration
  // adds new columns to the facts table without touching any existing data
  // uses PRAGMA table_info to skip columns that already exist
  // safe to run on v0.2.x databases and on fresh installs
  _migrate() {
    // ── Table rebuild ──────────────────────────────────────────
    // SQLite cannot DROP constraints with ALTER TABLE.
    // The only way is: rename → create new → copy data → drop old.
    // Wrapped in a transaction — if anything fails, original data is untouched.

    const factsDef = this.db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='facts'`
    ).get();
 
    const needsFactsRebuild = factsDef?.sql?.includes('UNIQUE(key, container)');
 
    if (needsFactsRebuild) {
      console.log('[greymemory] migrating database to v0.3 — this runs once');
 
      this.db.transaction(() => {
        // 1. drop triggers — they point to facts, must be recreated after rename
        this.db.exec(`
          DROP TRIGGER IF EXISTS facts_ai;
          DROP TRIGGER IF EXISTS facts_au;
          DROP TRIGGER IF EXISTS facts_ad;
        `);
 
        // 2. rename old table
        this.db.exec(`ALTER TABLE facts RENAME TO facts_old`);
 
        // 3. add v0.3 columns to facts_old if they don't exist yet
        // handles v0.2.x users who never ran Week 1 migration
        const oldCols = new Set(
          this.db.pragma('table_info(facts_old)').map(c => c.name)
        );
        const v3columns = [
          ['memory_type',   "TEXT    NOT NULL DEFAULT 'fact'"],
          ['document_date', 'TEXT'],
          ['event_date',    'TEXT'],
          ['expires_at',    'TEXT'],
          ['is_latest',     'INTEGER NOT NULL DEFAULT 1'],
          ['superseded_by', 'INTEGER'],
          ['relation_type', 'TEXT'],
          ['related_to',    'INTEGER'],
          ['confidence',    'REAL    NOT NULL DEFAULT 1.0'],
          ['metadata',      "TEXT    NOT NULL DEFAULT '{}'"],
        ];
        for (const [col, def] of v3columns) {
          if (!oldCols.has(col)) {
            this.db.exec(`ALTER TABLE facts_old ADD COLUMN ${col} ${def}`);
          }
        }
 
        // 4. backfill defaults on facts_old rows that were never migrated
        this.db.exec(`
          UPDATE facts_old SET
            document_date = COALESCE(created_at, datetime('now')),
            memory_type   = 'fact',
            is_latest     = 1,
            confidence    = 1.0,
            metadata      = '{}'
          WHERE document_date IS NULL;
        `);
 
        // 5. create new facts table — no UNIQUE constraint, no previous column
        this.db.exec(`
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
            confidence      REAL    NOT NULL DEFAULT 1.0,
            metadata        TEXT    NOT NULL DEFAULT '{}'
          );
        `);
 
        // 6. copy all data — explicit columns, previous intentionally excluded
        this.db.exec(`
          INSERT INTO facts
            (id, key, value, container, created_at, updated_at,
             memory_type, document_date, event_date, expires_at, is_latest,
             superseded_by, superseded_from, relation_type, related_to, confidence, metadata)
          SELECT
            id, key, value, container, created_at, updated_at,
            memory_type, document_date, event_date, expires_at, is_latest,
            superseded_by, superseded_from, relation_type, related_to, confidence, metadata
          FROM facts_old;
        `);
 
        // 7. drop old table
        this.db.exec(`DROP TABLE facts_old`);
 
        // 8. recreate triggers on new facts table
        this.db.exec(`
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
        `);
 
        // 9. rebuild FTS5 index — rescans all rows in new facts table
        this.db.exec(`INSERT INTO facts_fts(facts_fts) VALUES('rebuild')`);
 
      })();
    }

    // ── embeddings table rebuild ──────────────────────────────────────────────
    // remove UNIQUE(fact_key, container) and rename fact_key → fact_id INTEGER
    // each fact version now has its own embedding row keyed by fact_id
 
    const embeddingsDef = this.db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='embeddings'`
    ).get();
 
    const needsEmbeddingsRebuild = embeddingsDef?.sql?.includes('UNIQUE(fact_key, container)');
 
    if (needsEmbeddingsRebuild) {
      this.db.transaction(() => {
        // 1. rename old table
        this.db.exec(`ALTER TABLE embeddings RENAME TO embeddings_old`);
 
        // 2. create new embeddings table — fact_id INTEGER, no UNIQUE constraint
        this.db.exec(`
          CREATE TABLE embeddings (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            fact_id    INTEGER NOT NULL REFERENCES facts(id),
            container  TEXT    NOT NULL DEFAULT 'default',
            vector     TEXT    NOT NULL,
            model      TEXT    NOT NULL DEFAULT 'mxbai-embed-large',
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
          );
        `);
 
        // 3. copy existing embeddings — join on fact_key to get fact_id
        // existing embeddings point to the current (is_latest=1) version of each fact
        this.db.exec(`
          INSERT INTO embeddings (fact_id, container, vector, model, created_at)
          SELECT f.id, e.container, e.vector, e.model, e.created_at
          FROM embeddings_old e
          JOIN facts f ON e.fact_key = f.key AND e.container = f.container
          WHERE f.is_latest = 1;
        `);
 
        // 4. drop old table
        this.db.exec(`DROP TABLE embeddings_old`);
 
      })();
    }

    // ── ALTER TABLE ADD COLUMN loop ───────────────────────────────────────────
    // for fresh installs the new tables already have all columns
    // this loop handles any edge case where rebuild was skipped

    const existing = new Set(
      this.db.pragma('table_info(facts)').map(c => c.name)
    );
 
    const columns = [
      ['memory_type',     "TEXT    NOT NULL DEFAULT 'fact'"],
      ['document_date',   'TEXT'],
      ['event_date',      'TEXT'],
      ['expires_at',      'TEXT'],
      ['is_latest',       'INTEGER NOT NULL DEFAULT 1'],
      ['superseded_by',   'INTEGER'],
      ['superseded_from', 'INTEGER'],
      ['relation_type',   'TEXT'],
      ['related_to',      'INTEGER'],
      ['confidence',      'REAL    NOT NULL DEFAULT 1.0'],
      ['metadata',        "TEXT    NOT NULL DEFAULT '{}'"],
    ];
 
    for (const [col, def] of columns) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE facts ADD COLUMN ${col} ${def}`);
      }
    }

    // backfill defaults on existing v0.2.x rows
    this.db.exec(`
      UPDATE facts SET
        document_date = COALESCE(created_at, datetime('now')),
        memory_type   = 'fact',
        is_latest     = 1,
        confidence    = 1.0,
        metadata      = '{}'
      WHERE document_date IS NULL;
    `);
 
    // performance indexes — safe to run every time, IF NOT EXISTS guards them
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_facts_latest  ON facts(container, is_latest);
      CREATE INDEX IF NOT EXISTS idx_facts_type    ON facts(container, memory_type);
      CREATE INDEX IF NOT EXISTS idx_facts_docdate ON facts(container, document_date);
      CREATE INDEX IF NOT EXISTS idx_facts_expires ON facts(expires_at) WHERE expires_at IS NOT NULL;
    `);
  }

  // ── Facts ──────────────────────────────────────────

  loadFacts() {
    return this.db
      .prepare(`
        SELECT key, value, memory_type, confidence, event_date
        FROM facts
        WHERE container = ?
          AND is_latest = 1
          AND (expires_at IS NULL OR expires_at > datetime('now'))
      `)
      .all(this.container);
  }

  supersedeFact(oldId, newId) {
    this.db.prepare(`
      UPDATE facts SET is_latest = 0, superseded_by = ? WHERE id = ?
    `).run(newId, oldId);
  }

  saveFact(key, value, opts = {}) {
    const {
      memory_type     = 'fact',
      document_date   = new Date().toISOString().slice(0, 10),
      event_date      = null,
      expires_at      = null,
      confidence      = 1.0,
      relation_type   = null,
      related_to      = null,
      superseded_from = null,
      metadata        = '{}',
    } = opts;
 
    const result = this.db.prepare(`
      INSERT INTO facts
        (key, value, container, memory_type, document_date, event_date,
         expires_at, is_latest, confidence, relation_type, related_to,
         superseded_from, metadata, updated_at)
      VALUES
        (@key, @value, @container, @memory_type, @document_date, @event_date,
         @expires_at, 1, @confidence, @relation_type, @related_to,
         @superseded_from, @metadata, datetime('now'))
    `).run({
      key,
      value:           typeof value === 'string' ? value : JSON.stringify(value),
      container:       this.container,
      memory_type,
      document_date,
      event_date,
      expires_at,
      confidence,
      relation_type,
      related_to,
      superseded_from,
      metadata:        typeof metadata === 'string' ? metadata : JSON.stringify(metadata),
    });
 
    return result.lastInsertRowid;
  }

  // ── Embeddings ─────────────────────────────────────

  saveEmbedding(factId, vector) {
    this.db.prepare(`
      INSERT INTO embeddings (fact_id, container, vector)
      VALUES (?, ?, ?)
    `).run(factId, this.container, JSON.stringify(vector));
  }

  // ── Chunks ─────────────────────────────────────────

  saveChunk(content, sessionId = null) {
    this.db.prepare(`
      INSERT INTO chunks (content, container, session_id)
      VALUES (?, ?, ?)
    `).run(content, this.container, sessionId);
  }

  getLastChunkId() {
    const row = this.db.prepare(`
      SELECT id FROM chunks
      WHERE container = ?
      ORDER BY id DESC LIMIT 1
    `).get(this.container);
    return row?.id ?? null;
  }

  saveChunkEmbedding(chunkId, vector) {
    this.db.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, container, vector)
      VALUES (?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET vector = ?
    `).run(
      chunkId,
      this.container,
      JSON.stringify(vector),
      JSON.stringify(vector)
    );
  }

  // ── Search ─────────────────────────────────────────

  bm25Search(query, container, topN = 10) {
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .join(" OR ");
 
    const rows = this.db.prepare(`
      SELECT
        f.key,
        f.value,
        f.memory_type,
        f.confidence,
        f.event_date,
        bm25(facts_fts) AS score
      FROM facts_fts
      JOIN facts f ON facts_fts.rowid = f.id
      WHERE facts_fts MATCH ?
        AND f.container = ?
        AND f.is_latest = 1
        AND (f.expires_at IS NULL OR f.expires_at > datetime('now'))
      ORDER BY score
      LIMIT ?
    `).all(ftsQuery, container, topN);
 
    return rows.map((r, index) => ({
      key:         r.key,
      value:       r.value,
      memory_type: r.memory_type,
      confidence:  r.confidence,
      event_date:  r.event_date,
      rank:        index + 1,
      score:       r.score,
    }));
  }

  bm25SearchChunks(query, container, topN = 10) {
    const ftsQuery = query.trim().split(/\s+/).join(" OR ");

    const rows = this.db.prepare(`
      SELECT
        c.id,
        c.content,
        bm25(chunks_fts) AS score
      FROM chunks_fts
      JOIN chunks c ON chunks_fts.rowid = c.id
      WHERE chunks_fts MATCH ?
      AND c.container = ?
      ORDER BY score
      LIMIT ?
    `).all(ftsQuery, container, topN);

    return rows.map((r, index) => ({
      key: `chunk_${r.id}`,
      value: r.content,
      rank: index + 1,
      score: r.score,
      type: "chunk",
    }));
  }

  vectorSearch(queryVector, container, topN = 10) {
    // join on fact_id — each embedding row points to a specific fact version
    const rows = this.db.prepare(`
      SELECT e.fact_id, f.key, e.vector, f.value, f.memory_type, f.confidence, f.event_date
      FROM embeddings e
      JOIN facts f ON e.fact_id = f.id
      WHERE e.container = ?
        AND f.is_latest = 1
        AND (f.expires_at IS NULL OR f.expires_at > datetime('now'))
    `).all(container);
 
    const scored = rows
      .map(row => ({
        id:          row.fact_id,
        key:         row.key,
        value:       row.value,
        memory_type: row.memory_type,
        confidence:  row.confidence,
        event_date:  row.event_date,
        score:       this._cosineSimilarity(queryVector, JSON.parse(row.vector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);
 
    return scored.map((r, index) => ({ ...r, rank: index + 1 }));
  }
 

  vectorSearchChunks(queryVector, container, topN = 10) {
    const rows = this.db.prepare(`
      SELECT c.id, c.content, ce.vector
      FROM chunks c
      JOIN chunk_embeddings ce ON c.id = ce.chunk_id
      WHERE c.container = ?
    `).all(container);

    const scored = rows
      .map((row) => ({
        key: `chunk_${row.id}`,
        value: row.content,
        score: this._cosineSimilarity(queryVector, JSON.parse(row.vector)),
        type: "chunk",
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    return scored.map((r, index) => ({ ...r, rank: index + 1 }));
  }

  //RRF fusion method
  hybridSearch(query, queryVector, container, topN = 5) {
    const k = 60; // RRF constant — industry standard

    // run all 4 searches
    let bm25FactResults = [];
    try {
      bm25FactResults = this.bm25Search(query, container, topN * 2);
    } catch (e) {
      // query might have special chars — fallback to vector only
    }

    let bm25ChunkResults = [];
    try {
      bm25ChunkResults = this.bm25SearchChunks(query, container, topN * 2);
    } catch (e) {}

    const vectorFactResults = this.vectorSearch(queryVector, container, topN * 2);
    const vectorChunkResults = this.vectorSearchChunks(queryVector, container, topN * 2);

    // build RRF score map
    const scores = {};
    
    const addScore = (key, value, rank, source, type) => {
      if (!scores[key]) scores[key] = { key, value, rrf: 0, sources: [], type };
      scores[key].rrf += 1 / (k + rank);
      scores[key].sources.push(source);
    };

    bm25FactResults.forEach((r) => addScore(r.key, r.value, r.rank, "bm25", "fact"));
    vectorFactResults.forEach((r) => addScore(r.key, r.value, r.rank, "vector", "fact"));
    bm25ChunkResults.forEach((r) => addScore(r.key, r.value, r.rank, "bm25", "chunk"));
    vectorChunkResults.forEach((r) => addScore(r.key, r.value, r.rank, "vector", "chunk"));

    // sort by RRF score, return top N
    return Object.values(scores)
      .sort((a, b) => b.rrf - a.rrf)
      .slice(0, topN);
  }

  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    const dot = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }

  // ── Clear ──────────────────────────────────────────

  clear() {
    this.db.prepare(`DELETE FROM facts WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM embeddings WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM chunks WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM chunk_embeddings WHERE container = ?`).run(this.container);
  }
}