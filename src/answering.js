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
   Recency only resolves between memories that describe THE SAME thing.

   RELEVANCE CHECK (apply this BEFORE any recency reasoning):
   - A memory whose value matches the question's qualifier IS relevant.
     Do not label it "Not relevant" because another memory has a later
     date. Date does not decide relevance — qualifier match does.
   - The question's qualifier (e.g. "morning meeting" vs "meeting",
     "remote job" vs "job", "company laptop" vs "laptop") is part of
     what's being asked. A memory missing the qualifier is a DIFFERENT
     fact, not a more recent version of the same fact.

   RECENCY (apply only AFTER the relevance check):
   - Among memories that share the qualifier, the most recent version
     (highest recorded_on) is the current truth.
   - If a memory has relation_type UPDATES, it explicitly supersedes the
     previous version — trust the supersession edge.
   - For time-specific questions, use the version that was current at the time asked.

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
function _buildContextItems(results, topN) {
  const topResults = results.slice(0, topN)

  // Capture retrieval/rerank order BEFORE the chronological sort below. The
  // chronological sort aids temporal reasoning but otherwise discards the
  // relevance signal; `relevance_rank` (1 = best match) preserves it so the
  // reader can break ties toward the more relevant item.
  const relevanceRankByRef = new Map()
  topResults.forEach((r, i) => relevanceRankByRef.set(r, i + 1))

  // chronological sort — null document_date pushed to the end
  const sorted = [...topResults].sort((a, b) => {
    const da = a.document_date ?? '9999-12-31'
    const db = b.document_date ?? '9999-12-31'
    return da.localeCompare(db)
  })

  // ── supersession merge ──
  // When both the current fact and one or more of its historical predecessors
  // are in the retrieved set, render them as ONE item with `previous_values`
  // instead of N contradictory items. Index the slice up-front so the greedy
  // pass below can resolve `_expansion.supersededBy.id` → the current item.
  const byMemoryId = new Map()
  const historicalByCurrentId = new Map()  // current.id → [historicalResult, ...]
  for (const r of sorted) {
    if (r.id != null) byMemoryId.set(r.id, r)
    if (r._expansion?.via === 'UPDATES_HISTORY' && r._expansion.supersededBy?.id != null) {
      const curId = r._expansion.supersededBy.id
      if (!historicalByCurrentId.has(curId)) historicalByCurrentId.set(curId, [])
      historicalByCurrentId.get(curId).push(r)
    }
  }

  const consumed = new Set()  // ids of predecessors merged into a `previous_values` of another item
  const items = []

  for (const r of sorted) {
    if (r.id != null && consumed.has(r.id)) continue

    const base = {
      index:         items.length + 1,
      relevance_rank: relevanceRankByRef.get(r) ?? null,
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

    // Case 1 — current fact with retrieved predecessors → merge into one item
    if (r.id != null && historicalByCurrentId.has(r.id)) {
      const predecessors = historicalByCurrentId.get(r.id)
      // newest-first ordering: latest predecessor's valid_until is THIS item's
      // document_date; older predecessors' valid_until is the next-newer
      // predecessor's document_date.
      const sortedPreds = [...predecessors].sort((a, b) => {
        const da = a.document_date ?? '0000-01-01'
        const db = b.document_date ?? '0000-01-01'
        return db.localeCompare(da)  // newest first
      })
      const previous_values = sortedPreds.map((p, i) => {
        const validUntil = i === 0
          ? (r.document_date ?? null)
          : (sortedPreds[i - 1].document_date ?? null)
        return {
          value:      p.memory ?? null,
          valid_until: validUntil,
          recorded:   p.document_date ?? null,
        }
      })
      for (const p of sortedPreds) {
        if (p.id != null) consumed.add(p.id)
      }
      items.push({
        ...base,
        // replace `memory` with explicit current_value / previous_values shape
        memory:           undefined,
        current_value:    r.memory ?? null,
        current_recorded: r.document_date ?? null,
        previous_values,
      })
      continue
    }

    // Case 2 — orphan historical (current version not in retrieved set)
    if (r._expansion?.via === 'UPDATES_HISTORY') {
      const supId = r._expansion.supersededBy?.id
      if (supId == null || !byMemoryId.has(supId)) {
        items.push({
          ...base,
          superseded: true,
          see_also:   'current version not in retrieved set; treat as past state',
        })
        continue
      }
      // current IS in the set — this predecessor will be (or was) consumed
      // by case 1 when we process the current. Skip emitting it standalone.
      continue
    }

    // Case 3 — EXTENDS expansion: keep the existing version_note prose
    // (refinement context still reads well as a string)
    if (r._expansion?.via === 'EXTENDS') {
      const depth = r._expansion.depth ?? 1
      base.version_note = `context for a related fact (EXTENDS chain, depth ${depth})`
      items.push(base)
      continue
    }

    // Default — no expansion, no merge
    items.push(base)
  }

  // Strip undefined `memory` keys from merged items so JSON.stringify drops them.
  for (const it of items) {
    if (it.memory === undefined) delete it.memory
  }

  return items
}

// Detects suggestion / advice / personalization-shaped requests ("any tips?",
// "can you suggest a hotel...", "what should I serve..."). These need the
// personalized reading mode in formatForReadingV2: the factual rules fail them
// three ways (benchmark run 2026-06-10, SSP 4/15): the abstention rule fires on
// requests where abstention is never correct (5/11 misses answered "I don't
// know" with the gold preference IN the window), the `answers` rule outputs the
// stored fact verbatim instead of suggestions built on it, and topic-matching
// anchors tag person-shaped context ("experiments with turbinado sugar")
// off-topic for topic-shaped requests ("improve my cookies").
function _isPersonalizationRequest(question) {
  const q = String(question || '')
  return (
    /\b(any|some|got any|do you have any)\s+(helpful\s+|other\s+|good\s+)?(tips|advice|suggestions|recommendations|ideas|pointers)\b/i.test(q) ||
    /\b(can|could|would)\s+you\s+(please\s+)?(suggest|recommend|propose|advise)\b/i.test(q) ||
    /\b(suggest|recommend)\s+(a|an|some|any|the best|good)\b/i.test(q) ||
    /\bwhat\s+(should|could|would|can)\s+i\b/i.test(q) ||
    /\bhelp me\s+(choose|pick|plan|find|decide|come up with)\b/i.test(q) ||
    /\bi'?m not sure\s+(what|which|where|how|whether)\b/i.test(q) ||
    /\b(tips|advice|suggestions|recommendations|ideas)\s*\?/i.test(q) ||
    /\bwhat\s+do\s+you\s+(think|suggest|recommend)\b/i.test(q)
  )
}

// Returns just the retrieved-context string the answerer sees — the JSON
// items block from formatForReading, without the surrounding question +
// instructions. Use this to measure supermemory-style `contextTok` (tokens
// in just the context the memory provider returns).
export function formatRetrievedContext(results = [], topN = 10) {
  const items = _buildContextItems(results, topN)
  return items.length === 0 ? '(no memories retrieved)' : JSON.stringify(items, null, 2)
}

export function formatForReading({
  question,
  questionDate,
  results = [],
  profile = null,
  topN = 10,
  // eslint-disable-next-line no-unused-vars
  asOf = null,
  // CoN v2 (anchors + 3-tier scoring + self-check) is the default: it fixed a
  // 47–58% gold-memory false-negative rate that v1's binary relevant/not-relevant
  // tagging produced (benchmark runs 2026-05-25/26). Pass version:'v1' to opt out.
  version = 'v2',
  // 'auto' (default) switches to the personalized reading mode when the question
  // is suggestion/advice-shaped; 'factual' / 'personalized' force a mode. v2 only.
  mode = 'auto',
}) {
  if (version === 'v2') {
    return formatForReadingV2({ question, questionDate, results, profile, topN, mode })
  }
  const items = _buildContextItems(results, topN)
  const N = items.length
  const jsonItemsBlock = items.length === 0 ? '(no memories retrieved)' : JSON.stringify(items, null, 2)

  // Pre-scan: items the system has resolved to a current value — either by
  // ingestion-time UPDATES classification, or by the supersession-merge
  // surfacing a `previous_values` chain in `_buildContextItems`. Banner the
  // model with them by index so the chain-of-note walk can't drift into
  // treating them as historical.
  const updatesItems = items.filter(it =>
    (it.relation_type === 'UPDATES' && it.memory) || it.previous_values
  )
  const updatesBanner = updatesItems.length === 0 ? '' : `
--- CURRENT VALUES (system-resolved) ---
The following items have been flagged by the system as the CURRENT value
for their topic (they superseded an older memory during ingestion):
${updatesItems.map(it => `  • Item [${it.index}]: ${it.current_value ?? it.memory}`).join('\n')}
If the question asks about any of these topics, the answer is the value of
the listed item. Do not relabel these items as historical or superseded.
---
`

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
--- RETRIEVED MEMORIES (JSON, sorted chronologically; version chains merged) ---
${jsonItemsBlock}
---
${updatesBanner}
CHAIN OF NOTE — process every item before answering.

Step 1 — For EACH item 1..${N}, write exactly one line:
  [i] <one-line note on what this item contributes, or "not relevant">

  Process all ${N} items, in order. Do NOT skip items.
  Do not write more than one line per item.
  If an item is named in the CURRENT VALUES block above, mark it relevant.
  If an item has a "previous_values" field, its current_value is the
  authoritative present-tense answer; previous_values are for past-state
  questions only.
  If an item has "superseded": true (or a version_note string), mark it
  as past state only — never invent the "historical" label yourself.

Step 2 — Write the final answer:
  • If the CURRENT VALUES block lists an item that addresses the question,
    the answer is the value of that item.
  • Otherwise, use the items you marked relevant in Step 1. If two same-topic
    items are untagged, prefer the later document_date.
  • If no item is relevant, respond with exactly "I don't know" — do not
    infer from profile data, do not guess, do not fill gaps.
  • For "did you switch from X" / "more than before" / change questions:
    - If a merged item has previous_values, compare its current_value
      against the most recent entry in previous_values.
    - Otherwise fall back to comparing a CURRENT VALUES item against the
      version_note-tagged historical item.

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

/**
 * formatForReadingV2
 *
 * A redesigned Chain-of-Note prompt that fixes the false-negative gold-memory
 * rejection observed in benchmark runs 2026-05-25 / 2026-05-26 (47–58% of
 * retrieved gold-session items wrongly tagged `[i] Not relevant` by v1).
 *
 * Key changes vs `formatForReading`:
 *   • Step 0 — Topic anchors. The model must list the entity/attribute/event
 *     it is scoring against before the per-item loop. Multi-clause and yes/no
 *     questions list every anchor.
 *   • Step 1 — 3-tier scoring. `answers / related / off-topic` replaces the
 *     binary relevant/not-relevant tag. The `off-topic` tag requires a quoted
 *     noun phrase from the item, blocking the v1 rubber-stamp shortcut.
 *   • Explicit paraphrase-tolerance reminder — tag by topic, not by wording.
 *   • Step 1.5 — Self-check. Re-read off-topic items; flip the tag if their
 *     quoted noun phrase shares a head noun with any anchor.
 *   • Step 2 — Sharpened superlative handling. For "most recent / latest /
 *     first / earliest" questions, list every `answers`-tagged item and
 *     compare event_date (preferred) then document_date inline.
 *
 * The CURRENT VALUES banner remains the sole authority for present-tense
 * knowledge-update questions — supersession behavior is unchanged.
 *
 * Reuses `_buildContextItems` — the JSON shape, supersession merge, and
 * `previous_values` chain rendering are identical. Only the instructions
 * block differs. The parser at benchmark/run.js handles both tag vocabularies.
 *
 * @param {object} opts                       same shape as formatForReading
 * @returns {string}                          a ready-to-send prompt string
 */
export function formatForReadingV2({
  question,
  questionDate,
  results = [],
  profile = null,
  topN = 10,
  // 'auto' | 'factual' | 'personalized'. Auto detects suggestion/advice-shaped
  // requests from the question text alone and switches to the personalized
  // instruction block below; 'factual' forces the original behavior.
  mode = 'auto',
}) {
  const personalized = mode === 'personalized' ||
    (mode !== 'factual' && _isPersonalizationRequest(question))

  // Personalized window: user-context (preference-type) items frequently arrive
  // via graph expansion at positions beyond topN and were being sliced off
  // before the reader ever saw them (benchmark 2026-06-10: one SSP question had
  // 5 of its 6 preference facts cut). Pull sliced-off preference items back
  // into the window (capped) — RRF/rerank order is preserved for the head.
  let windowResults = results
  let windowTopN = topN
  if (personalized) {
    const head = results.slice(0, topN)
    const tailPrefs = results.slice(topN).filter(r => r.memory_type === 'preference').slice(0, 8)
    windowResults = [...head, ...tailPrefs]
    windowTopN = windowResults.length
  }

  const items = _buildContextItems(windowResults, windowTopN)
  const N = items.length
  const jsonItemsBlock = items.length === 0 ? '(no memories retrieved)' : JSON.stringify(items, null, 2)

  const updatesItems = items.filter(it =>
    (it.relation_type === 'UPDATES' && it.memory) || it.previous_values
  )
  const updatesBanner = updatesItems.length === 0 ? '' : `
--- CURRENT VALUES (system-resolved) ---
The following items have been flagged by the system as the CURRENT value
for their topic (they superseded an older memory during ingestion):
${updatesItems.map(it => `  • Item [${it.index}]: ${it.current_value ?? it.memory}`).join('\n')}
If the question asks about any of these topics, the answer is the value of
the listed item. Do not relabel these items as historical or superseded.
---
`

  const profileSection = profile ? `
--- USER PROFILE ---
Stable facts and preferences:
${profile.static.length > 0 ? profile.static.map(s => `- ${s}`).join('\n') : '(none)'}

Recent context:
${profile.dynamic.length > 0 ? profile.dynamic.map(d => `- ${d}`).join('\n') : '(none)'}
---
` : ''

  // ── Personalized reading mode ──────────────────────────────────────────
  // For suggestion/advice requests the factual block below fails three ways
  // (all observed on benchmark 2026-06-10, SSP 4/15 → see commit message):
  // its abstention rule fires on requests where abstention is never correct,
  // its `answers` rule outputs the stored fact verbatim instead of advice
  // built on it, and its topic-anchors tag person-shaped context off-topic.
  // This block inverts those rules: context-tagging by usefulness-to-the-
  // request, a mandatory generative answer that names the user's context, and
  // no bare abstention.
  if (personalized) {
    return `You are a personal assistant with access to a user's memory store.

Request: ${question}
Request date: ${questionDate}
${profileSection}
--- RETRIEVED MEMORIES (JSON, sorted chronologically; version chains merged) ---
${jsonItemsBlock}
---
${updatesBanner}
This request asks for suggestions, advice, or help. The items above are the
user's KNOWN CONTEXT — their preferences, possessions, habits, skills, past
purchases, plans, and constraints. A good answer responds to the request AND
visibly uses this context. Generic advice that ignores the user's context is
a failure. "I don't know" is a worse one.

Step 0 — Anchors:
  Anchors: <the request topic, AND the kinds of user context that could shape
  the answer (relevant gear they own, tastes, skills, routines, prior plans)>

Step 1 — For EACH item 1..${N}, write exactly one line, in order:
  [i] context: <quoted phrase — a user preference/possession/habit/skill/plan/constraint usable for this request>
  [i] related: <one phrase — touches the request topic without a usable detail>
  [i] off-topic: item discusses <quoted noun phrase from the item>

  Rules:
  • Process all ${N} items, in order. Do NOT skip items. Each quoted phrase
    MUST come verbatim from THAT item — never reuse a quote across items.
  • An item about the USER (what they own, like, do, or plan) is "context"
    even when its topic differs from the request topic. Example: for "how do
    I improve my cookies?", "the user experiments with turbinado sugar" is
    context, not off-topic.

Step 1.5 — Self-check (do not skip):
  Re-read every "off-topic" line. If that item states ANY user preference,
  possession, habit, skill, or plan that could inform this request, re-tag it:
  "[i] (revised) context: <quote>".

Step 2 — Write the final answer:
  • Answer the request directly with concrete, helpful suggestions or advice.
  • Weave in the user's context by name — reference their specific gear,
    purchases, skills, classes, or stated preferences from the "context"
    items, so the advice is visibly personalized.
  • Do NOT answer with a description of the user ("The user likes X") — answer
    TO the user with suggestions built on what they like.
  • NEVER answer "I don't know" or "not enough information". If no item is
    context or related, give your best general answer to the request and note
    that no stored context was found for this topic.
  • Write the answer as one single paragraph (2–5 sentences) on one line.

Output format:
  Anchors: <list>

  Notes:
  [1] <tag>: <note>
  ...
  [${N}] <tag>: <note>

  (Revisions, if any from Step 1.5:)
  [i] (revised) context: <quote>

  Answer: <your personalized suggestions, one paragraph>
`
  }

  return `You are a question-answering system with access to a user's memory store.

Question: ${question}
Question date: ${questionDate}
${profileSection}
--- RETRIEVED MEMORIES (JSON, sorted chronologically; version chains merged) ---
${jsonItemsBlock}
---
${updatesBanner}
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
  • If an item is named in the CURRENT VALUES block above, tag it
    "answers" with the banner's value.
  • If an item has a "previous_values" field, its current_value is the
    authoritative present-tense answer; previous_values are for past-state
    questions only.
  • If an item has "superseded": true (or a version_note string), tag it
    "related" with a note like "past state per version_note" — never invent
    the "historical" label yourself.
  • The quoted phrase in "answers" and "off-topic" MUST come verbatim from
    the item — no paraphrasing, no inventing.

Step 1.5 — Self-check (cheap, do not skip):
  Re-read every line you tagged "off-topic". For any such item whose quoted
  noun phrase shares a head noun (or its singular/plural form) with any
  anchor from Step 0, re-tag it as "related" or "answers". Write the
  corrected line as "[i] (revised) <new tag>: <new note>".

Step 2 — Write the final answer:
  • If the CURRENT VALUES block lists an item that addresses the question,
    the answer is the value of that item.
  • Otherwise, list every "answers"-tagged item (including those promoted in
    Step 1.5). If the question contains a superlative — "most recent",
    "latest", "first", "earliest", "before/after X" — compare the candidates'
    event_date (preferred) then document_date INLINE before picking. Show the
    comparison, e.g. "Item [3] event 2023-04-12 vs Item [7] event 2023-08-30
    → [7] is later → answer from [7]".
  • If two same-topic "answers" items have no date to compare, prefer the
    later document_date.
  • For change questions ("did you switch from X", "more than before"):
    - If a merged item has previous_values, compare its current_value
      against the most recent entry in previous_values.
    - Otherwise compare a CURRENT VALUES item against the version_note-tagged
      historical item.
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
`
}