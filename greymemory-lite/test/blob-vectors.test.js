import { test } from "node:test";
import assert from "node:assert/strict";
import { Storage } from "../src/storage.js";
import { tmpDir, rmDir } from "./_helpers.mjs";

test("vectors round-trip through BLOB storage with identical cosine scores", () => {
  const dir = tmpDir();
  try {
    const storage = new Storage(dir, "default");
    const vec = [0.25, -0.5, 0.75, 1.0];

    const factId = storage.saveFactWithEmbedding("k", "the quick brown fox", { memory_type: "fact" }, vec);
    assert.ok(factId > 0);

    // same vector → cosine 1.0 (within float32 precision)
    const hits = storage.vectorSearch(vec, "default", 5);
    assert.equal(hits.length, 1);
    assert.ok(Math.abs(hits[0].score - 1.0) < 1e-6, `expected ~1.0, got ${hits[0].score}`);

    // stored blob is 4 bytes per dim, not JSON text
    const raw = storage.db.prepare(`SELECT vector FROM embeddings`).get();
    assert.ok(Buffer.isBuffer(raw.vector));
    assert.equal(raw.vector.byteLength, vec.length * 4);
  } finally { rmDir(dir); }
});

test("chunk embeddings round-trip and upsert on conflict", () => {
  const dir = tmpDir();
  try {
    const storage = new Storage(dir, "default");
    const chunkId = storage.saveChunk("user: hello there");
    storage.saveChunkEmbedding(chunkId, [1, 0, 0]);
    storage.saveChunkEmbedding(chunkId, [0, 1, 0]);   // upsert replaces

    const hits = storage.chunkVectorSearch([0, 1, 0], "default", 5);
    assert.equal(hits.length, 1);
    assert.ok(Math.abs(hits[0].score - 1.0) < 1e-6);
  } finally { rmDir(dir); }
});

test("embedding dimension mismatch fails loudly with a diagnosis", () => {
  const dir = tmpDir();
  try {
    const storage = new Storage(dir, "default");
    storage.saveFactWithEmbedding("k", "v", {}, [1, 0, 0, 0]);
    assert.throws(
      () => storage.vectorSearch([1, 0], "default", 5),
      /dimension mismatch.*query vector has 2 dims.*stored vectors have 4/s
    );
  } finally { rmDir(dir); }
});
