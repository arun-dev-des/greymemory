import { test } from "node:test";
import assert from "node:assert/strict";
import Memory from "../src/index.js";
import { stubEmbedder, stubExtractor, tmpDir, rmDir } from "./_helpers.mjs";

test("queries with apostrophes/hyphens/parens don't crash and BM25 still matches", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: stubExtractor(JSON.stringify([
        { key: "coach", value: "O'Brien's state-of-the-art program suits Arun", memory_type: "fact", source_message_index: 0 },
      ])),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "Coach O'Brien's state-of-the-art program is working" }]);

    // direct BM25 channel — used to throw inside FTS5 MATCH and silently
    // return [] through an empty catch
    const factHits = memory.storage.bm25Search("O'Brien's state-of-the-art plan (v2)", "default", 5);
    assert.ok(factHits.length > 0, "fact BM25 channel must survive punctuation");

    const chunkHits = memory.storage.chunkBm25Search("O'Brien's program", "default", 5);
    assert.ok(chunkHits.length > 0, "chunk BM25 channel must survive punctuation");

    // and the full search path
    const results = await memory.search(`O'Brien's state-of-the-art plan: "does it work?"`, { topN: 5 });
    assert.ok(results.length > 0);
  } finally { rmDir(dir); }
});

test("empty / whitespace-only query returns no BM25 results instead of throwing", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({ extractor: stubExtractor("[]"), embedder: stubEmbedder(), dir });
    assert.deepEqual(memory.storage.bm25Search("   ", "default", 5), []);
    assert.deepEqual(memory.storage.chunkBm25Search("", "default", 5), []);
  } finally { rmDir(dir); }
});
