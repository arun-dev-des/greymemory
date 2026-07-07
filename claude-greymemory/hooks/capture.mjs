#!/usr/bin/env node
// Stop hook. MUST return fast: Claude Code waits for this process to EXIT before the turn
// completes, so we cannot await the full add() pipeline here (extractor LLM + N embedder
// calls would block the turn under the timeout). Instead we hand the work to a detached
// worker and exit immediately. Capture is best-effort — it never blocks Claude.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { readStdin, writeOutput, argOf, resolveDataDir } from "../lib/io.mjs";

const input = await readStdin(); // { session_id, transcript_path, cwd, hook_event_name }
const dataDir = resolveDataDir(argOf("--data"));

// --- TEMP DEBUG (remove later): log the real expanded paths every time Stop fires ---
try {
  const debugLog = path.join(os.homedir(), "greymemory-hook-debug.log");
  const lines = [
    `[${new Date().toISOString()}] Stop hook fired`,
    `  --data arg (the expanded \${CLAUDE_PLUGIN_DATA}) : ${argOf("--data")}`,
    `  resolved dataDir                               : ${dataDir}`,
    `  env.CLAUDE_PLUGIN_ROOT                          : ${process.env.CLAUDE_PLUGIN_ROOT ?? "(unset)"}`,
    `  env.CLAUDE_PLUGIN_DATA                          : ${process.env.CLAUDE_PLUGIN_DATA ?? "(unset)"}`,
    `  this script's own dir                          : ${path.dirname(fileURLToPath(import.meta.url))}`,
    "",
  ].join("\n");
  fs.appendFileSync(debugLog, lines + "\n");
} catch {}
// --- end TEMP DEBUG ---

if (input && input.session_id && input.transcript_path) {
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture-worker.mjs");
  const child = spawn(
    process.execPath,                                // "node"
    [worker, JSON.stringify({ ...input, dataDir })], // run the worker, hand it all our data
    { detached: true, stdio: "ignore" }
  );
  child.unref(); // let the worker outlive this hook process
}

writeOutput({ continue: true }); //everything's fine, carry on with the session.
process.exit(0); // ends the hook (0 = success)
