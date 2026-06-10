import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { Storage } from "../src/storage.js";
import { tmpDir, rmDir } from "./_helpers.mjs";

test("a foreign 'facts' table (e.g. full-greymemory v0.4 DB) is rejected loudly", () => {
  const dir = tmpDir();
  try {
    // simulate a full-greymemory database: facts table, no greymemory_meta
    const db = new Database(path.join(dir, "greymemory.db"));
    db.exec(`CREATE TABLE facts (id INTEGER PRIMARY KEY, key TEXT, value TEXT, is_latest INTEGER)`);
    db.close();

    assert.throws(
      () => new Storage(dir, "default"),
      /not created by greymemory-lite.*fresh directory|fresh directory|pin the full 'greymemory' package/s
    );
  } finally { rmDir(dir); }
});

test("fresh dir initializes and reopens cleanly; WAL is on", () => {
  const dir = tmpDir();
  try {
    const s1 = new Storage(dir, "default");
    s1.saveFact("k", "v");
    assert.equal(s1.db.pragma("journal_mode", { simple: true }), "wal");
    s1.db.close();

    // reopen — schema_version matches, no throw, data intact
    const s2 = new Storage(dir, "default");
    assert.equal(s2.loadFacts().length, 1);
    s2.db.close();
  } finally { rmDir(dir); }
});

test("caller-supplied db with its own tables coexists untouched", () => {
  const dir = tmpDir();
  try {
    const db = new Database(path.join(dir, "app.db"));
    db.exec(`CREATE TABLE my_app_data (id INTEGER PRIMARY KEY, payload TEXT)`);
    db.prepare(`INSERT INTO my_app_data (payload) VALUES ('keep me')`).run();
    db.pragma("user_version = 7");   // the caller's own versioning

    const storage = new Storage(null, "default", db);
    storage.saveFact("k", "v");

    // caller's table and user_version are untouched
    assert.equal(db.prepare(`SELECT payload FROM my_app_data`).get().payload, "keep me");
    assert.equal(db.pragma("user_version", { simple: true }), 7);
    db.close();
  } finally { rmDir(dir); }
});
