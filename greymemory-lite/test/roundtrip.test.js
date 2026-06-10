import { test } from "node:test";
import assert from "node:assert/strict";
import Memory from "../src/index.js";
import { stubEmbedder, stubExtractor, tmpDir, rmDir } from "./_helpers.mjs";

// Queue-based extractor: round mode makes one extraction call per round, in
// order — each call shifts the next canned response.
function queueExtractor(queue) {
  const remaining = [...queue];
  return stubExtractor(() => JSON.stringify(remaining.shift() ?? []));
}

test("add → search roundtrip pairs memories with their source chunk", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: queueExtractor([
        [{ key: "training_gym", value: "Arun trains at Barbell Cartel in Bangalore", memory_type: "fact", source_message_index: 0 }],
        [{ key: "competition_class", value: "Arun competes in the 83kg category", memory_type: "fact", source_message_index: 0 }],
      ]),
      embedder: stubEmbedder(),
      dir,
    });

    const res = await memory.add([
      { role: "user", content: "I train at Barbell Cartel in Bangalore" },
      { role: "assistant", content: "Noted!" },
      { role: "user", content: "I compete at 83kg" },
      { role: "assistant", content: "Great class" },
    ], { date: "2026-06-01" });

    assert.equal(res.chunksStored, 2);
    assert.equal(res.factsStored, 2);
    assert.equal(res.llmCalls.extraction, 2);     // one per round
    assert.equal(res.llmCalls.total, 2);          // and nothing else — paper-pure

    const results = await memory.search("where does Arun train", { topN: 5 });
    assert.ok(results.length > 0);
    const hit = results.find(r => r.memory?.includes("Barbell Cartel"));
    assert.ok(hit, "expected the gym fact in results");
    assert.match(hit.chunk, /train at Barbell Cartel/);     // paired source round
    assert.equal(hit.memory_type, "fact");
    assert.equal(hit.document_date, "2026-06-01");
    assert.equal(hit.source_role, "user");
  } finally { rmDir(dir); }
});

test("getProfile splits static/dynamic by type and recency", async () => {
  const dir = tmpDir();
  try {
    const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const memory = new Memory({
      extractor: queueExtractor([
        [{ key: "hometown", value: "Arun is from Coimbatore", memory_type: "fact", source_message_index: 0 }],
        [
          { key: "current_project", value: "Arun is building greymemory-lite", memory_type: "fact", source_message_index: 0 },
          { key: "ui_preference", value: "Arun prefers dark mode", memory_type: "preference", source_message_index: 0 },
          { key: "upcoming_meet", value: "Arun has a competition on Friday", memory_type: "episode", source_message_index: 0 },
        ],
      ]),
      embedder: stubEmbedder(),
      dir,
    });

    await memory.add([{ role: "user", content: "I grew up in Coimbatore" }], { date: old });
    await memory.add([{ role: "user", content: "Building greymemory-lite, prefer dark mode, competing Friday" }], { date: today });

    const { profile } = await memory.getProfile();
    assert.ok(profile.static.includes("Arun is from Coimbatore"), "old fact → static");
    assert.ok(profile.static.includes("Arun prefers dark mode"), "preference → static");
    assert.ok(profile.dynamic.includes("Arun is building greymemory-lite"), "recent fact → dynamic");
    assert.ok(profile.dynamic.includes("Arun has a competition on Friday"), "episode → dynamic");
  } finally { rmDir(dir); }
});

test("forget soft-deletes: gone from search and getMemories, row preserved", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: queueExtractor([
        [{ key: "squat_pr", value: "Arun squats 200kg", memory_type: "fact", source_message_index: 0 }],
      ]),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "My squat PR is 200kg" }]);

    const forgotten = await memory.forget("squat PR 200kg");
    assert.equal(forgotten, "Arun squats 200kg");

    assert.equal(memory.getMemories().length, 0);
    const results = await memory.search("Arun squats", { topN: 5 });
    assert.ok(!results.some(r => r.memory === "Arun squats 200kg"));

    // row preserved for audit
    const raw = memory.storage.db.prepare(`SELECT value, expires_at FROM facts`).get();
    assert.equal(raw.value, "Arun squats 200kg");
    assert.ok(raw.expires_at);
  } finally { rmDir(dir); }
});

test("dedupBySession: re-adding the same conversation skips every round", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: queueExtractor([
        [{ key: "gym", value: "Arun trains at Iron Temple", memory_type: "fact", source_message_index: 0 }],
      ]),
      embedder: stubEmbedder(),
      dir,
    });
    const conversation = [
      { role: "user", content: "I switched to Iron Temple" },
      { role: "assistant", content: "New gym!" },
    ];

    const first = await memory.add(conversation, { sessionId: "s1", dedupBySession: true });
    assert.equal(first.factsStored, 1);

    const second = await memory.add(conversation, { sessionId: "s1", dedupBySession: true });
    assert.equal(second.roundsSkipped, 1);
    assert.equal(second.chunksStored, 0);
    assert.equal(second.factsStored, 0);
    assert.equal(second.llmCalls.extraction, 0);   // no extraction call at all
  } finally { rmDir(dir); }
});

test("asOf hides facts and chunks recorded after the cutoff", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: queueExtractor([
        [{ key: "employer", value: "Arun works at Google", memory_type: "fact", source_message_index: 0 }],
        [{ key: "employer", value: "Arun works at Stripe", memory_type: "fact", source_message_index: 0 }],
      ]),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "I work at Google" }], { date: "2026-01-10" });
    await memory.add([{ role: "user", content: "I now work at Stripe" }], { date: "2026-03-10" });

    const past = await memory.search("where does Arun work", { topN: 10, asOf: "2026-02-01" });
    assert.ok(past.some(r => r.memory?.includes("Google")));
    assert.ok(!past.some(r => r.memory?.includes("Stripe")), "future fact must be invisible");
    assert.ok(!past.some(r => r.chunk?.includes("Stripe")), "future chunk must be invisible");

    const present = await memory.search("where does Arun work", { topN: 10 });
    assert.ok(present.some(r => r.memory?.includes("Stripe")));
  } finally { rmDir(dir); }
});

test("event_date range filters fail open on null event_date", async () => {
  const dir = tmpDir();
  try {
    const memory = new Memory({
      extractor: queueExtractor([
        [
          { key: "marathon", value: "Arun ran a marathon", memory_type: "episode", event_date: "2026-04-10", source_message_index: 0 },
          { key: "diet", value: "Arun eats vegetarian food", memory_type: "fact", source_message_index: 0 },
        ],
      ]),
      embedder: stubEmbedder(),
      dir,
    });
    await memory.add([{ role: "user", content: "Ran a marathon in April; I eat vegetarian" }]);

    const results = await memory.search("Arun marathon vegetarian", { topN: 10, afterDate: "2026-05-01" });
    assert.ok(!results.some(r => r.memory?.includes("marathon")), "dated outside the range → excluded");
    assert.ok(results.some(r => r.memory?.includes("vegetarian")), "null event_date → passes (fail-open)");
  } finally { rmDir(dir); }
});
