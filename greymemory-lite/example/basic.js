// greymemory-lite end-to-end demo.
// Run: ANTHROPIC_API_KEY=your_key node example/basic.js
// Requires: Ollama running locally with mxbai-embed-large pulled
//   (brew install ollama && ollama pull mxbai-embed-large)

import Memory, { formatForReading, parseReadingAnswer } from "../src/index.js";

// ── Extractor — receives a built prompt, returns the raw model text ──
const extractor = async (prompt) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json",
    },
    body: JSON.stringify({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages:   [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  return data.content[0].text.trim();
};

// ── Embedder — local Ollama, nothing leaves the box ──
const embedder = async (text) => {
  const res = await fetch("http://localhost:11434/api/embeddings", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model: "mxbai-embed-large", prompt: text }),
  });
  return (await res.json()).embedding;
};

const memory = new Memory({ extractor, embedder, dir: ".greymemory-lite-example", container: "demo" });

// ── Session 1: ingest a conversation (one extraction call per round) ──
console.log("Session 1: ingesting...");
const r1 = await memory.add([
  { role: "user", content: "Hi, my name is Arun and I train powerlifting at Barbell Cartel in Bangalore" },
  { role: "assistant", content: "Great to meet you Arun!" },
  { role: "user", content: "I compete in the 83kg category" },
  { role: "assistant", content: "That is a competitive weight class!" },
], { date: "2026-05-01", sessionId: "session-1", dedupBySession: true });
console.log(`  rounds: ${r1.chunksStored}, facts: ${r1.factsStored}, LLM calls: ${r1.llmCalls.total}`);

// ── Session 2: things changed ──
console.log("Session 2: Arun moved gyms...");
await memory.add([
  { role: "user", content: "I recently switched to training at Iron Temple in Chennai. Much better equipment." },
  { role: "assistant", content: "A new gym and a new city!" },
], { date: "2026-06-01", sessionId: "session-2", dedupBySession: true });

// ── Everything stored — the transparency surface ──
console.log("\nAll memories:");
for (const m of memory.getMemories()) console.log(`  [${m.memory_type}] ${m.value}  (${m.document_date})`);

// ── Search: hybrid BM25 + vector + RRF; zero LLM calls ──
console.log('\nSearch: "where does Arun train"');
const results = await memory.search("where does Arun train", { topN: 5 });
for (const r of results) console.log(`  memory: ${r.memory ?? "(raw chunk)"}\n  chunk:  ${(r.chunk ?? "").slice(0, 70)}...\n`);

// ── Reading (CP4): contradictions resolved by the reader, chronologically ──
const prompt = formatForReading({
  question: "Where does Arun train now, and where did he train before?",
  questionDate: "2026-06-10",
  results,
});
const answer = parseReadingAnswer(await extractor(prompt));
console.log("Answer:", answer);

// ── Profile injection for system prompts ──
const { profile } = await memory.getProfile();
console.log("\nProfile  static:", profile.static, "\n        dynamic:", profile.dynamic);

// ── Forget (soft delete) ──
console.log("\nForgetting the weight class...");
console.log("  forgot:", await memory.forget("83kg weight class"));

// ── Cleanup ──
memory.clear();
console.log("\nCleared. Memories left:", memory.getMemories().length);
