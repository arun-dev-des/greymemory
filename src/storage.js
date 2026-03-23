import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export class Storage {
  constructor(dir = ".greymemory", container = "default") {
    this.dir = dir;
    this.container = container;
    this.dbFile = path.join(dir, "greymemory.db");

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbFile);
    this._init();
  }

  _init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        key         TEXT NOT NULL,
        value       TEXT NOT NULL,
        container   TEXT NOT NULL DEFAULT 'default',
        previous    TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(key, container)
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        fact_key    TEXT NOT NULL,
        container   TEXT NOT NULL DEFAULT 'default',
        vector      TEXT NOT NULL,
        model       TEXT NOT NULL DEFAULT 'mxbai-embed-large',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(fact_key, container)
      );
    `);
  }

  // ── Facts ──────────────────────────────────────────

  loadFacts() {
    const rows = this.db
      .prepare(`SELECT key, value FROM facts WHERE container = ?`)
      .all(this.container);

    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  saveFacts(facts) {
    const upsert = this.db.prepare(`
      INSERT INTO facts (key, value, container, previous, updated_at)
      VALUES (@key, @value, @container, @previous, datetime('now'))
      ON CONFLICT(key, container) DO UPDATE SET
        previous   = facts.value,
        value      = @value,
        updated_at = datetime('now')
    `);

    const saveAll = this.db.transaction((facts) => {
      for (const [key, value] of Object.entries(facts)) {
        const existing = this.db
          .prepare(`SELECT value FROM facts WHERE key = ? AND container = ?`)
          .get(key, this.container);

        upsert.run({
          key,
          value,
          container: this.container,
          previous: existing?.value ?? null,
        });
      }
    });

    saveAll(facts);
  }

  // ── Embeddings ─────────────────────────────────────

  loadEmbeddings() {
    const rows = this.db
      .prepare(`SELECT fact_key, vector FROM embeddings WHERE container = ?`)
      .all(this.container);

    return Object.fromEntries(
      rows.map((r) => [r.fact_key, JSON.parse(r.vector)])
    );
  }

  saveEmbeddings(embeddings) {
    const upsert = this.db.prepare(`
      INSERT INTO embeddings (fact_key, container, vector)
      VALUES (@fact_key, @container, @vector)
      ON CONFLICT(fact_key, container) DO UPDATE SET
        vector = @vector
    `);

    const saveAll = this.db.transaction((embeddings) => {
      for (const [fact_key, vector] of Object.entries(embeddings)) {
        upsert.run({
          fact_key,
          container: this.container,
          vector: JSON.stringify(vector),
        });
      }
    });

    saveAll(embeddings);
  }

  // ── Clear ──────────────────────────────────────────

  clear() {
    this.db
      .prepare(`DELETE FROM facts WHERE container = ?`)
      .run(this.container);
    this.db
      .prepare(`DELETE FROM embeddings WHERE container = ?`)
      .run(this.container);
  }
}