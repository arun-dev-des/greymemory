// Shared offline test stubs — no network, no API keys, deterministic.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Deterministic bag-of-words embedder: hashes each word into one of `dim`
 * buckets and L2-normalizes. Same text → same vector; word overlap → cosine
 * similarity. Good enough to exercise the vector channel end to end.
 */
export function stubEmbedder(dim = 32) {
  return async (text) => {
    const v = new Array(dim).fill(0);
    for (const word of String(text).toLowerCase().split(/\W+/).filter(Boolean)) {
      let h = 0;
      for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) >>> 0;
      v[h % dim] += 1;
    }
    const mag = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map(x => x / mag);
  };
}

/**
 * Extractor stub. Pass a function (prompt → string) for full control, or an
 * array/string to return the same canned response on every call.
 */
export function stubExtractor(response) {
  if (typeof response === "function") {
    return async (prompt) => response(prompt);
  }
  const text = typeof response === "string" ? response : JSON.stringify(response ?? []);
  return async () => text;
}

/** Extractor that returns '[]' — ingest-only tests with zero facts. */
export const emptyExtractor = stubExtractor("[]");

/** Fresh temp dir for one test's database. */
export function tmpDir(prefix = "gml-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}
