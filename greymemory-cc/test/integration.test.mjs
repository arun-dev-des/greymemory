// Integration tests — drive the REAL plugin scripts (capture worker, retrieve hook, MCP
// server) as subprocesses with the exact payloads Claude Code sends, using the offline
// `stub` extractor + embedder so it runs with no API key and no Ollama.
//
// Needs the plugin's deps installed (better-sqlite3, greymemory via file:..):
//   cd greymemory-cc && npm install && npm run test:integration

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");           // greymemory-cc/
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "gmcc-itest-"));
const TX = path.join(DATA, "transcript.jsonl");
const CONTAINER = "itest";
const SID = "itest-sess";
const DB_PATH = path.join(DATA, CONTAINER, "greymemory.db");

// stub providers → fully offline; fixed container so we know the DB path
const ENV = {
  ...process.env,
  GREYMEMORY_EXTRACTOR: "stub",
  GREYMEMORY_EMBEDDER: "stub",
  GREYMEMORY_CONTAINER: CONTAINER,
  GREYMEMORY_DATA: DATA,
  CLAUDE_PROJECT_DIR: ROOT,
};

let failed = 0;
const ok = (c, m) => { console.log((c ? "  ok — " : "  FAIL: ") + m); if (!c) failed = 1; };

function run(scriptRelPath, { args = [], stdin = null } = {}) {
  return new Promise((resolve) => {
    const p = spawn("node", [path.join(ROOT, scriptRelPath), ...args], { env: ENV });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => resolve({ code, out, err }));
    if (stdin != null) p.stdin.write(stdin);
    p.stdin.end();
  });
}

// JSON-RPC client over the MCP stdio server
function mcp(calls) {
  return new Promise((resolve) => {
    const p = spawn("node", [path.join(ROOT, "mcp/server.mjs")], { env: ENV });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    for (const c of calls) p.stdin.write(JSON.stringify(c) + "\n");
    setTimeout(() => {
      p.stdin.end(); p.kill();
      const msgs = out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      resolve(msgs);
    }, 1500);
  });
}

const countOf = (db, q) => db.prepare(q).get().c;

async function main() {
  // fixture transcript: prefs round + a tool_use/tool_result round + a final assistant turn
  const lines = [
    { type: "queue-operation" },
    { type: "user", uuid: "u1", message: { role: "user", content: [{ type: "text", text: "I prefer TypeScript and dark mode." }] } },
    { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "Noted." }] } },
    { type: "user", uuid: "u2", message: { role: "user", content: [{ type: "text", text: "Run the tests." }] } },
    { type: "assistant", uuid: "a2", message: { role: "assistant", content: [{ type: "text", text: "Running." }, { type: "tool_use", id: "tu1", name: "Bash", input: { command: "npm test" } }] } },
    { type: "user", uuid: "u3", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "ok passed" }] }] } },
    { type: "assistant", uuid: "a3", message: { role: "assistant", content: [{ type: "text", text: "Tests passed." }] } },
  ];
  fs.writeFileSync(TX, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

  console.log("\n[capture] capture-worker.mjs (offline stub providers)");
  const cap = await run("hooks/capture-worker.mjs", {
    args: [JSON.stringify({ session_id: SID, transcript_path: TX, cwd: ROOT, dataDir: DATA })],
  });
  ok(cap.code === 0, "worker exits 0");
  ok(fs.existsSync(DB_PATH), "per-container DB created");
  {
    const db = new Database(DB_PATH, { readonly: true });
    ok(countOf(db, "SELECT COUNT(*) c FROM chunks") === 4, `4 round-chunks stored (got ${countOf(db, "SELECT COUNT(*) c FROM chunks")})`);
    ok(countOf(db, "SELECT COUNT(*) c FROM facts") >= 1, "facts stored (stub extractor)");
    ok(countOf(db, "SELECT COUNT(*) c FROM chunk_embeddings") === 4, "chunk embeddings stored");
    ok(countOf(db, "SELECT COUNT(*) c FROM chunks WHERE content LIKE '%[tool result name=Bash]%'") === 1, "tool result mapped into a chunk");
    ok(countOf(db, "SELECT COUNT(*) c FROM chunks WHERE content LIKE '%[tool_call name=Bash%'") === 1, "tool_call folded into a chunk");
    ok(countOf(db, "SELECT COUNT(*) c FROM chunks WHERE content_hash IS NOT NULL") === 4, "all chunks content-hashed (dedup key)");
    db.close();
  }

  console.log("\n[retrieve] retrieve.mjs --mode=prompt → additionalContext");
  const ret = await run("hooks/retrieve.mjs", {
    args: ["--mode=prompt", `--data=${DATA}`],
    stdin: JSON.stringify({ cwd: ROOT, session_id: SID, prompt: "what do I prefer?" }),
  });
  let ctx = "";
  try { ctx = JSON.parse(ret.out).hookSpecificOutput?.additionalContext || ""; } catch {}
  ok(ret.code === 0, "retrieve exits 0");
  ok(ctx.includes("<greymemory-context>") && ctx.includes("stubbed memory"), "injects <greymemory-context> with a stored memory");

  console.log("\n[mcp] server.mjs over stdio JSON-RPC");
  const msgs = await mcp([
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "itest", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "grey_search", arguments: { query: "preferences" } } },
  ]);
  const toolList = msgs.find((m) => m.id === 2)?.result?.tools?.map((t) => t.name) || [];
  const searchText = msgs.find((m) => m.id === 3)?.result?.content?.[0]?.text || "";
  ok(["grey_search", "grey_add", "grey_profile"].every((t) => toolList.includes(t)), `tools/list → all three (got ${toolList.join(",")})`);
  ok(searchText.includes("stubbed memory"), "grey_search returns a stored memory");

  console.log("\n[dedup] re-run capture-worker → UUID cursor yields nothing new");
  const before = (() => { const db = new Database(DB_PATH, { readonly: true }); const c = countOf(db, "SELECT COUNT(*) c FROM chunks"); db.close(); return c; })();
  const cap2 = await run("hooks/capture-worker.mjs", {
    args: [JSON.stringify({ session_id: SID, transcript_path: TX, cwd: ROOT, dataDir: DATA })],
  });
  const after = (() => { const db = new Database(DB_PATH, { readonly: true }); const c = countOf(db, "SELECT COUNT(*) c FROM chunks"); db.close(); return c; })();
  ok(cap2.code === 0 && after === before, `re-run added no chunks (${before} → ${after})`);

  fs.rmSync(DATA, { recursive: true, force: true });
  console.log(failed ? "\n✗ integration tests FAILED" : "\n✓ all integration tests passed");
  process.exit(failed);
}

main().catch((e) => { console.error("integration harness error:", e); process.exit(1); });
