import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

// Schema version stamped into greymemory_meta on creation. A meta TABLE (not
// PRAGMA user_version) because callers can hand us their own database
// (`new GreyMemory({ db })`) and user_version belongs to them.
const SCHEMA_VERSION = "51";

export class Storage {
  constructor(dir = ".greymemory-lite", container = "default", existingDb = null) {
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

    // WAL + busy_timeout always — multiple processes (hooks, MCP servers,
    // consoles) routinely share one memory DB; without WAL a concurrent
    // write throws SQLITE_BUSY. Idempotent, safe on caller-supplied dbs.
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");

    this._guardSchema();
    this._init();
  }

  // Fail-loud schema guard. greymemory-lite has no migration machinery by
  // design: a `facts` table that we didn't stamp is either a full-greymemory
  // (v0.x) database or an unrelated table in a caller-supplied db. Refuse
  // both rather than silently mangling them.
  _guardSchema() {
    const factsExists = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='facts'`)
      .get();
    if (!factsExists) return;

    const metaExists = this.db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='greymemory_meta'`)
      .get();
    const version = metaExists
      ? this.db.prepare(`SELECT value FROM greymemory_meta WHERE key='schema_version'`).get()?.value
      : null;

    if (version !== SCHEMA_VERSION) {
      throw new Error(
        `[greymemory-lite] this database was not created by greymemory-lite ` +
        `(found a 'facts' table with schema version ${version ?? "unknown"}). ` +
        `Use a fresh directory and re-ingest, or pin the full 'greymemory' package for old databases.`
      );
    }
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS greymemory_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS facts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        key           TEXT    NOT NULL,
        value         TEXT    NOT NULL,
        container     TEXT    NOT NULL DEFAULT 'default',
        memory_type   TEXT    NOT NULL DEFAULT 'fact',
        document_date TEXT,
        event_date    TEXT,
        expires_at    TEXT,
        chunk_id      INTEGER REFERENCES chunks(id),
        source_role   TEXT,
        created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_id    INTEGER NOT NULL REFERENCES facts(id),
        container  TEXT    NOT NULL DEFAULT 'default',
        vector     BLOB    NOT NULL,
        created_at TEXT    NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        content      TEXT NOT NULL,
        container    TEXT NOT NULL DEFAULT 'default',
        session_id   TEXT,
        content_hash TEXT,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS chunk_embeddings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id   INTEGER NOT NULL REFERENCES chunks(id),
        container  TEXT NOT NULL DEFAULT 'default',
        vector     BLOB NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
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

      CREATE INDEX IF NOT EXISTS idx_facts_type    ON facts(container, memory_type);
      CREATE INDEX IF NOT EXISTS idx_facts_docdate ON facts(container, document_date);
      CREATE INDEX IF NOT EXISTS idx_facts_expires ON facts(expires_at) WHERE expires_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_chunks_dedup  ON chunks(container, session_id, content_hash)
        WHERE session_id IS NOT NULL AND content_hash IS NOT NULL;
    `);

    this.db.prepare(`
      INSERT INTO greymemory_meta (key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(SCHEMA_VERSION);
  }

  // ── Vector encoding ─────────────────────────────────
  // Vectors are stored as Float32Array bytes — ~3x smaller than JSON text and
  // read back with zero parsing (the Buffer's bytes ARE the floats).

  _vectorToBlob(vector) {
    return Buffer.from(new Float32Array(vector).buffer);
  }

  _vectorFromBlob(blob) {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }

  // ── Facts ──────────────────────────────────────────

  loadFacts(asOf = null) {
    // expires check relative to asOf when time-travelling, today otherwise —
    // ensures episodes valid at asOf are included even if expired today
    const expiresCheck = asOf
      ? `AND (expires_at IS NULL OR expires_at > ?)`
      : `AND (expires_at IS NULL OR expires_at > datetime('now'))`;

    const params = asOf ? [this.container, asOf] : [this.container];

    return this.db
      .prepare(`
        SELECT
          id, key, value, container,
          memory_type, document_date, event_date, expires_at,
          chunk_id, source_role, created_at, updated_at
        FROM facts
        WHERE container = ?
          ${expiresCheck}
        ORDER BY created_at ASC
      `)
      .all(...params);
  }

  saveFact(key, value, opts = {}) {
    const {
      memory_type   = "fact",
      document_date = null,
      event_date    = null,
      expires_at    = null,
      chunk_id      = null,
      source_role   = null,
    } = opts;

    const result = this.db.prepare(`
      INSERT INTO facts
        (key, value, container, memory_type, document_date, event_date,
         expires_at, chunk_id, source_role, updated_at)
      VALUES
        (@key, @value, @container, @memory_type, @document_date, @event_date,
         @expires_at, @chunk_id, @source_role, datetime('now'))
    `).run({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
      container: this.container,
      memory_type,
      document_date,
      event_date,
      expires_at,
      chunk_id,
      source_role,
    });

    return result.lastInsertRowid;
  }

  saveEmbedding(factId, vector) {
    this.db.prepare(`
      INSERT INTO embeddings (fact_id, container, vector)
      VALUES (?, ?, ?)
    `).run(factId, this.container, this._vectorToBlob(vector));
  }

  // The only fact write path Memory uses: fact + embedding land atomically.
  // A crash between the two would otherwise leave a fact invisible to the
  // vector channel forever.
  saveFactWithEmbedding(key, value, opts, vector) {
    const insertBoth = this.db.transaction(() => {
      const factId = this.saveFact(key, value, opts);
      this.saveEmbedding(factId, vector);
      return factId;
    });
    return insertBoth();
  }

  // ── Chunks ─────────────────────────────────────────

  // Returns the new chunk's id (lastInsertRowid) so the caller can attribute
  // facts/embeddings to it directly — no follow-up SELECT needed.
  saveChunk(content, sessionId = null, documentDate = null, contentHash = null) {
    const result = this.db.prepare(`
      INSERT INTO chunks (content, container, session_id, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(content, this.container, sessionId, contentHash, documentDate ?? new Date().toISOString());

    return result.lastInsertRowid;
  }

  // dedupBySession: has a round with this content hash already been ingested
  // under this sessionId in this container? Container-scoped, so dedup never
  // crosses containers. Returns false unless both args are present.
  chunkExists(sessionId, contentHash) {
    if (sessionId == null || contentHash == null) return false;
    const row = this.db.prepare(`
      SELECT 1 FROM chunks
      WHERE container = ? AND session_id = ? AND content_hash = ?
      LIMIT 1
    `).get(this.container, sessionId, contentHash);
    return !!row;
  }

  saveChunkEmbedding(chunkId, vector) {
    const blob = this._vectorToBlob(vector);
    this.db.prepare(`
      INSERT INTO chunk_embeddings (chunk_id, container, vector)
      VALUES (?, ?, ?)
      ON CONFLICT(chunk_id) DO UPDATE SET vector = excluded.vector
    `).run(chunkId, this.container, blob);
  }

  // Soft delete: expire a fact as of the given date — excluded from every
  // query whose expiry check runs after that date. Row preserved for audit.
  expireFact(factId, dateStr) {
    this.db.prepare(`
      UPDATE facts SET expires_at = ?, updated_at = datetime('now') WHERE id = ?
    `).run(dateStr, factId);
  }

  getChunk(chunkId) {
    if (!chunkId) return null;
    const row = this.db.prepare(`
      SELECT content FROM chunks WHERE id = ?
    `).get(chunkId);
    return row?.content ?? null;
  }

  // ── Search ─────────────────────────────────────────

  // FTS5 MATCH input built from a free-text query. Each whitespace token is
  // double-quoted (embedded quotes doubled) so apostrophes, hyphens, colons
  // and parens are literal text instead of FTS5 syntax — 'O'Brien's plan'
  // used to throw inside MATCH and silently drop the whole BM25 channel.
  _ftsQuery(query) {
    const tokens = String(query ?? "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return null;
    return tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(" OR ");
  }

  // asOf is a plain temporal cutoff: facts recorded after asOf are invisible.
  // (No version predicate — lite has no supersession; the reader resolves
  // contradictions from the chronologically sorted results.)
  _factPredicates(asOf) {
    const asOfClause = asOf ? `AND f.document_date <= @asOf` : ``;
    const expiresClause = asOf
      ? `AND (f.expires_at IS NULL OR f.expires_at > @asOf)`
      : `AND (f.expires_at IS NULL OR f.expires_at > datetime('now'))`;
    return `${asOfClause}\n        ${expiresClause}`;
  }

  bm25Search(query, container, topN = 10, asOf = null) {
    const ftsQuery = this._ftsQuery(query);
    if (!ftsQuery) return [];

    const rows = this.db.prepare(`
      SELECT
        f.id,
        f.key,
        f.value,
        f.memory_type,
        f.document_date,
        f.event_date,
        f.expires_at,
        f.chunk_id,
        f.source_role,
        c.session_id AS session_id,
        bm25(facts_fts) AS score
      FROM facts_fts
      JOIN facts f ON facts_fts.rowid = f.id
      LEFT JOIN chunks c ON c.id = f.chunk_id
      WHERE facts_fts MATCH @query
        AND f.container = @container
        ${this._factPredicates(asOf)}
      ORDER BY score
      LIMIT @topN
    `).all({ query: ftsQuery, container, topN, asOf });

    return rows.map((r, index) => ({
      id:            r.id,
      key:           r.key,
      value:         r.value,
      memory_type:   r.memory_type,
      document_date: r.document_date,
      event_date:    r.event_date,
      expires_at:    r.expires_at,
      chunk_id:      r.chunk_id,
      source_role:   r.source_role,
      session_id:    r.session_id ?? null,
      rank:          index + 1,
      score:         r.score,
    }));
  }

  vectorSearch(queryVector, container, topN = 10, asOf = null) {
    const rows = this.db.prepare(`
      SELECT e.fact_id, f.key, e.vector, f.value, f.memory_type,
             f.document_date, f.event_date, f.expires_at, f.chunk_id,
             f.source_role, c.session_id AS session_id
      FROM embeddings e
      JOIN facts f ON e.fact_id = f.id
      LEFT JOIN chunks c ON c.id = f.chunk_id
      WHERE e.container = @container
        ${this._factPredicates(asOf)}
    `).all({ container, asOf });

    this._assertEmbeddingDim(queryVector, rows);

    const scored = rows
      .map(row => ({
        id:            row.fact_id,
        key:           row.key,
        value:         row.value,
        memory_type:   row.memory_type,
        document_date: row.document_date,
        event_date:    row.event_date,
        expires_at:    row.expires_at,
        chunk_id:      row.chunk_id,
        source_role:   row.source_role,
        session_id:    row.session_id ?? null,
        score:         this._cosineSimilarity(queryVector, this._vectorFromBlob(row.vector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    return scored.map((r, index) => ({ ...r, rank: index + 1 }));
  }

  chunkBm25Search(query, container, topN = 10, asOf = null) {
    const ftsQuery = this._ftsQuery(query);
    if (!ftsQuery) return [];

    // chunks carry their session date in created_at — the asOf cutoff keeps
    // future sessions invisible during time-travel, same as the fact channels.
    const asOfClause = asOf ? `AND c.created_at <= @asOf` : ``;
    const params = asOf ? { query: ftsQuery, container, topN, asOf } : { query: ftsQuery, container, topN };

    let rows = [];
    try {
      rows = this.db.prepare(`
        SELECT c.id AS chunk_id, c.content, c.created_at, c.session_id,
               bm25(chunks_fts) AS score
        FROM chunks_fts
        JOIN chunks c ON chunks_fts.rowid = c.id
        WHERE chunks_fts MATCH @query
          AND c.container = @container
          ${asOfClause}
        ORDER BY score
        LIMIT @topN
      `).all(params);
    } catch {
      // last-resort guard; _ftsQuery quoting should make this unreachable
    }

    return rows.map((r, index) => ({
      chunk_id:   r.chunk_id,
      content:    r.content,
      created_at: r.created_at,
      session_id: r.session_id ?? null,
      rank:       index + 1,
      score:      r.score,
    }));
  }

  chunkVectorSearch(queryVector, container, topN = 10, asOf = null) {
    const asOfClause = asOf ? `AND c.created_at <= @asOf` : ``;
    const params = asOf ? { container, asOf } : { container };
    const rows = this.db.prepare(`
      SELECT ce.chunk_id, ce.vector, c.content, c.created_at, c.session_id
      FROM chunk_embeddings ce
      JOIN chunks c ON ce.chunk_id = c.id
      WHERE ce.container = @container
        ${asOfClause}
    `).all(params);

    this._assertEmbeddingDim(queryVector, rows);

    const scored = rows
      .map(row => ({
        chunk_id:   row.chunk_id,
        content:    row.content,
        created_at: row.created_at,
        session_id: row.session_id ?? null,
        score:      this._cosineSimilarity(queryVector, this._vectorFromBlob(row.vector)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topN);

    return scored.map((r, index) => ({ ...r, rank: index + 1 }));
  }

  // RRF fusion over four channels: fact BM25, fact vector, chunk BM25, chunk
  // vector. Flat rank-based weights — no query-shape heuristics, no
  // confidence boosts.
  hybridSearch(query, queryVector, container, topN = 5, asOf = null) {
    const k = 60;

    const bm25Results   = this.bm25Search(query, container, topN * 2, asOf);
    const vectorResults = this.vectorSearch(queryVector, container, topN * 2, asOf);
    const chunkBm25     = this.chunkBm25Search(query, container, topN * 2, asOf);
    const chunkVector   = this.chunkVectorSearch(queryVector, container, topN * 2, asOf);

    // keys are namespaced to avoid id collisions between facts and chunks
    const scores = {};

    const addFactScore = (fact, rank, source) => {
      const key = `fact_${fact.id}`;
      if (!scores[key]) {
        scores[key] = { ...fact, _type: "fact", _key: key, rrf: 0, sources: [] };
      }
      scores[key].rrf += 1 / (k + rank);
      scores[key].sources.push(source);
    };

    const addChunkScore = (chunk, rank, source) => {
      const key = `chunk_${chunk.chunk_id}`;
      if (!scores[key]) {
        scores[key] = {
          chunk_id:   chunk.chunk_id,
          content:    chunk.content,
          created_at: chunk.created_at,
          session_id: chunk.session_id ?? null,
          _type:      "chunk",
          _key:       key,
          rrf:        0,
          sources:    [],
        };
      }
      scores[key].rrf += 1 / (k + rank);
      scores[key].sources.push(source);
    };

    bm25Results.forEach(r   => addFactScore(r, r.rank, "bm25"));
    vectorResults.forEach(r => addFactScore(r, r.rank, "vector"));
    chunkBm25.forEach(r     => addChunkScore(r, r.rank, "chunk_bm25"));
    chunkVector.forEach(r   => addChunkScore(r, r.rank, "chunk_vector"));

    const ranked = Object.values(scores).sort((a, b) => b.rrf - a.rrf);

    // deduplicate: if a fact already covers a chunk (via fact.chunk_id),
    // drop the standalone chunk result — the fact version is richer
    const coveredChunkIds = new Set(
      ranked.filter(r => r._type === "fact" && r.chunk_id).map(r => r.chunk_id)
    );

    const deduped = ranked.filter(r => {
      if (r._type === "chunk" && coveredChunkIds.has(r.chunk_id)) return false;
      return true;
    });

    return deduped.slice(0, topN);
  }

  // Embedding-dimension guard. _cosineSimilarity silently returns 0 when two
  // vectors differ in length, so swapping the embedder (different model →
  // different dim) after memories were written makes EVERY score 0 — search
  // returns garbage with no error. Catch it loudly at query time.
  _assertEmbeddingDim(queryVector, rows) {
    if (!queryVector || !rows || rows.length === 0) return;
    const blob = rows[0].vector;
    if (!blob || typeof blob.byteLength !== "number") return;
    const storedDim = blob.byteLength / 4;
    if (queryVector.length !== storedDim) {
      throw new Error(
        `[greymemory-lite] embedding dimension mismatch: query vector has ${queryVector.length} dims ` +
        `but stored vectors have ${storedDim}. The embedder almost certainly changed since these ` +
        `memories were written. Re-ingest with the current embedder, or restore the original one. ` +
        `(Cosine over mismatched dims silently returns 0, which would corrupt search results.)`
      );
    }
  }

  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot  += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  // ── Clear ──────────────────────────────────────────

  clear() {
    // delete child rows before parents — embeddings/chunk_embeddings have FK
    // references to facts/chunks
    this.db.prepare(`DELETE FROM embeddings WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM chunk_embeddings WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM facts WHERE container = ?`).run(this.container);
    this.db.prepare(`DELETE FROM chunks WHERE container = ?`).run(this.container);
  }
}
