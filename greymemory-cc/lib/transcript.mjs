// Reads a Claude Code transcript JSONL and maps its entries to greymemory Message[].
//
// STRUCTURED mapping (greymemory >= 0.4 with structured-message support):
//   - text blocks            → content string
//   - assistant tool_use     → tool_calls:[{ id, name, arguments }]   (library serializes them)
//   - user tool_result       → a dedicated { role:'tool', tool_call_id, name, content } message
//                              (CC records tool results under role:'user'; we lift them out so
//                               the library tags source_role 'tool' and the extractor sees them)
//   - image blocks           → '[image]' placeholder in content (never the URL)
//   - thinking blocks        → dropped
// The library's _normalizeMessages folds tool_calls into the assistant text and prefixes tool
// results with '[tool result name=...]', so we pass structure through and let it normalize.
import fs from "node:fs";

// Strip our own injected context so a later capture never re-ingests it.
const STRIP_RE =
  /<system-reminder>[\s\S]*?<\/system-reminder>|<greymemory-context>[\s\S]*?<\/greymemory-context>/g;

export const clean = (s) =>
  typeof s === "string" ? s.replace(STRIP_RE, "").trim() : "";

const truncate = (s, n) => (s.length > n ? s.slice(0, n) + " …[truncated]" : s);

// A tool_result's content may be a string or an array of content blocks.
function textOf(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n");
  }
  if (content == null) return "";
  try { return JSON.stringify(content); } catch { return String(content); }
}

/** Parse a JSONL file into an array of entry objects (skips unparseable lines). */
export function readJsonl(p) {
  return fs
    .readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// CC tool_result blocks carry only tool_use_id, not the tool name. Pre-scan the
// assistant tool_use blocks to recover id → name so results can be labelled.
function buildToolUseMap(entries) {
  const map = {};
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const b of e.message.content) {
      if (b.type === "tool_use" && b.id) map[b.id] = b.name;
    }
  }
  return map;
}

/**
 * Convert CC transcript entries → structured greymemory Message[].
 * Only `user` / `assistant` entries become messages (the rest is bookkeeping noise).
 */
export function entriesToMessages(entries) {
  const toolNames = buildToolUseMap(entries);
  const out = [];

  for (const e of entries) {
    if (e.type !== "user" && e.type !== "assistant") continue;
    const msg = e.message;
    if (!msg || !msg.role) continue;

    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: "text", text: msg.content }];

    const textParts = [];
    const toolCalls = [];

    for (const b of blocks) {
      switch (b.type) {
        case "text": {
          const t = clean(b.text);
          if (t) textParts.push(t);
          break;
        }
        case "image":       // Anthropic/CC shape: { type:'image', source:{...} }
        case "image_url":   // OpenAI-ish shape: { type:'image_url', imageUrl:{url} }
          textParts.push("[image]");
          break;
        case "tool_use":
          toolCalls.push({ id: b.id, name: b.name, arguments: b.input ?? {} });
          break;
        case "tool_result": {
          // Lift the tool result into its own role:'tool' message.
          const t = clean(textOf(b.content));
          out.push({
            role: "tool",
            tool_call_id: b.tool_use_id,
            name: toolNames[b.tool_use_id] ?? "tool",
            content: b.is_error ? `[error] ${truncate(t, 500)}` : truncate(t, 500),
          });
          break;
        }
        // thinking and unknown blocks: dropped
        default:
          break;
      }
    }

    // Emit the text/tool_calls message for this entry, if anything survived.
    if (textParts.length || toolCalls.length) {
      const m = { role: msg.role === "user" ? "user" : "assistant" };
      m.content = textParts.join("\n");   // may be '' — the library folds tool_calls into content
      if (toolCalls.length) m.tool_calls = toolCalls;
      out.push(m);
    }
  }

  return out;
}
