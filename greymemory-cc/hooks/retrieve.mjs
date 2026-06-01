#!/usr/bin/env node
// SessionStart + UserPromptSubmit hook. Injects relevant memories into Claude's context via
// hookSpecificOutput.additionalContext. Must be fast and must never block: on any error or
// timeout it emits { continue: true } and exits 0.
//   --mode=session-start  → inject the project profile (preferences + recent facts)
//   --mode=prompt         → search on the user's prompt
import { readStdin, writeOutput, argOf, resolveDataDir } from "../lib/io.mjs";
import { getMemory } from "../lib/memory.mjs";
import { resolveContainer } from "../lib/container.mjs";

const mode = argOf("--mode") || "prompt";
const dataDir = resolveDataDir(argOf("--data"));
const input = await readStdin(); // { cwd, prompt, session_id, ... }
const { cwd, prompt } = input;

function renderResults(results) {
  // search() can return chunk-only seeds where memory/memory_type are null — fall back to the
  // chunk text and a "context" tag instead of emitting "(null) null".
  return results
    .map((r) => {
      const text = r.memory ?? r.chunk;
      if (!text) return "";
      return `- (${r.memory_type ?? "context"}) ${text}`;
    })
    .filter(Boolean)
    .join("\n");
}

try {
  const container = resolveContainer(cwd, dataDir);
  const memory = await getMemory({ cwd, container, dataDir });
  let body = "";

  if (mode === "session-start") {
    const { profile } = await memory.getProfile();
    const lines = [...(profile.static ?? []), ...(profile.dynamic ?? [])];
    body = lines.map((l) => `- ${l}`).join("\n");
  } else {
    if (!prompt || prompt.trim().length < 3) {
      writeOutput({ continue: true });
      process.exit(0);
    }
    // timeAwareQuery:false — true would fire an extra extractor LLM call on every prompt,
    // adding latency/cost to a blocking hook. Reserve time-aware expansion for grey_search.
    const results = await memory.search(prompt, { topN: 8, timeAwareQuery: false });
    body = renderResults(results);
  }

  if (!body.trim()) {
    writeOutput({ continue: true });
    process.exit(0);
  }

  writeOutput({
    continue: true,
    hookSpecificOutput: {
      hookEventName: mode === "session-start" ? "SessionStart" : "UserPromptSubmit",
      additionalContext: `<greymemory-context>\nRelevant memories from past sessions:\n${body}\n</greymemory-context>`,
    },
  });
} catch (err) {
  process.stderr.write(`[greymemory-cc] retrieve failed: ${err?.message}\n`);
  writeOutput({ continue: true }); // never block the prompt
}

process.exit(0);
