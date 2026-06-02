// transcript.mjs
// Claude Code JSONL transcript entries -> clean { role, content }[] for greymemory.add().
//
// The transcript is a noisy append-only event log. Beyond the conversation it carries:
//   - bookkeeping rows  (queue-operation, ai-title, file-history-snapshot, last-prompt, attachment)
//   - assistant messages split across rows that share one message.id
//   - tool results delivered on *user*-role rows
//   - system-injected pseudo-user rows: <ide_*> context, <task-notification>, <command-*>,
//     "[Request interrupted ...]" notices, and "Error:/API Error" lines - none of which the
//     person typed.
//   - message.content that is EITHER an array of blocks OR a bare string.
// This module folds all of that into the alternating user->assistant stream add()'s greedy
// pairing turns into round chunks. Pure transform: no fs (readJsonl lives in io.mjs).
//
// What each round becomes:  { user: <what you typed> } + { assistant: <the text answer> }
// Dropped by default: thinking, tool_use, raw tool_result dumps, <ide_*> context,
//                     injected pseudo-user rows, bookkeeping.
// Why dropping tools is safe (conversational mode): the assistant's text answer already
// distills the tool output.
//
// OPT-IN (coding-agent mode): pass { captureTools: [...] } to fold a compact one-line
// summary of results from those tools into the assistant turn - mirroring Supermemory's
// captureTools allowlist (Edit/Write/Bash/Task). OFF by default - output is byte-for-byte
// identical to conversational mode.

const IDE_TAG = /<(ide_[a-z_]+)>[\s\S]*?<\/\1>/g;

// Injected non-prompt user rows: a whole-message that is just a system tag block, an
// interruption/notice in [brackets], or a raw error line. Matched against the FULL text.
const INJECTED_USER =
  /^\s*(?:<(?:ide_[a-z_]+|task-notification|command-[a-z]+|system-[a-z]+|local-command-[a-z]+)>[\s\S]*|\[(?:Request interrupted|[^\]]*\binterrupted\b)[^\]]*\][\s\S]*|(?:API\s+)?Error:[\s\S]*|Caused by:[\s\S]*)$/i;

const TOOL_RESULT_CAP = 500; // chars - dilution control on captured tool output

// message.content is either a string or an array of blocks. Always hand back an array.
function blocksOf(message) {
  const c = message?.content;
  if (Array.isArray(c)) return c;
  if (typeof c === "string") return c ? [{ type: "text", text: c }] : [];
  return [];
}

// All consecutive assistant rows sharing a message.id are ONE logical turn.
// Keep text blocks; drop thinking (internal) and tool_use (plumbing).
function foldAssistantText(group) {
  return group
    .flatMap((r) => blocksOf(r.message))
    .filter((b) => b?.type === "text")
    .map((b) => (b.text ?? "").trim())
    .filter(Boolean)
    .join("\n\n");
}

// A user row is a tool-result carrier (not a prompt) if any block is a tool_result.
function isToolResultRow(row) {
  return blocksOf(row.message).some((b) => b?.type === "tool_result");
}

// Concatenated text of a user row (string- or array-form content).
function userText(row) {
  return blocksOf(row.message)
    .filter((b) => b?.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");
}

// Real user prompt text with <ide_*> context stripped. Returns "" when the row was
// only injected context / a notice / an error (i.e. nothing the person actually typed).
// Order matters: CC prepends <ide_*> context to the SAME row as the typed prompt, so we
// strip the ide-tags BEFORE the injected/empty test. Testing the raw text first would let
// the greedy INJECTED_USER pattern (^\s*<ide_...>[\s\S]*) swallow the whole row and drop the
// real prompt that follows the context.
function cleanUserPrompt(row) {
  const stripped = userText(row).replace(IDE_TAG, "").trim();
  if (INJECTED_USER.test(stripped)) return "";
  return stripped;
}

// Plain text of a single tool_result block (its content is string- or array-form).
function toolResultText(block) {
  const c = block?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .filter((b) => b?.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
  }
  return "";
}

/**
 * Convert Claude Code transcript entries to a clean, strictly-alternating message stream.
 *
 * @param {object[]} entries  parsed JSONL entries (e.g. from readNewEntries)
 * @param {object} [opts]
 * @param {string[]} [opts.captureTools]  tool names whose results should be folded into the
 *        assistant turn as a compact "[tool result name=... ok|error] ..." line. Default []
 *        (drop all results - conversational mode). Set e.g. ["Edit","Write","Bash","Task"]
 *        for coding-agent capture.
 * @returns {{role:'user'|'assistant', content:string}[]}  strictly alternating, ready for add()
 */
export function entriesToMessages(entries, opts = {}) {
  const captureSet = new Set(opts.captureTools ?? []);
  const captureResults = captureSet.size > 0;

  // 1. keep only conversation rows, preserve file order
  const conv = (entries ?? []).filter(
    (e) => e?.type === "user" || e?.type === "assistant"
  );

  // 1a. (coding mode only) map tool_use_id -> tool name from assistant tool_use blocks,
  //     so a tool_result (which carries only tool_use_id) can be matched to its tool.
  const idToName = new Map();
  if (captureResults) {
    for (const r of conv) {
      if (r.type !== "assistant") continue;
      for (const b of blocksOf(r.message)) {
        if (b?.type === "tool_use" && b.id) idToName.set(b.id, b.name);
      }
    }
  }

  // 2. fold into logical turns (assistant rows merged by message.id; user rows pass through)
  const logical = [];
  for (let i = 0; i < conv.length; ) {
    const r = conv[i];
    if (r.type === "assistant") {
      const mid = r.message?.id;
      const group = [r];
      let j = i + 1;
      // null/undefined message.id never merges across rows (treat each as its own turn)
      while (
        mid != null &&
        j < conv.length &&
        conv[j].type === "assistant" &&
        conv[j].message?.id === mid
      ) {
        group.push(conv[j]);
        j++;
      }
      logical.push({ role: "assistant", text: foldAssistantText(group) });
      i = j;
    } else if (isToolResultRow(r)) {
      // tool_result carrier. Default: drop. Coding mode: keep allowlisted tools' results
      // as a compact summary line, tagged so add()'s extractor reads it as tool output.
      if (captureResults) {
        const lines = [];
        for (const b of blocksOf(r.message)) {
          if (b?.type !== "tool_result") continue;
          const name = idToName.get(b.tool_use_id) ?? "tool";
          if (!captureSet.has(name)) continue; // skip non-allowlisted tools
          const txt = toolResultText(b).replace(/\s+/g, " ").trim().slice(0, TOOL_RESULT_CAP);
          const status = b.is_error ? "error" : "ok";
          if (txt) lines.push(`[tool result name=${name} ${status}] ${txt}`);
          else lines.push(`[tool result name=${name} ${status}]`);
        }
        logical.push({ role: "tool_result", text: lines.join("\n") });
      } else {
        logical.push({ role: "tool_result", text: "" }); // dropped in step 3
      }
      i++;
    } else {
      logical.push({ role: "user", text: cleanUserPrompt(r) }); // "" if injected/notice/error
      i++;
    }
  }

  // 3. group into rounds. A round opens at the first real user prompt and stays open until
  //    the next real user prompt. Consecutive prompts with no assistant/tool content between
  //    them (common after an interruption) are MERGED into the open round's prompt, so the
  //    output never emits user->user. Empty (injected) user turns are skipped. tool_result
  //    text (coding mode) folds into the open round's assistant content.
  const messages = [];
  let pendingUser = null; // [prompt, ...] for the open round, or null between rounds
  let answer = [];        // assistant + captured-tool text accumulating for the open round

  const flush = () => {
    if (pendingUser == null) return;
    const u = pendingUser.filter(Boolean).join("\n\n").trim();
    const a = answer.join("\n\n").trim();
    pendingUser = null;
    answer = [];
    if (!u) return; // every prompt fragment was injected/empty -> drop the round
    messages.push({ role: "user", content: u });
    if (a) messages.push({ role: "assistant", content: a }); // omit if turn-in-progress
  };

  for (const t of logical) {
    if (t.role === "user") {
      if (!t.text) continue;            // injected/notice/error row -> ignore entirely
      if (pendingUser != null && answer.length === 0) {
        pendingUser.push(t.text);       // consecutive prompt, no answer yet -> merge
      } else {
        flush();                        // close the previous (answered) round
        pendingUser = [t.text];         // open a new one
      }
    } else if (t.role === "assistant" && pendingUser != null && t.text) {
      answer.push(t.text);              // dispatch-only turns contribute "" and add nothing
    } else if (t.role === "tool_result" && pendingUser != null && t.text) {
      answer.push(t.text);              // coding mode: captured tool output -> assistant side
    }
    // empty tool_result (conversational mode): ignored
  }
  flush(); // close the final round

  return messages;
}
