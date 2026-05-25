/**
 * buildAnsweringPrompt
 *
 * Builds the prompt for answering a question using retrieved memories.
 * Used by the benchmark runner and can be used by developers directly.
 *
 * @deprecated Use {@link formatForReading} instead. The new helper emits a
 * JSON + Chain-of-Note prompt that the LongMemEval paper (§5.5) showed adds
 * ~10 absolute points to answerer accuracy. This function is preserved for
 * regression comparison only — new code should call formatForReading().
 *
 * @param {object} opts
 * @param {string} opts.question           the question to answer
 * @param {string} opts.questionDate       when the question was asked (ISO date)
 * @param {Array}  opts.results            search results from memory.search()
 * @param {object} [opts.profile]          optional profile from memory.getProfile()
 * @param {number} [opts.topN]             max results to include in prompt (default 10)
 */
export function buildAnsweringPrompt({
  question,
  questionDate,
  results = [],
  profile = null,
  topN = 10,
}) {
  const topResults = results.slice(0, topN)

  // format each result with all temporal and relational metadata
  const formattedResults = topResults.map((r, i) => {
    const lines = []
    lines.push(`[${i + 1}]`)
    lines.push(`Memory:        ${r.memory}`)

    if (r.chunk && r.chunk !== r.memory) {
      lines.push(`Source chunk:  ${r.chunk}`)
    }

    lines.push(`Type:          ${r.memory_type}`)
    lines.push(`Confidence:    ${r.confidence ?? 1.0}`)

    if (r.document_date) {
      lines.push(`Recorded on:   ${r.document_date}`)
    }
    if (r.event_date) {
      lines.push(`Event date:    ${r.event_date}`)
    }
    if (r.relation_type) {
      lines.push(`Relation:      ${r.relation_type}`)
    }

    return lines.join('\n')
  }).join('\n\n')

  // format profile if provided
  const profileSection = profile ? `
--- USER PROFILE ---
Stable facts and preferences:
${profile.static.length > 0 ? profile.static.map(s => `- ${s}`).join('\n') : '(none)'}

Recent context:
${profile.dynamic.length > 0 ? profile.dynamic.map(d => `- ${d}`).join('\n') : '(none)'}
---
` : ''

  return `You are a question-answering system with access to a user's memory store.

Question: ${question}
Question date: ${questionDate}
${profileSection}
--- RETRIEVED MEMORIES ---
${formattedResults || '(no memories retrieved)'}
---

HOW TO READ THE MEMORIES:

Memory — the atomic extracted fact. High signal, precise.
Source chunk — the raw conversation the memory came from. Use for detail and nuance.
Recorded on — when this conversation happened (document_date).
Event date — when the event actually occurred (may differ from recorded date).
Confidence — how certain this memory is. DERIVES memories (confidence < 1.0) are inferences, not stated facts.
Relation — UPDATES means this memory supersedes an older one. EXTENDS means it adds detail to another.

HOW TO ANSWER:

1. TEMPORAL REASONING
   If the question references a specific time ("in January 2023", "before he moved", "last year"):
   - Use event_date to find memories that match the time window
   - Prefer memories whose event_date falls within the referenced period
   - If a memory has relation_type UPDATES, it supersedes the previous version —
     use the recorded_on date to determine which version was current at the time asked

2. KNOWLEDGE UPDATES
   If multiple memories describe the same fact at different times:
   - The most recent version (highest recorded_on) is the current truth
   - For time-specific questions, use the version that was current at the time asked

3. CONFIDENCE AND INFERENCE
   - Memories with confidence < 1.0 are system-inferred (DERIVES) — not directly stated by the user
   - For factual questions, prefer directly stated memories over inferences
   - You may use inferences to support an answer but flag them as such

4. ABSTENTION
   If the retrieved memories do not contain enough information to answer the question:
   - Respond with exactly: "I don't know"
   - Do not guess, infer beyond what is stated, or use profile data to fill gaps
   - Partial answers are acceptable if some but not all information is available

5. SOURCE PRIORITY
   - Use source chunks for detail and exact wording
   - Use memories for finding the right result quickly
   - Use profile for background context about who the user is

Instructions:
  If the context contains enough information to answer the question, provide a clear, concise answer
  If the context does not contain enough information, respond with "I don't know" or explain what information is missing
  Base your answer ONLY on the provided context
  Prioritize information from chunks - they're the raw source material
  Match your answer format to the question — if the question expects a number, name, date, or yes/no, lead with that directly without preamble or explanation first
  When counting, treat each distinct action or transaction as a separate item — do not collapse multiple actions into one even if they involve the same object or location.
  When calculating the number of days between two dates, count inclusively — include the start date in the count.

Answer:`
}

/**
 * formatForReading
 *
 * Builds a JSON + Chain-of-Note (CoN) answering prompt. Per LongMemEval §5.5
 * (Wu et al., ICLR 2025, arXiv:2410.10813, Figure 6), this combination adds
 * ~10 absolute points to answerer accuracy over plain-prose rendering.
 *
 * JSON and CoN are intentionally bundled — the paper shows JSON without CoN
 * underperforms plain prose. There is no flag to split them.
 *
 * Retrieved items are rendered as a pretty-printed JSON array, sorted by
 * document_date ascending (null dates last). The CoN instruction forces the
 * answerer to write one note per item BEFORE answering, which surfaces
 * irrelevant items explicitly and improves abstention.
 *
 * The underlying `results` array is not mutated — sort is presentation only.
 *
 * @param {object} opts
 * @param {string} opts.question           the question to answer
 * @param {string} opts.questionDate       when the question was asked (ISO date)
 * @param {Array}  opts.results            search results from memory.search()
 * @param {object} [opts.profile]          optional profile from memory.getProfile()
 * @param {number} [opts.topN]             max results to include (default 10)
 * @param {string} [opts.asOf]             reserved for future date-anchoring (unused today)
 * @returns {string}                       a ready-to-send prompt string
 */
export function formatForReading({
  question,
  questionDate,
  results = [],
  profile = null,
  topN = 10,
  // eslint-disable-next-line no-unused-vars
  asOf = null,
}) {
  const topResults = results.slice(0, topN)

  // chronological sort — null document_date pushed to the end
  const sorted = [...topResults].sort((a, b) => {
    const da = a.document_date ?? '9999-12-31'
    const db = b.document_date ?? '9999-12-31'
    return da.localeCompare(db)
  })

  const items = sorted.map((r, i) => {
    const item = {
      index:         i + 1,
      memory:        r.memory ?? null,
      chunk:         (r.chunk && r.chunk !== r.memory) ? r.chunk : null,
      type:          r.memory_type ?? null,
      confidence:    r.confidence ?? 1.0,
      document_date: r.document_date ?? null,
      event_date:    r.event_date ?? null,
      relation_type: r.relation_type ?? null,
      source_role:   r.source_role ?? null,
      session_id:    r.session_id ?? null,
    }

    // _expansion.seedId is a fact-db id, not a list position — SearchResult
    // does not expose its own id, so we can't remap it to a post-sort index.
    // The superseder value is embedded inline (same as the legacy prose
    // renderer at benchmark/run.js); the id reference is informational.
    if (r._expansion?.via === 'UPDATES_HISTORY') {
      const sup = r._expansion.supersededBy?.value ?? '(unknown)'
      item.version_note = `HISTORICAL — superseded by the current fact: "${sup}". This describes past state, not current state.`
    } else if (r._expansion?.via === 'EXTENDS') {
      const depth = r._expansion.depth ?? 1
      item.version_note = `context for a related fact (EXTENDS chain, depth ${depth})`
    }

    return item
  })

  const N = items.length
  const jsonItemsBlock = N === 0 ? '(no memories retrieved)' : JSON.stringify(items, null, 2)

  const profileSection = profile ? `
--- USER PROFILE ---
Stable facts and preferences:
${profile.static.length > 0 ? profile.static.map(s => `- ${s}`).join('\n') : '(none)'}

Recent context:
${profile.dynamic.length > 0 ? profile.dynamic.map(d => `- ${d}`).join('\n') : '(none)'}
---
` : ''

  return `You are a question-answering system with access to a user's memory store.

Question: ${question}
Question date: ${questionDate}
${profileSection}
--- RETRIEVED MEMORIES (JSON, sorted chronologically) ---
${jsonItemsBlock}
---

CHAIN OF NOTE — process every item before answering.

Step 1 — For EACH item 1..${N}, write exactly one line:
  [i] <one-line note on what this item contributes, or "not relevant">

  Process all ${N} items, in order. Do NOT skip items.
  Do not write more than one line per item.

Step 2 — Identify contradictions and version chains:
  Items with relation_type="UPDATES" or with a version_note starting "HISTORICAL"
  describe past state that has been superseded. The current value is in the
  item the version_note references. When the question asks about "current",
  "now", or unconditional present-tense state, use the SUPERSEDING item.
  When the question asks about a CHANGE ("did you switch from X", "more
  than before"), compare the historical and current values.

Step 3 — Write the final answer using ONLY the items you marked as relevant
in Step 1. If no item is relevant, respond with exactly "I don't know" —
do not infer from profile data, do not guess, do not fill gaps.

Output format:
  Notes:
  [1] ...
  [2] ...
  ...
  [${N}] ...

  Answer: <your concise answer>

Other rules:
- Base your answer ONLY on the JSON items above.
- Match the question's expected format: a number, name, date, or yes/no goes
  directly in the Answer line without preamble.
- When counting events, treat each distinct action as separate even if it
  involves the same object or location.
- When computing days between two dates, count inclusively (include the start date).
`
}