// Packs the package, extracts the tarball, and imports it from OUTSIDE the
// repo — permanently guarding against the bug class that broke greymemory
// 0.4.0 on npm (an entry-point re-export excluded from the published files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpDir, rmDir, stubEmbedder, emptyExtractor } from "./_helpers.mjs";

const pkgRoot = fileURLToPath(new URL("..", import.meta.url));

test("npm pack → extract → import: every export resolves and Memory constructs", async () => {
  const work = tmpDir("gml-pack-");
  try {
    const pack = spawnSync("npm", ["pack", "--pack-destination", work], {
      cwd: pkgRoot, encoding: "utf8",
    });
    assert.equal(pack.status, 0, `npm pack failed: ${pack.stderr}`);
    const tarball = path.join(work, pack.stdout.trim().split("\n").pop());
    assert.ok(fs.existsSync(tarball));

    const untar = spawnSync("tar", ["-xzf", tarball, "-C", work], { encoding: "utf8" });
    assert.equal(untar.status, 0, `tar failed: ${untar.stderr}`);
    const extracted = path.join(work, "package");

    // every file index.js imports must have shipped
    for (const f of ["index.js", "memory.js", "storage.js", "prompts.js", "reading.js", "batch-embedder.js", "index.d.ts"]) {
      assert.ok(fs.existsSync(path.join(extracted, "src", f)), `tarball missing src/${f}`);
    }

    // satisfy the better-sqlite3 dependency offline via the dev install
    const depSrc = path.join(pkgRoot, "node_modules");
    assert.ok(fs.existsSync(path.join(depSrc, "better-sqlite3")), "run npm install in greymemory-lite first");
    fs.symlinkSync(depSrc, path.join(extracted, "node_modules"), "dir");

    const mod = await import(pathToFileURL(path.join(extracted, "src", "index.js")).href);
    const { default: Default, Memory, GreyMemory, formatForReading, parseReadingAnswer,
            buildExtractorPrompt, EXTRACTOR_STATIC_PREFIX, createBatchEmbedder } = mod;

    for (const [name, val] of Object.entries({ Default, Memory, GreyMemory, formatForReading, parseReadingAnswer, buildExtractorPrompt, createBatchEmbedder })) {
      assert.equal(typeof val, "function", `export ${name} must be a function`);
    }
    assert.equal(typeof EXTRACTOR_STATIC_PREFIX, "string");
    assert.equal(Default, Memory);

    // and it actually constructs + round-trips against a fresh db
    const dataDir = path.join(work, "data");
    const memory = new Memory({ extractor: emptyExtractor, embedder: stubEmbedder(), dir: dataDir });
    const res = await memory.add("greymemory-lite packs correctly.");
    assert.equal(res.chunksStored, 1);
  } finally { rmDir(work); }
});
