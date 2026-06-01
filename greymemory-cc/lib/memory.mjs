// Shared greymemory factory: constructs Memory with a BYO Anthropic extractor + a pluggable
// embedder (Ollama by default, OpenAI optional), over a per-project SQLite DB.
//
// The DB is opened HERE (not by greymemory's default path logic) so we can set WAL +
// busy_timeout: multiple short-lived hook processes plus the long-lived MCP server all open
// the same file, and greymemory's Storage sets no journal_mode/busy_timeout — without WAL a
// concurrent write throws SQLITE_BUSY and the capture is silently lost.
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import Anthropic from "@anthropic-ai/sdk";
import Memory from "greymemory";

const _cache = new Map(); // container -> Memory

// extractor: receives a prompt string, returns a raw string (greymemory parses it). Required.
// GREYMEMORY_EXTRACTOR selects the provider: "anthropic" (default) or "stub".
function makeExtractor() {
  const provider = process.env.GREYMEMORY_EXTRACTOR || "anthropic";

  // Offline/test seam — deterministic, no network, no API key. Gated behind an explicit env;
  // never active in normal use (default is anthropic). Used by the integration tests and for
  // running the plugin fully offline.
  if (provider === "stub") {
    const canned = process.env.GREYMEMORY_STUB_EXTRACTION ||
      '[{"key":"stub_memory","value":"stubbed memory from the test extractor","source_message_index":0}]';
    return async (_prompt, ctx) => {
      if (ctx?.phase === "relationship")   return '{"type":"NEW"}';
      if (ctx?.phase === "time_extraction") return "{}";
      if (ctx?.phase === "contextualization") return "[CTX] stubbed.";
      return canned; // extraction
    };
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.GREYMEMORY_EXTRACTOR_MODEL || "claude-haiku-4-5-20251001";
  return async (prompt) => {
    const r = await client.messages.create({
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });
    return r.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  };
}

// embedder: receives text, returns number[]. Required. Async because the OpenAI branch
// dynamically imports an optional dependency.
// GREYMEMORY_EMBEDDER: "ollama" (default), "openai", or "stub" (deterministic, offline).
async function makeEmbedder() {
  const provider = process.env.GREYMEMORY_EMBEDDER || "ollama";

  if (provider === "stub") {
    // Deterministic 32-dim hash embedder — offline, no Ollama. For tests / offline runs.
    return async (text) => {
      const s = String(text), v = new Array(32);
      for (let d = 0; d < 32; d++) {
        let h = (d * 7919) ^ 0x9e3779b9;
        for (let i = 0; i < s.length; i++) h = ((h * 131) + s.charCodeAt(i)) | 0;
        v[d] = ((h & 0xffff) / 0xffff) - 0.5;
      }
      return v;
    };
  }

  if (provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const model = process.env.OPENAI_EMBED_MODEL || "text-embedding-3-small";
    return async (text) =>
      (await client.embeddings.create({ model, input: text })).data[0].embedding;
  }

  // Ollama (default, local, free)
  const base = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = process.env.OLLAMA_EMBED_MODEL || "mxbai-embed-large";
  return async (text) => {
    const res = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) throw new Error(`embedder HTTP ${res.status}`);
    return (await res.json()).embedding;
  };
}

/** Build (and memoise) a Memory bound to one project's DB. */
export async function getMemory({ cwd, container, dataDir }) {
  if (_cache.has(container)) return _cache.get(container);

  const dir = path.join(dataDir, container);
  fs.mkdirSync(dir, { recursive: true });

  // Own the connection so we can guarantee WAL + busy_timeout for cross-process safety.
  const db = new Database(path.join(dir, "greymemory.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  const memory = new Memory({
    db,
    container,
    extractor: makeExtractor(),
    embedder: await makeEmbedder(),
    extractionMode: "round", // per-round provenance suits code sessions
    entityContext:
      "Memory for a software engineer's Claude Code sessions. " +
      "Capture decisions, preferences, bugs and fixes, file paths, and architecture choices.",
  });

  _cache.set(container, memory);
  return memory;
}
