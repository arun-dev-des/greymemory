// Tiny IO helpers shared by the hook scripts and CLIs.
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

/** Parse a `--flag=value` argument from argv. Returns null if absent. */
export function argOf(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + "="));
  return a ? a.slice(flag.length + 1) : null;
}

/**
 * Resolve the persistent data dir.
 * Priority: explicit --data arg → GREYMEMORY_DATA → CLAUDE_PLUGIN_DATA → ~/.greymemory-cc
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
