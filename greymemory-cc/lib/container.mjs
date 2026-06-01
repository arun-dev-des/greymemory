// Derives a greymemory container tag for the current project.
//
// container = project isolation (constructor-only in greymemory; one DB namespace per repo).
// Keyed off the git remote (stable across clones) → `repo_<name>`, falling back to a hash of
// the git toplevel / cwd → `proj_<sha16>`. Result is cached per cwd under the data dir so we
// don't shell out to git on every (blocking) hook invocation.
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const sanitize = (s) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

function gitOut(cmd, cwd) {
  try {
    return execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function computeFromGit(root) {
  const remote = gitOut("git config --get remote.origin.url", root);
  if (remote) {
    const name = sanitize(remote.replace(/.*[/:]/, "").replace(/\.git$/, ""));
    if (name) return `repo_${name}`;
  }
  const top = gitOut("git rev-parse --show-toplevel", root) || root;
  return `proj_${crypto.createHash("sha256").update(top).digest("hex").slice(0, 16)}`;
}

export function resolveContainer(cwd, dataDir) {
  if (process.env.GREYMEMORY_CONTAINER) return sanitize(process.env.GREYMEMORY_CONTAINER);

  const root = cwd || process.cwd();
  const cacheFile = path.join(dataDir, "containers.json");

  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch { /* no cache */ }
  if (cache[root]) return cache[root];

  const tag = computeFromGit(root);
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    cache[root] = tag;
    fs.writeFileSync(cacheFile, JSON.stringify(cache));
  } catch { /* cache write is best-effort */ }
  return tag;
}
