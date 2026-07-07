// Tiny IO helpers shared by the hook scripts and CLIs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Read the hook's stdin JSON payload. Resolves {} on TTY / parse error (never throws). */
export function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve({});
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => (buf += d));
    process.stdin.on("end", () => {
      try { resolve(JSON.parse(buf)); } catch { resolve({}); }
    });
  });
}

/** Write a hook result object to stdout as JSON. */
export function writeOutput(obj) {
  process.stdout.write(JSON.stringify(obj));
}

/**
 * Parse a JSONL file into an array of entry objects (skips unparseable lines).
 * Lives here, not in transcript.mjs, so that module stays a pure entries->messages transform
 * with no fs dependency. cursor.mjs (readNewEntries) is the consumer.
 */
export function readJsonl(p) {
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

/** Parse a `--flag=value` argument from argv. Returns null if absent. */
export function argOf(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.slice(flag.length + 1) : null;
}

/**
 * Resolve the persistent data dir.
 * Priority: explicit --data arg -> GREYMEMORY_DATA -> CLAUDE_PLUGIN_DATA -> ~/.greymemory-cc
 * (The arg is the reliable path: ${CLAUDE_PLUGIN_DATA} is expanded into the hook command
 * string, but is not guaranteed to be exported as an env var into the spawned process.)
 */
export function resolveDataDir(argDir) {
  return (
    argDir ||
    process.env.GREYMEMORY_DATA ||
    process.env.CLAUDE_PLUGIN_DATA ||
    path.join(os.homedir(), ".greymemory-cc")
  );
}
