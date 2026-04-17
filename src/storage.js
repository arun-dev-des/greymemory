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
        chunk_id      INTEGER,
        confidence    REAL    NOT NULL DEFAULT 1.0,
        metadata      TEXT    NOT NULL DEFAULT '{}',
        source_role   TEXT
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
        source_role TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id    INTEGER NOT NULL REFERENCES chunks(id),
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
          ['memory_type',     "TEXT    NOT NULL DEFAULT 'fact'"],
          ['document_date',   'TEXT'],
          ['event_date',      'TEXT'],
          ['expires_at',      'TEXT'],
          ['is_latest',       'INTEGER NOT NULL DEFAULT 1'],
          ['superseded_by',   'INTEGER'],
          ['superseded_from', 'INTEGER'],
          ['relation_type',   'TEXT'],
          ['related_to',      'INTEGER'],
          ['chunk_id',        'INTEGER'],
          ['confidence',      'REAL    NOT NULL DEFAULT 1.0'],
          ['metadata',        "TEXT    NOT NULL DEFAULT '{}'"],
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
            chunk_id        INTEGER,
            confidence      REAL    NOT NULL DEFAULT 1.0,
            metadata        TEXT    NOT NULL DEFAULT '{}'
          );
        `);
 
        // 6. copy all data — explicit columns, previous intentionally excluded
        this.db.exec(`
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
      ['chunk_id',        'INTEGER'],
      ['confidence',      'REAL    NOT NULL DEFAULT 1.0'],
      ['metadata',        "TEXT    NOT NULL DEFAULT '{}'"],
      ['source_role',     'TEXT'],
    ];
 
    for (const [col, def] of columns) {
      if (!existing.has(col)) {
        this.db.exec(`ALTER TABLE facts ADD COLUMN ${col} ${def}`);
      }
    }

    // add source_role to chunks if missing
    const chunkCols = new Set(
      this.db.pragma('table_info(chunks)').map(c => c.name)
    )
    if (!chunkCols.has('source_role')) {
      this.db.exec(`ALTER TABLE chunks ADD COLUMN source_role TEXT`)
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

    // ── chunk_embeddings rebuild ──────────────────────────────────────────────
    // add REFERENCES chunks(id) — missing from original v0.2 definition
    // chunk_embeddings data is regenerated on every add() — safe to drop and recreate
 
    const chunkEmbDef = this.db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='chunk_embeddings'`
    ).get();
 
    const needsChunkEmbRebuild = chunkEmbDef?.sql &&
      !chunkEmbDef.sql.includes('REFERENCES chunks(id)');
 
    if (needsChunkEmbRebuild) {
      this.db.transaction(() => {
        this.db.exec(`DROP TABLE chunk_embeddings`);
        this.db.exec(`
          CREATE TABLE chunk_embeddings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            chunk_id    INTEGER NOT NULL REFERENCES chunks(id),
            container   TEXT NOT NULL DEFAULT 'default',
            vector      TEXT NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(chunk_id)
          );
        `);
      })();
    }
  }

  // ── Facts ──────────────────────────────────────────

  loadFacts(asOf = null) {
    // expires check relative to asOf when time-travelling, today otherwise
    // ensures episodes valid at asOf are included even if expired today
    const expiresCheck = asOf
      ? `AND (expires_at IS NULL OR expires_at > ?)`
      : `AND (expires_at IS NULL OR expires_at > datetime('now'))`

    const params = asOf
      ? [this.container, asOf]
      : [this.container]

    return this.db
      .prepare(`
        SELECT
          id, key, value, container,
          memory_type, confidence,
          document_date, event_date, expires_at,
          is_latest, superseded_by, superseded_from,
          relation_type, related_to, chunk_id, source_role,
          metadata, created_at, updated_at
        FROM facts
        WHERE container = ?
          AND is_latest = 1
          ${expiresCheck}
        ORDER BY created_at ASC
      `)
      .all(...params);
  }

  supersedeFact(oldId, newId) {
    this.db.prepare(`
      UPDATE facts SET is_latest = 0, superseded_by = ? WHERE id = ?
    `).run(newId, oldId);
  }

  saveFact(key, value, opts = {}) {
    const {
      memory_type     = 'fact',
      document_date   = null,
      event_date      = null,
      expires_at      = null,
      confidence      = 1.0,
      relation_type   = null,
      related_to      = null,
      superseded_from = null,
      chunk_id        = null,
      source_role     = null,
      metadata        = '{}',
    } = opts;
 
    const result = this.db.prepare(`
      INSERT INTO facts
        (key, value, container, memory_type, document_date, event_date,
         expires_at, is_latest, confidence, relation_type, related_to,
         superseded_from, chunk_id, source_role, metadata, updated_at)
      VALUES
        (@key, @value, @container, @memory_type, @document_date, @event_date,
         @expires_at, 1, @confidence, @relation_type, @related_to,
         @superseded_from, @chunk_id, @source_role, @metadata, datetime('now'))
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
      chunk_id,
      source_role,
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

  saveChunk(content, sessionId = null, sourceRole = null) {
    this.db.prepare(`
      INSERT INTO chunks (content, container, session_id, source_role)
      VALUES (?, ?, ?, ?)
    `).run(content, this.container, sessionId, sourceRole);
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

  bm25Search(query, container, topN = 10, asOf = null) {
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .join(" OR ");

    // asOf time-travel: replace is_latest=1 with the "current at asOf" predicate
    const versionClause = asOf
      ? `AND f.document_date <= @asOf
         AND (
           f.superseded_by IS NULL
           OR EXISTS (
             SELECT 1 FROM facts s
             WHERE s.id = f.superseded_by
               AND s.document_date > @asOf
           )
         )`
      : `AND f.is_latest = 1`;

    // expires check: compare against asOf when time-travelling, today otherwise
    // an episode expiring 2023-01-16 was still valid on asOf 2023-01-15
    const expiresClause = asOf
      ? `AND (f.expires_at IS NULL OR f.expires_at > @asOf)`
      : `AND (f.expires_at IS NULL OR f.expires_at > datetime('now'))`;  

    const rows = this.db.prepare(`
      SELECT
        f.id,
        f.key,
        f.value,
        f.memory_type,
        f.confidence,
        f.document_date,
        f.event_date,
        f.relation_type,
        f.chunk_id,
        f.source_role,
        bm25(facts_fts) AS score
      FROM facts_fts
      JOIN facts f ON facts_fts.rowid = f.id
      WHERE facts_fts MATCH @query
        AND f.container = @container
        ${versionClause}
        ${expiresClause}
      ORDER BY score
      LIMIT @topN
    `).all({ query: ftsQuery, container, topN, asOf });

    return rows.map((r, index) => ({
      id:            r.id,
      key:           r.key,
      value:         r.value,
      memory_type:   r.memory_type,
      confidence:    r.confidence,
      document_date: r.document_date,
      event_date:    r.event_date,
      relation_type: r.relation_type,
      chunk_id:      r.chunk_id,
      source_role: r.source_role,
      rank:          index + 1,
      score:         r.score,
    }));
  }

  vectorSearch(queryVector, container, topN = 10, asOf = null) {
    // asOf time-travel: replace is_latest=1 with the "current at asOf" predicate
    const versionClause = asOf
      ? `AND f.document_date <= @asOf
        AND (
          f.superseded_by IS NULL
          OR EXISTS (
            SELECT 1 FROM facts s
            WHERE s.id = f.superseded_by
              AND s.document_date > @asOf
          )
        )`
      : `AND f.is_latest = 1`;

    // expires check: compare against asOf when time-travelling, today otherwise
    // an episode expiring 2023-01-16 was still valid on asOf 2023-01-15
    const expiresClause = asOf
      ? `AND (f.expires_at IS NULL OR f.expires_at > @asOf)`
      : `AND (f.expires_at IS NULL OR f.expires_at > datetime('now'))`;

    // join on fact_id — each embedding row points to a specific fact version
    const rows = this.db.prepare(`
      SELECT e.fact_id, f.key, e.vector, f.value, f.memory_type, f.confidence,
            f.document_date, f.event_date, f.relation_type, f.chunk_id,
            f.source_role
      FROM embeddings e
      JOIN facts f ON e.fact_id = f.id
      WHERE e.container = @container
        ${versionClause}
        ${expiresClause}
    `).all({ container, asOf });

    const scored = rows
      .map(row => ({
        id:            row.fact_id,
        key:           row.key,
        value:         row.value,
        memory_type:   row.memory_type,
        confidence:    row.confidence,
        document_date: row.document_date,
        event_date:    row.event_date,
        relation_type: row.relation_type,
        chunk_id:      row.chunk_id,
        source_role: row.source_role,
        score:         this._cosineSimilarity(queryVector, JSON.parse(row.vector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    return scored.map((r, index) => ({ ...r, rank: index + 1 }));
  }

  //RRF fusion method
  hybridSearch(query, queryVector, container, topN = 5, asOf = null) {
    const k = 60;

    // TODO: handle shared chat content (e.g. user pastes a GPT conversation)
    // current assumption: all input.role='assistant' refers to greymemory's assistant
    // fix: add sourceType option to add() — sourceType:'shared_chat' changes extraction framing

    // detect if query is asking about something the assistant said
    const isAssistantQuery = /\b(you say|you said|you mentioned|you recommended|you suggested|you told|you explained|you stated|did you say|did you mention|did you recommend|did you suggest|what did you|which did you|remind me what you|remind me which|remind me of the|can you remind|could you remind|you gave|you provided|you described|you listed|you showed)\b/i.test(query)

    // ── fact-level search ──────────────────────────────────────
    let bm25Results = [];
    try {
      bm25Results = this.bm25Search(query, container, topN * 2, asOf);
    } catch (e) {}

    const vectorResults = this.vectorSearch(queryVector, container, topN * 2, asOf);

    // ── chunk-level search (fallback for sessions with no extracted facts) ──
    const chunkBm25    = this.chunkBm25Search(query, container, topN * 2)
    const chunkVector  = this.chunkVectorSearch(queryVector, container, topN * 2)

    // RRF fusion — keyed by fact id to preserve full fact data
    // RRF fusion — namespace keys to avoid id collisions between facts and chunks
    const scores = {}

    const addFactScore = (fact, rank, source) => {
      const key = `fact_${fact.id}`
      if (!scores[key]) {
        scores[key] = {
          ...fact,
          _type:    'fact',
          _key:     key,
          rrf:      0,
          sources:  [],
        }
      }
      let weight = fact.memory_type === 'preference'
        ? (fact.confidence ?? 1.0)
        : 1.0
      if (isAssistantQuery && fact.source_role === 'assistant') {
        weight *= 2.0
      }
      scores[key].rrf += (1 / (k + rank)) * weight
      scores[key].sources.push(source)
    }

    const addChunkScore = (chunk, rank, source) => {
      const key = `chunk_${chunk.chunk_id}`
      if (!scores[key]) {
        scores[key] = {
          chunk_id:    chunk.chunk_id,
          content:     chunk.content,
          source_role: chunk.source_role,
          created_at:  chunk.created_at,
          _type:       'chunk',
          _key:        key,
          rrf:         0,
          sources:     [],
        }
      }
      // chunks get 0.8x weight — facts preferred when both exist for same content
      let weight = 1.0
      if (isAssistantQuery && chunk.source_role === 'assistant') {
        weight *= 2.0
      }
      scores[key].rrf += (1 / (k + rank)) * weight
      scores[key].sources.push(source)
    }
 
    bm25Results.forEach(r   => addFactScore(r, r.rank, 'bm25'))
    vectorResults.forEach(r => addFactScore(r, r.rank, 'vector'))
    chunkBm25.forEach(r     => addChunkScore(r, r.rank, 'chunk_bm25'))
    chunkVector.forEach(r   => addChunkScore(r, r.rank, 'chunk_vector'))
 
    // sort by RRF score
    const ranked = Object.values(scores)
      .sort((a, b) => b.rrf - a.rrf)

    // deduplicate: if a fact already covers a chunk (via fact.chunk_id),
    // remove the standalone chunk result — the fact version is richer
    const coveredChunkIds = new Set(
      ranked
        .filter(r => r._type === 'fact' && r.chunk_id)
        .map(r => r.chunk_id)
    )

    const deduped = ranked.filter(r => {
      if (r._type === 'chunk' && coveredChunkIds.has(r.chunk_id)) return false
      return true
    })

    return deduped.slice(0, topN)
  }

  // get chunk using id
  getChunk(chunkId) {
    if (!chunkId) return null;
    const row = this.db.prepare(`
      SELECT content FROM chunks WHERE id = ?
    `).get(chunkId);
    return row?.content ?? null;
  }

  // ── Chunk Search ───────────────────────────────────

  chunkBm25Search(query, container, topN = 10) {
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .join(' OR ')

    let rows = []
    try {
      rows = this.db.prepare(`
        SELECT c.id AS chunk_id, c.content, c.source_role, c.created_at,
               bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH @query
          AND c.container = @container
        ORDER BY score
        LIMIT @topN
      `).all({ query: ftsQuery, container, topN })
    } catch {}

    return rows.map((r, index) => ({
      chunk_id:    r.chunk_id,
      content:     r.content,
      source_role: r.source_role,
      created_at:  r.created_at,
      rank:        index + 1,
      score:       r.score,
    }))
  }

  chunkVectorSearch(queryVector, container, topN = 10) {
    const rows = this.db.prepare(`
      SELECT ce.chunk_id, ce.vector, c.content, c.source_role, c.created_at
      FROM chunk_embeddings ce
      JOIN chunks c ON ce.chunk_id = c.id
      WHERE ce.container = @container
    `).all({ container })

    const scored = rows
      .map(row => ({
        chunk_id:    row.chunk_id,
        content:     row.content,
        source_role: row.source_role,
        created_at:  row.created_at,
        score:       this._cosineSimilarity(queryVector, JSON.parse(row.vector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)

    return scored.map((r, index) => ({ ...r, rank: index + 1 }))
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
    // delete child rows before parents — embeddings/chunk_embeddings have FK
    // references to facts/chunks, and better-sqlite3 enforces foreign keys
    this.db.prepare(`DELETE FROM embeddings WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM chunk_embeddings WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM facts WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM chunks WHERE container = ?`).run(this.container);
  }
}