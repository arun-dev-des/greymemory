/**
 * reading.js — the CP4 reading stage (LongMemEval §5.5).
 *
 * formatForReading builds a JSON + Chain-of-Note (CoN) answering prompt.
 * Per the paper (Wu et al., ICLR 2025, arXiv:2410.10813, Figure 6) this
 * combination adds up to ~10 absolute accuracy points over plain-prose
 * rendering. JSON and CoN are intentionally bundled — the paper shows JSON
 * WITHOUT CoN underperforms plain prose. There is no flag to split them.
 *
 * greymemory-lite has no supersession machinery at ingest, so contradiction
 * resolution happens HERE, by design: retrieved items are sorted
 * chronologically (document_date ascending) and the instructions tell the
 * reader that among same-topic items the latest is the current state and
 * earlier ones are past states. This prompt is the load-bearing piece for
 * knowledge-update questions.
 */

// Shape search results into the JSON items the reader sees. Relevance order
// (1 = best match) is captured BEFORE the chronological sort so the reader
// can break ties toward the more relevant item. The input array is not
// mutated — sort is presentation only.
function _buildContextItems(results, topN) {
  const topResults = results.slice(0, topN);

  const relevanceRankByRef = new Map();
  topResults.forEach((r, i) => relevanceRankByRef.set(r, i + 1));

  // chronological sort — null document_date pushed to the end
  const sorted = [...topResults].sort((a, b) => {
    const da = a.document_date ?? "9999-12-31";
    const db = b.document_date ?? "9999-12-31";
    return da.localeCompare(db);
  });

  return sorted.map((r, i) => ({
    index:          i + 1,
    relevance_rank: relevanceRankByRef.get(r) ?? null,
    memory:         r.memory ?? null,
    chunk:          (r.chunk && r.chunk !== r.memory) ? r.chunk : null,
    type:           r.memory_type ?? null,
    document_date:  r.document_date ?? null,
    event_date:     r.event_date ?? null,
    source_role:    r.source_role ?? null,
    session_id:     r.session_id ?? null,
  }));
}

/**
 * Build the JSON + Chain-of-Note answering prompt.
 *
 * @param {object} opts
 * @param {string} opts.question     the question to answer
 * @param {string} opts.questionDate when the question is being asked (ISO date)
 * @param {Array}  opts.results      search results from memory.search()
 * @param {object} [opts.profile]    optional profile from memory.getProfile()
 * @param {number} [opts.topN]       max results to include (default 10)
 * @returns {string}                 a ready-to-send prompt string
 */
export function formatForReading({
  question,
  questionDate,
  results = [],
  profile = null,
  topN = 10,
}) {
  const items = _buildContextItems(results, topN);
  const N = items.length;
  const jsonItemsBlock = items.length === 0 ? "(no memories retrieved)" : JSON.stringify(items, null, 2);

  const profileSection = profile ? `
--- USER PROFILE ---
Stable facts and preferences:
${profile.static.length > 0 ? profile.static.map(s => `- ${s}`).join("\n") : "(none)"}

Recent context:
${profile.dynamic.length > 0 ? profile.dynamic.map(d => `- ${d}`).join("\n") : "(none)"}
---
` : "";

  return `You are a question-answering system with access to a user's memory store.

Question: ${question}
Question date: ${questionDate}
${profileSection}
--- RETRIEVED MEMORIES (JSON, sorted chronologically by document_date) ---
${jsonItemsBlock}
---

CHAIN OF NOTE — read the rules, then process every item before answering.

Tagging rules (apply to every item):
  Match by TOPIC, not by wording. A paraphrase, synonym, or restatement of
  an anchor is still on-topic. Tag an item by what it is ABOUT, not by
  whether its phrasing overlaps the question.

Step 0 — Topic anchors:
  Anchors: <entity/attribute/event the question is about>
  For multi-clause or yes/no questions, list every anchor, comma-separated.
  For a yes/no question, the anchor is the proposition being tested.

Step 1 — For EACH item 1..${N}, write exactly one line, in order:
  [i] answers: <quoted phrase from the item's memory or chunk that states a value for an anchor>
  [i] related: <one phrase — how the item touches an anchor without stating a value>
  [i] off-topic: item discusses <quoted noun phrase from the item>

  Rules:
  • Process all ${N} items, in order. Do NOT skip items.
  • Do not write more than one line per item.
  • The quoted phrase in "answers" and "off-topic" MUST come verbatim from
    the item — no paraphrasing, no inventing.

Step 1.5 — Self-check (cheap, do not skip):
  Re-read every line you tagged "off-topic". For any such item whose quoted
  noun phrase shares a head noun (or its singular/plural form) with any
  anchor from Step 0, re-tag it as "related" or "answers". Write the
  corrected line as "[i] (revised) <new tag>: <new note>".

Step 2 — Write the final answer:
  • List every "answers"-tagged item (including those promoted in Step 1.5).
    If the question contains a superlative — "most recent", "latest",
    "first", "earliest", "before/after X" — compare the candidates'
    event_date (preferred) then document_date INLINE before picking. Show the
    comparison, e.g. "Item [3] event 2023-04-12 vs Item [7] event 2023-08-30
    → [7] is later → answer from [7]".
  • The items are sorted chronologically. When two or more "answers" items
    state DIFFERENT values for the SAME topic, the one with the latest
    document_date is the CURRENT state and the earlier ones are PAST states.
    Present-tense questions take the current state; "did it change",
    "switch from X", "before", or "more/less than before" questions compare
    the current state against the past states directly.
  • If two same-topic "answers" items have no date to compare, prefer the
    later-indexed item (later in chronological order).
  • If only "related"-tagged items exist and they collectively imply the
    answer, you may answer from them — say "(inferred from related items)".
  • If no item is "answers" or "related", respond with exactly "I don't know"
    — do not infer from profile data, do not guess, do not fill gaps.

Output format:
  Anchors: <list>

  Notes:
  [1] <tag>: <note>
  [2] <tag>: <note>
  ...
  [${N}] <tag>: <note>

  (Revisions, if any from Step 1.5:)
  [i] (revised) <tag>: <note>

  Answer: <your concise answer>

Other rules:
- Base your answer ONLY on the JSON items above.
- Match the question's expected format: a number, name, date, or yes/no goes
  directly in the Answer line without preamble.
- When counting events, treat each distinct action as separate even if it
  involves the same object or location.
- When computing days between two dates, count inclusively (include the start date).
`;
}

/**
 * Extract the final answer from a Chain-of-Note response: everything after
 * the LAST line starting with "Answer:". Falls back to the whole (trimmed)
 * text when no Answer line is present, so callers can always display
 * something.
 */
export function parseReadingAnswer(raw) {
  const text = String(raw ?? "").trim();
  const re = /^Answer:[ \t]*/gm;
  let last = null;
  let m;
  while ((m = re.exec(text)) !== null) last = m;
  if (!last) return text;
  return text.slice(last.index + last[0].length).trim();
}
