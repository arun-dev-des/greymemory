// Unit tests for greymemory-cc's pure logic (lib/transcript, lib/cursor, lib/container).
// Zero dependencies -- imports only node built-ins, so it runs with plain `node` (no npm
// install, no API key, no Ollama). This is the CI-able tier.
//
//   node greymemory-cc/test/plugin.test.mjs     (or: cd greymemory-cc && npm test)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { entriesToMessages } from "../lib/transcript.mjs";
import { readNewEntries, advanceCursor } from "../lib/cursor.mjs";
import { resolveContainer } from "../lib/container.mjs";
import { loadConfig } from "../lib/config.mjs";

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok -- " : "  FAIL: ") + msg); if (!cond) failed = 1; };
const tmp = (p) => path.join(os.tmpdir(), p + "-" + process.pid);

// ---------------------------- transcript: rounds, noise, tools ----------------------------
console.log("\n[transcript] entriesToMessages -- rounds / noise / tools dropped");
{
  const entries = [
    { type: "queue-operation" },                                            // noise (no message)
    { type: "user", message: { role: "user", content: [
      { type: "text", text: "hello there" },
      { type: "image", source: { type: "base64", data: "AAAA" } },          // image: not a text block
    ] } },
    { type: "assistant", message: { role: "assistant", id: "a1", content: [
      { type: "thinking", thinking: "secret reasoning" },
      { type: "text", text: "running it" },
      { type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } },
    ] } },
    { type: "user", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "done" }] },
    ] } },
  ];
  const m = entriesToMessages(entries);
  ok(m.length === 2, `one round -> user + assistant, noise/tools dropped (got ${m.length})`);
  ok(m[0].role === "user" && m[0].content === "hello there", "user prompt preserved; image/noise ignored");
  ok(m[1].role === "assistant" && m[1].content === "running it", "assistant text folded; thinking + tool_use dropped");
  ok(!m.some((x) => /secret reasoning/.test(x.content)), "thinking never leaks");
}

// REGRESSION: Claude Code prepends <ide_*> context to the SAME row as the typed prompt.
// The real prompt must SURVIVE (strip the tag, keep the text), not be dropped wholesale.
console.log("\n[transcript] ide-context prompt survives (regression)");
{
  const m = entriesToMessages([
    { type: "user", message: { role: "user",
      content: "<ide_opened_file>The user opened /x.js</ide_opened_file>where is the bug?" } },
    { type: "assistant", message: { role: "assistant", id: "a1", content: [{ type: "text", text: "line 4" }] } },
  ]);
  ok(m.length === 2 && m[0].content === "where is the bug?",
    `ide tag stripped, prompt kept (got ${JSON.stringify(m[0]?.content)})`);
  ok(!/<ide_/.test(m[0].content), "no <ide_> tag leaks into the captured prompt");
}

console.log("\n[transcript] pure injected / notice rows are dropped");
{
  const m = entriesToMessages([
    { type: "user", message: { role: "user", content: "<ide_opened_file>only context</ide_opened_file>" } },
    { type: "user", message: { role: "user", content: "[Request interrupted by user]" } },
    { type: "user", message: { role: "user", content: "real question" } },
    { type: "assistant", message: { role: "assistant", id: "a1", content: [{ type: "text", text: "answer" }] } },
  ]);
  ok(m.length === 2 && m[0].content === "real question",
    `ide-only + interrupt notice dropped, real prompt kept (got ${m.length} msgs)`);
}

// captureTools (opt-in coding-agent mode): allowlisted tool calls fold a compact, tool-aware
// one-liner (Edited/Created/Ran/Spawned) into the assistant turn; everything else is dropped.
console.log("\n[transcript] captureTools (opt-in, tool-aware)");
{
  const entries = [
    { type: "user", message: { role: "user", content: "do the thing" } },
    { type: "assistant", message: { role: "assistant", id: "a1", content: [
      { type: "text", text: "working" },
      { type: "tool_use", id: "e1", name: "Edit", input: { file_path: "src/auth.ts", old_string: "const a = 1", new_string: "const a = 2" } },
      { type: "tool_use", id: "w1", name: "Write", input: { file_path: "src/new.ts", content: "0123456789" } },
      { type: "tool_use", id: "b1", name: "Bash", input: { command: "npm test" } },
      { type: "tool_use", id: "t1", name: "Task", input: { description: "explore codebase", subagent_type: "Explore" } },
      { type: "tool_use", id: "r1", name: "Read", input: { file_path: "secret.txt" } },
    ] } },
    { type: "user", message: { role: "user", content: [
      { type: "tool_result", tool_use_id: "e1", content: [{ type: "text", text: "applied" }] },
      { type: "tool_result", tool_use_id: "w1", content: [{ type: "text", text: "wrote" }] },
      { type: "tool_result", tool_use_id: "b1", content: [{ type: "text", text: "boom" }], is_error: true },
      { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "agent done" }] },
      { type: "tool_result", tool_use_id: "r1", content: "secret file contents" },
    ] } },
    { type: "assistant", message: { role: "assistant", id: "a2", content: [{ type: "text", text: "done" }] } },
  ];
  const conv = entriesToMessages(entries);
  ok(conv.length === 2 && conv[1].content === "working\n\ndone", "default mode drops all tool results");

  const asst = entriesToMessages(entries, { captureTools: ["Edit", "Write", "Bash", "Task"] })
    .find((x) => x.role === "assistant").content;
  ok(asst.includes('Edited src/auth.ts: "const a = 1" → "const a = 2"'), "Edit -> 'Edited <file>: old → new'");
  ok(asst.includes("Created src/new.ts (10 chars)"), "Write -> 'Created <file> (N chars)'");
  ok(asst.includes("Ran: npm test (FAILED)"), "Bash -> 'Ran: <cmd> (FAILED)' from is_error");
  ok(asst.includes("Spawned agent: explore codebase"), "Task -> 'Spawned agent: <description>'");
  ok(!/secret/.test(asst), "non-allowlisted Read excluded (input + result)");
}

console.log("\n[transcript] degenerate inputs never throw");
{
  let threw = false;
  try {
    const m = entriesToMessages([
      { type: "assistant", message: { role: "assistant", content: null } },           // null content
      { type: "user", message: { role: "user", content: [] } },                        // empty blocks
      { type: "user", message: { role: "user", content: [{ type: "mystery" }] } },     // unknown block
      { type: "user", message: { role: "user", content: "plain string" } },            // string content
      { type: "assistant", message: { role: "assistant", id: "z", content: "ok" } },
    ]);
    ok(m.some((x) => x.content === "plain string"), "string content passes through");
    ok(!m.some((x) => x.content === ""), "empty/blank messages dropped");
  } catch { threw = true; }
  ok(!threw, "no throw on null / empty / unknown blocks");
}

// ---------------------------- cursor watermark ----------------------------
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
  ok(first.entries.length === 3, `first read -> 3 conversational entries (got ${first.entries.length})`);
  ok(first.lastUuid === "c3", `lastUuid = last conversational uuid 'c3' (got ${first.lastUuid})`);

  advanceCursor(sid, "c2", dataDir);
  const second = readNewEntries(tx, sid, dataDir);
  ok(second.entries.length === 1 && second.entries[0].uuid === "c3",
    `after watermark c2 -> only c3 (got ${second.entries.map((e) => e.uuid).join(",")})`);

  advanceCursor(sid, "c3", dataDir);
  const third = readNewEntries(tx, sid, dataDir);
  ok(third.entries.length === 0, `after watermark c3 -> nothing new (got ${third.entries.length})`);

  fs.rmSync(dataDir, { recursive: true, force: true });
}

// ---------------------------- container resolution ----------------------------
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

// ---------------------------- user config (captureTools + injection caps) ----------------------------
console.log("\n[config] loadConfig -- captureTools opt-in + injection caps");
{
  const dataDir = tmp("gmcc-config");
  fs.mkdirSync(dataDir, { recursive: true });
  const envKeys = ["GREYMEMORY_CAPTURE_TOOLS", "GREYMEMORY_MAX_CONTEXT_MEMORIES", "GREYMEMORY_MAX_PROFILE_ITEMS"];
  const saved = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
  for (const k of envKeys) delete process.env[k];

  const d = loadConfig(dataDir);
  ok(d.captureTools.length === 0, "default: captureTools off (conversational)");
  ok(d.maxContextMemories === 8 && d.maxProfileItems === 0, "default caps: 8 context, 0 profile (= all)");

  fs.writeFileSync(path.join(dataDir, "settings.json"),
    JSON.stringify({ captureTools: ["Edit", "Bash"], maxContextMemories: 5, maxProfileItems: 3 }));
  const s = loadConfig(dataDir);
  ok(JSON.stringify(s.captureTools) === '["Edit","Bash"]', "settings.json captureTools honored");
  ok(s.maxContextMemories === 5 && s.maxProfileItems === 3, "settings.json injection caps honored");

  process.env.GREYMEMORY_CAPTURE_TOOLS = "Write,Task";
  process.env.GREYMEMORY_MAX_CONTEXT_MEMORIES = "12";
  const e = loadConfig(dataDir);
  ok(JSON.stringify(e.captureTools) === '["Write","Task"]', "env overrides captureTools");
  ok(e.maxContextMemories === 12 && e.maxProfileItems === 3, "env overrides context cap; profile cap kept from settings.json");

  process.env.GREYMEMORY_CAPTURE_TOOLS = "off";
  ok(loadConfig(dataDir).captureTools.length === 0, "env 'off' disables capture");

  for (const k of envKeys) { if (saved[k] !== undefined) process.env[k] = saved[k]; else delete process.env[k]; }
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(failed ? "\nplugin unit tests FAILED" : "\nall plugin unit tests passed");
process.exit(failed);
