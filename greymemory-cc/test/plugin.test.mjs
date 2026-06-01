// Unit tests for greymemory-cc's pure logic (lib/transcript, lib/cursor, lib/container).
// Zero dependencies — imports only node built-ins, so it runs with plain `node` (no npm
// install, no API key, no Ollama). This is the CI-able tier.
//
//   node greymemory-cc/test/plugin.test.mjs     (or: cd greymemory-cc && npm test)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { entriesToMessages } from "../lib/transcript.mjs";
import { readNewEntries, advanceCursor } from "../lib/cursor.mjs";
import { resolveContainer } from "../lib/container.mjs";

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok — " : "  FAIL: ") + msg); if (!cond) failed = 1; };
const tmp = (p) => path.join(os.tmpdir(), p + "-" + process.pid);

// ───────────────────────────── transcript mapping ─────────────────────────────
console.log("\n[transcript] entriesToMessages");
{
  const entries = [
    { type: "queue-operation" },                                          // noise
    { type: "user", message: { role: "user", content: [
      { type: "text", text: "hello <greymemory-context>OLD</greymemory-context>" },
      { type: "image", source: { type: "base64", data: "AAAA" } },        // CC image shape
      { type: "image_url", imageUrl: { url: "https://x.test/a.png" } },    // library image shape
    ] } },
    { type: "assistant", message: { role: "assistant", content: [
      { type: "thinking", thinking: "secret reasoning" },
      { type: "text", text: "running it" },
      { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } },
    ] } },
    { type: "user", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "done" }] },
    ] } },
  ];
  const m = entriesToMessages(entries);
  ok(m.length === 3, `noise dropped → 3 messages (got ${m.length})`);
  ok(m[0].role === "user" && m[0].content.includes("hello"), "user text preserved");
  ok((m[0].content.match(/\[image\]/g) || []).length === 2, "both image shapes → [image] x2");
  ok(!m[0].content.includes("x.test") && !m[0].content.includes("AAAA"), "no image url / base64 leaked");
  ok(!m[0].content.includes("OLD"), "injected <greymemory-context> stripped");
  ok(m[1].role === "assistant" && m[1].tool_calls?.[0]?.name === "Bash", "tool_use → tool_calls[name=Bash]");
  ok(!m.some((x) => /secret reasoning/.test(x.content || "")), "thinking dropped");
  ok(m[2].role === "tool" && m[2].tool_call_id === "tu1" && m[2].name === "Bash" && m[2].content.includes("done"),
    "tool_result → {role:'tool', tool_call_id, name}");
}

console.log("\n[transcript] degenerate inputs never throw");
{
  let threw = false;
  try {
    const m = entriesToMessages([
      { type: "assistant", message: { role: "assistant", content: null } },          // null content
      { type: "user", message: { role: "user", content: [] } },                       // empty blocks
      { type: "user", message: { role: "user", content: [{ type: "mystery" }] } },     // unknown block
      { type: "assistant", message: { role: "assistant", content: "plain string" } }, // string content
    ]);
    ok(m.some((x) => x.content === "plain string"), "string content passes through");
    ok(!m.some((x) => x.content === ""), "empty/blank messages dropped");
  } catch { threw = true; }
  ok(!threw, "no throw on null / empty / unknown blocks");
}

// ───────────────────────────── cursor watermark ─────────────────────────────
console.log("\n[cursor] readNewEntries / advanceCursor");
{
  const dataDir = tmp("gmcc-cursor");
  fs.mkdirSync(dataDir, { recursive: true });
  const tx = path.join(dataDir, "t.jsonl");
  const lines = [
    { type: "user", uuid: "c1", message: { role: "user", content: "one" } },
    { type: "assistant", uuid: "c2", message: { role: "assistant", content: "two" } },
    { type: "queue-operation" },                          // noise, no uuid
    { type: "user", uuid: "c3", message: { role: "user", content: "three" } },
  ];
  fs.writeFileSync(tx, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  const sid = "sessA";
  const first = readNewEntries(tx, sid, dataDir);
  ok(first.entries.length === 3, `first read → 3 conversational entries (got ${first.entries.length})`);
  ok(first.lastUuid === "c3", `lastUuid = last conversational uuid 'c3' (got ${first.lastUuid})`);

  advanceCursor(sid, "c2", dataDir);
  const second = readNewEntries(tx, sid, dataDir);
  ok(second.entries.length === 1 && second.entries[0].uuid === "c3",
    `after watermark c2 → only c3 (got ${second.entries.map((e) => e.uuid).join(",")})`);

  advanceCursor(sid, "c3", dataDir);
  const third = readNewEntries(tx, sid, dataDir);
  ok(third.entries.length === 0, `after watermark c3 → nothing new (got ${third.entries.length})`);

  fs.rmSync(dataDir, { recursive: true, force: true });
}

// ───────────────────────────── container resolution ─────────────────────────────
console.log("\n[container] resolveContainer");
{
  const dataDir = tmp("gmcc-container");
  fs.mkdirSync(dataDir, { recursive: true });

  const prev = process.env.GREYMEMORY_CONTAINER;
  process.env.GREYMEMORY_CONTAINER = "Cool Proj#1";
  ok(resolveContainer("/anywhere", dataDir) === "Cool_Proj_1", "GREYMEMORY_CONTAINER override sanitized");
  delete process.env.GREYMEMORY_CONTAINER;

  // cache hit: pre-seed containers.json, expect it returned without touching git
  fs.writeFileSync(path.join(dataDir, "containers.json"), JSON.stringify({ "/fake/cwd": "repo_cached" }));
  ok(resolveContainer("/fake/cwd", dataDir) === "repo_cached", "cached container returned (no git shell-out)");

  if (prev !== undefined) process.env.GREYMEMORY_CONTAINER = prev;
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failed ? "\n✗ plugin unit tests FAILED" : "\n✓ all plugin unit tests passed");
process.exit(failed);
