#!/usr/bin/env node
// Stop hook. MUST return fast: Claude Code waits for this process to EXIT before the turn
// completes, so we cannot await the full add() pipeline here (extractor LLM + N embedder
// calls would block the turn under the timeout). Instead we hand the work to a detached
// worker and exit immediately. Capture is best-effort — it never blocks Claude.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readStdin, writeOutput, argOf, resolveDataDir } from "../lib/io.mjs";

const input = await readStdin(); // { session_id, transcript_path, cwd, hook_event_name }
const dataDir = resolveDataDir(argOf("--data"));

if (input && input.session_id && input.transcript_path) {
  const worker = path.join(path.dirname(fileURLToPath(import.meta.url)), "capture-worker.mjs");
  const child = spawn(
    process.execPath,
    [worker, JSON.stringify({ ...input, dataDir })],
    { detached: true, stdio: "ignore" }
  );
  child.unref(); // let the worker outlive this hook process
}

writeOutput({ continue: true });
process.exit(0);
