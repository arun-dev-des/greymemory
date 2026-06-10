import { test } from "node:test";
import assert from "node:assert/strict";
import Memory from "../src/index.js";
import { stubEmbedder, emptyExtractor, tmpDir, rmDir } from "./_helpers.mjs";

function makeMemory(dir) {
  return new Memory({ extractor: emptyExtractor, embedder: stubEmbedder(), dir });
}

function chunkRows(memory) {
  return memory.storage.db.prepare(
    `SELECT content FROM chunks WHERE container = ? ORDER BY id`
  ).all("default");
}

test("user+assistant turns pair into one round chunk", async () => {
  const dir = tmpDir();
  try {
    const memory = makeMemory(dir);
    const res = await memory.add([
      { role: "user", content: "I train powerlifting" },
      { role: "assistant", content: "Nice, what category?" },
      { role: "user", content: "83kg" },
      { role: "assistant", content: "Strong class!" },
    ]);
    assert.equal(res.chunksStored, 2);
    const rows = chunkRows(memory);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].content, "user: I train powerlifting\nassistant: Nice, what category?");
    assert.equal(rows[1].content, "user: 83kg\nassistant: Strong class!");
  } finally { rmDir(dir); }
});

test("orphan turns become single-turn rounds", async () => {
  const dir = tmpDir();
  try {
    const memory = makeMemory(dir);
    const res = await memory.add([
      { role: "assistant", content: "Welcome back!" },          // leading assistant
      { role: "user", content: "Thanks" },
      { role: "assistant", content: "How can I help?" },
      { role: "user", content: "Just looking around" },          // trailing user
    ]);
    // round 1: orphan assistant; round 2: paired; round 3: orphan trailing user
    assert.equal(res.chunksStored, 3);
    const rows = chunkRows(memory);
    assert.equal(rows[0].content, "assistant: Welcome back!");
    assert.equal(rows[1].content, "user: Thanks\nassistant: How can I help?");
    assert.equal(rows[2].content, "user: Just looking around");
  } finally { rmDir(dir); }
});

test("back-to-back same-role turns stay separate rounds", async () => {
  const dir = tmpDir();
  try {
    const memory = makeMemory(dir);
    const res = await memory.add([
      { role: "user", content: "First thought" },
      { role: "user", content: "Second thought" },
      { role: "assistant", content: "Got both!" },
    ]);
    // user1 orphan, then user2+assistant pair
    assert.equal(res.chunksStored, 2);
    const rows = chunkRows(memory);
    assert.equal(rows[0].content, "user: First thought");
    assert.equal(rows[1].content, "user: Second thought\nassistant: Got both!");
  } finally { rmDir(dir); }
});

test("empty-content turns are skipped", async () => {
  const dir = tmpDir();
  try {
    const memory = makeMemory(dir);
    const res = await memory.add([
      { role: "user", content: "   " },
      { role: "user", content: "Real content" },
      { role: "assistant", content: "" },
    ]);
    assert.equal(res.chunksStored, 1);
    assert.equal(chunkRows(memory)[0].content, "user: Real content");
  } finally { rmDir(dir); }
});

test("a raw string becomes one document round, stored verbatim", async () => {
  const dir = tmpDir();
  try {
    const memory = makeMemory(dir);
    const res = await memory.add("Arun is building greymemory-lite, a memory library.");
    assert.equal(res.chunksStored, 1);
    // documents are stored without a role prefix
    assert.equal(chunkRows(memory)[0].content, "Arun is building greymemory-lite, a memory library.");
  } finally { rmDir(dir); }
});

test("content blocks and tool_calls are flattened to strings", async () => {
  const dir = tmpDir();
  try {
    const memory = makeMemory(dir);
    const res = await memory.add([
      { role: "user", content: [{ type: "text", text: "look at this" }, { type: "image", url: "x" }] },
      { role: "assistant", content: "", tool_calls: [{ function: { name: "search", arguments: { q: "y" } } }] },
    ]);
    const rows = chunkRows(memory);
    assert.equal(res.chunksStored, 1);
    assert.match(rows[0].content, /look at this/);
    assert.match(rows[0].content, /\[image\]/);
    assert.match(rows[0].content, /\[tool_call name=search/);
  } finally { rmDir(dir); }
});
