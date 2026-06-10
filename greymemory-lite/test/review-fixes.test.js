// Regression tests for the defects confirmed by the adversarial port review.
import { test } from "node:test";
import assert from "node:assert/strict";
import Memory from "../src/index.js";
import { stubEmbedder, stubExtractor, tmpDir, rmDir } from "./_helpers.mjs";

const today = () => new Date().toISOString().slice(0, 10);

test("same-day episode (expires_at = today) stays visible all day", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: stubExtractor(JSON.stringify([
        { key: "meeting", value: "Arun has a meeting with Sarah at 3pm", memory_type: "episode", expires_at: today(), source_message_index: 0 },
      ])),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "I have a meeting with Sarah at 3pm today" }]);

    // the prompt's own contract: "meeting at 3pm today" expires AFTER today
    assert.equal(memory.getMemories().length, 1, "visible via getMemories on the expiry day");
    const results = await memory.search("meeting with Sarah", { topN: 5 });
    assert.ok(results.some(r => r.memory?.includes("meeting")), "visible via search on the expiry day");
    const { profile } = await memory.getProfile();
    assert.ok(profile.dynamic.some(v => v.includes("meeting")), "visible via getProfile on the expiry day");

    // but an asOf AFTER the expiry day hides it
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const later = await memory.search("meeting with Sarah", { topN: 5, asOf: tomorrow });
    assert.ok(!later.some(r => r.memory?.includes("meeting")));
  } finally { rmDir(dir); }
});

test("dedupBySession resumes a round whose extraction failed — no skip, no duplicate", async () => {
  const dir = tmpDir();
  try {
    const fact1 = [{ key: "gym", value: "Arun trains at Barbell Cartel", memory_type: "fact", source_message_index: 0 }];
    const fact2 = [{ key: "class", value: "Arun competes at 83kg", memory_type: "fact", source_message_index: 0 }];
    let calls = 0;
    let failSecond = true;
    const extractor = stubExtractor(() => {
      calls++;
      if (failSecond && calls === 2) throw new Error("API down");
      return JSON.stringify(calls === 1 ? fact1 : fact2);
    });
    const memory = new Memory({ extractor, embedder: stubEmbedder(), dir });
    const conversation = [
      { role: "user", content: "I train at Barbell Cartel" },
      { role: "assistant", content: "Noted" },
      { role: "user", content: "I compete at 83kg" },
      { role: "assistant", content: "Strong" },
    ];

    // first attempt: round 1 completes, round 2's extraction throws
    await assert.rejects(memory.add(conversation, { sessionId: "s1", dedupBySession: true }), /API down/);
    const chunkCount = () => memory.storage.db.prepare(`SELECT COUNT(*) AS n FROM chunks`).get().n;
    assert.equal(chunkCount(), 2, "both chunks persisted (durability)");
    assert.equal(memory.getMemories().length, 1, "round 1's fact saved");

    // retry: round 1 skipped (fully ingested), round 2 RESUMED on the same chunk row
    failSecond = false;
    const retry = await memory.add(conversation, { sessionId: "s1", dedupBySession: true });
    assert.equal(retry.roundsSkipped, 1, "completed round skipped");
    assert.equal(retry.factsStored, 1, "failed round's fact now extracted");
    assert.equal(chunkCount(), 2, "no duplicate chunk rows");
    // and the resumed chunk got its embedding
    const embCount = memory.storage.db.prepare(`SELECT COUNT(*) AS n FROM chunk_embeddings`).get().n;
    assert.equal(embCount, 2);

    // third add: everything skipped
    const third = await memory.add(conversation, { sessionId: "s1", dedupBySession: true });
    assert.equal(third.roundsSkipped, 2);
    assert.equal(third.llmCalls.extraction, 0);
  } finally { rmDir(dir); }
});

test("getProfile({asOf}) excludes facts recorded after the cutoff", async () => {
  const dir = tmpDir();
  try {
    let n = 0;
    const memory = new Memory({
      extractor: stubExtractor(() => JSON.stringify([
        [{ key: "city", value: "Arun lives in Bangalore", memory_type: "fact", source_message_index: 0 }],
        [{ key: "city", value: "Arun lives in Chennai", memory_type: "fact", source_message_index: 0 }],
      ][n++])),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "I live in Bangalore" }], { date: "2026-01-10" });
    await memory.add([{ role: "user", content: "I moved to Chennai" }], { date: "2026-03-10" });

    const { profile } = await memory.getProfile({ asOf: "2026-02-01" });
    const all = [...profile.static, ...profile.dynamic];
    assert.ok(all.some(v => v.includes("Bangalore")));
    assert.ok(!all.some(v => v.includes("Chennai")), "fact recorded after asOf must not leak into the profile");
  } finally { rmDir(dir); }
});

test("month-precision event_date overlapping the bound fails open", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: stubExtractor(JSON.stringify([
        { key: "trip", value: "Arun visited Goa", memory_type: "episode", event_date: "2026-04", source_message_index: 0 },
      ])),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "Visited Goa in April" }]);

    // '2026-04' is month precision; the bound 2026-04-15 falls inside April →
    // the fact may be in range, so it must be kept (fail-open)
    const results = await memory.search("Goa trip", { topN: 5, afterDate: "2026-04-15" });
    assert.ok(results.some(r => r.memory?.includes("Goa")));

    // a bound in a different month still excludes it
    const out = await memory.search("Goa trip", { topN: 5, afterDate: "2026-06-01" });
    assert.ok(!out.some(r => r.memory?.includes("Goa")));
  } finally { rmDir(dir); }
});

test("asOf accepts Date and epoch ms; unparseable asOf fails loud", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: stubExtractor(JSON.stringify([
        { key: "k", value: "Arun likes espresso", memory_type: "fact", source_message_index: 0 },
      ])),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "I like espresso" }], { date: "2026-01-10" });

    const viaEpoch = await memory.search("espresso", { topN: 5, asOf: Date.UTC(2026, 1, 1) });
    assert.ok(viaEpoch.some(r => r.memory?.includes("espresso")));

    const viaDate = await memory.search("espresso", { topN: 5, asOf: new Date(Date.UTC(2025, 0, 1)) });
    assert.equal(viaDate.filter(r => r.memory).length, 0, "cutoff before the fact hides it");

    await assert.rejects(memory.search("espresso", { asOf: "June 30, 2023" }), /unparseable asOf/);
  } finally { rmDir(dir); }
});

test("extraction parser survives bracketed prose before the JSON array", () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({ extractor: stubExtractor("[]"), embedder: stubEmbedder(), dir });
    const parsed = memory._parseExtraction(
      '[Thinking] the user said several things [important].\n[{"key":"k","value":"v"}]'
    );
    assert.deepEqual(parsed, [{ key: "k", value: "v" }]);
  } finally { rmDir(dir); }
});
