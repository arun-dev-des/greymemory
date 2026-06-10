import { test } from "node:test";
import assert from "node:assert/strict";
import Memory from "../src/index.js";
import { stubEmbedder, stubExtractor, tmpDir, rmDir } from "./_helpers.mjs";

const count = (memory, table) =>
  memory.storage.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE container = ?`).get("default").n;

test("garbage extractor output: chunks persist, zero facts, chunk embeddings still written", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: stubExtractor("# Reasoning\nI cannot produce structured output for this."),
      embedder:  stubEmbedder(),
      dir,
    });
    const res = await memory.add([
      { role: "user", content: "My squat PR is 200kg" },
      { role: "assistant", content: "Impressive!" },
    ]);
    assert.equal(res.factsStored, 0);
    assert.equal(count(memory, "chunks"), 1);
    assert.equal(count(memory, "facts"), 0);
    // K = V-only embedding still written — raw round stays vector-searchable
    assert.equal(count(memory, "chunk_embeddings"), 1);
  } finally { rmDir(dir); }
});

test("throwing extractor: add() rejects but already-saved chunks survive (chunks-first invariant)", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: stubExtractor(() => { throw new Error("API down"); }),
      embedder:  stubEmbedder(),
      dir,
    });
    await assert.rejects(
      memory.add([
        { role: "user", content: "I moved to Chennai" },
        { role: "assistant", content: "Noted" },
      ]),
      /API down/
    );
    // the raw conversation was persisted before extraction ran
    assert.equal(count(memory, "chunks"), 1);
    // and is reachable through chunk BM25 even with no embeddings written
    const hits = memory.storage.chunkBm25Search("Chennai", "default", 5);
    assert.equal(hits.length, 1);
  } finally { rmDir(dir); }
});
