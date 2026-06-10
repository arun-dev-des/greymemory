/**
 * buildExtractorPrompt
 *
 * Single prompt — everything the LLM needs in one string.
 * Called on every add() call.
 *
 * @param {object} opts
 * @param {string|Array<{role:string,content:string}>} opts.input        text or messages array
 * @param {Array<{key:string,value:string,memory_type:string}>} opts.existingFacts  current memories for this container
 * @param {string} opts.today          ISO date string — today's date
 * @param {string} [opts.filterPrompt] what to index and what to skip
 * @param {string} [opts.entityContext] who this memory belongs to
 */
// Static instruction block — byte-IDENTICAL across every extraction call, so a
// consumer can send it as an Anthropic prompt-cache prefix (Task 8.2; see the
// extractor in benchmark/run.js). All per-call dynamic content (session date,
// filter, entity context, the input, existing memories) lives in the dynamic
// suffix appended by buildExtractorPrompt — it must NEVER appear in here, or the
// prefix stops being stable and the cache never hits.
export const EXTRACTOR_STATIC_PREFIX = `You are a memory extraction system for an AI agent.

STEP 1 — RESOLVE ALL AMBIGUITY

Before extracting anything, read the entire conversation and resolve every vague reference.

SELF-CONTAINMENT TEST: Every memory must pass this test —
"Could a complete stranger who has never seen this conversation understand this sentence with zero prior context?"

Apply the stranger test to every memory before extracting it:

  BAD:  "Alex works as a PM"  ← if the conversation mentions Stripe
        Stranger asks: PM where? FAILS — company is knowable but missing.
  GOOD: "Alex works as a PM at Stripe"
        Company resolved from conversation. PASSES.

  NOTE: If the company is not mentioned anywhere in the conversation,
        "Alex works as a PM" is acceptable — do not invent what isn't there.

  BAD:  "She moved there last month"
        Stranger asks: Who is she? Where is there? FAILS.
  GOOD: "Sarah moved to San Francisco last month"
        PASSES.

  BAD:  "He joined them in February"
        Stranger asks: Who? Joined what? FAILS.
  GOOD: "Alex joined Stripe in February 2026"
        PASSES.

  BAD:  "User moved there for the job"
        Stranger asks: Moved where? What job? FAILS.
  GOOD: "Alex moved to San Francisco for his PM role at Stripe"
        PASSES.

  BAD:  "Switched to TypeScript last year"
        Stranger asks: Who switched? FAILS.
  GOOD: "Arun switched from JavaScript to TypeScript in 2025"
        PASSES.

  BAD:  "Leads a small team"
        Stranger asks: Who leads? What team? FAILS.
  GOOD: "Alex leads a team of 8 engineers at Stripe"
        PASSES.

  BAD:  "She works at the office downtown"
        Stranger asks: Who? Which office? FAILS.
  GOOD: "Sarah works at the Stripe office in San Francisco"
        PASSES.

  BAD:  "Alex started last month"
        Stranger asks: Started what? When exactly? FAILS.
  GOOD: "Alex started at Stripe in March 2026"
        PASSES.

-- ASSISTANT EXAMPLES --
  BAD:  "[Restaurant name] is good for [meal type]"
        Stranger asks: Who said this? Recommended by whom? FAILS.
  GOOD: "The assistant recommended [Restaurant name] in [city] for [meal type]."
        Source is clear. PASSES.

  BAD:  "[State] requires companies to follow [regulation]"
        Stranger asks: Who stated this? In what context? FAILS.
  GOOD: "The assistant stated that [State] requires companies to [regulation]."
        Source and context clear. PASSES.

  BAD:  "[Person] is assigned to [shift] on [day]"
        Stranger asks: Where does this come from? FAILS.
  GOOD: "The assistant provided a schedule where [Person] works [shift] on [day]."
        Source clear. PASSES.

  BAD:  "[Product] is compatible with [device]"
        Stranger asks: Who said this? Fact or recommendation? FAILS.
  GOOD: "The assistant recommended [Product] as compatible with [device]."
        Source clear. PASSES.

Resolve all of the following before extracting:
- Pronouns → actual names
- Vague references → specific names and places
- Relative dates → approximate real dates (use the session date given in SESSION CONTEXT below)
- Implicit subjects → explicit
- Incomplete descriptions → add missing context from the conversation
- Assistant statements → make the assistant the explicit subject

Never use: he, she, they, it, there, here, that, this, the company, the team, the project
Always use: the actual name, place, or thing being referred to.
For assistant messages: always use "The assistant recommended/stated/explained/provided..."

PROVENANCE RULE:
When extracting from an assistant message, the value sentence MUST make
the assistant the explicit subject of the action.

  BAD:  "[X] is a good option for [purpose]"
  GOOD: "The assistant recommended [X] for [purpose]"

  BAD:  "[Location] requires [regulation]"
  GOOD: "The assistant stated that [Location] requires [regulation]"

  BAD:  "The schedule has [Person] on [shift]"
  GOOD: "The assistant provided a schedule where [Person] works [shift]"

This ensures retrieval queries like "what did you recommend?" or "what did
you say about X?" match strongly against stored facts.

STEP 2 — CLASSIFY AND EXTRACT ATOMIC MEMORIES

Extract memories from both user and assistant messages.
Assistant responses may contain factual data, structured outputs, schedules,
lists, or tables created on behalf of the user — treat these as extractable
facts about the user's context, not as generic information.

Memory types:

FACT: stable information that persists until contradicted
  - "Alex works at Stripe as PM since February 2025"
  - "greymemory uses SQLite for storage"

PREFERENCE: behavioral patterns that strengthen with repetition
  - "Arun prefers TypeScript over JavaScript"
  - "Alex prefers morning meetings"

EPISODE: time-bound events that expire naturally
  - "Alex has an exam tomorrow" → expires after tomorrow
  - "Meeting with Sarah at 3pm today" → expires after today

ASSISTANT CONTENT RULE:
When the assistant provides specific factual content — names, numbers,
recipes, regulations, recommendations, schedules, lists — extract
the concrete claims as facts using the PROVENANCE RULE.

If the entire conversation is a generic Q&A with no user-specific context,
extract the 2-3 most specific named claims from the assistant's response.
Do not return an empty array for a conversation that contains substantive
factual content.

Do not extract generic explanatory prose or hedged statements. Extract only
the concrete claims with their specific named entities.

Use the PROVENANCE RULE to make the assistant the subject:
  "The assistant recommended X"
  "The assistant explained that Y"
  "The assistant stated Z"

Example:
  User: "Can you recommend a good Italian restaurant in [city]?"
  Assistant: "[Restaurant name] is excellent for [meal type] — their
              [dish] is outstanding."
  → Extract: "The assistant recommended [Restaurant name] in [city] for
              [meal type], noting their [dish]."

STATE CHANGE RULE:
When the user mentions a quantity, frequency, location, duration, or status
that describes their CURRENT situation, ALWAYS extract it as a fact — even
if stated casually mid-sentence as an aside.

These are state changes that override earlier information:
  - Counts: "I have 15 books now", "I've added 3 more to my collection"
  - Durations: "I've been here for 6 months", "I spend about 3 hours a day"
  - Frequencies: "I go 5 times a week now", "I switched to daily practice"
  - Locations: "I moved my desk to the living room", "I keep them in the garage now"
  - Statuses: "I switched to a new provider", "I'm using a different app now"

Do not skip these because they appear inside a longer sentence about
something else. The aside IS the important information.

Rules:
1. CRITICAL: ONE fact per memory object. Never combine multiple facts into one.

   BAD  → "Arun is a product designer who prefers TypeScript and works in Bangalore"
   GOOD → "Arun is a product designer"
           "Arun prefers TypeScript over JavaScript"
           "Arun is based in Bangalore"

   Why this matters: each memory gets its own embedding. Combined facts produce
   weak embeddings that match nothing well. Atomic facts produce strong, precise
   embeddings that surface exactly when needed.

2. Extract factual data from tables and structured lists in assistant responses,
   especially when the user requested that data.
   For each table:
     - First read the column headers to understand what each column represents
     - Then for each row, extract one fact combining the row identifier
       with each column header and its corresponding cell value,
       expressed as a natural language sentence.
     - When the table appears in an ASSISTANT message, prefix with
       "The assistant provided..." so the source is retrievable.
   Do not extract the table schema, headers, or structure as standalone facts.

   ASSISTANT TABLE EXAMPLE:
     | Day       | Col A      | Col B      |
     | Sunday    | Alice      | Bob        |
     | Monday    | Dave       | Eve        |

   → "The assistant provided a schedule where on Sunday, Col A = Alice, Col B = Bob."
   → "The assistant provided a schedule where on Monday, Col A = Dave, Col B = Eve."

   USER TABLE EXAMPLE (user shared data):
   → "On Sunday, Col A = Alice, Col B = Bob."

   Each row becomes one separate fact. Never combine multiple rows into one fact.
   When multiple versions of the same table exist, extract ONLY from the
   most recent final version with actual values — ignore earlier drafts.

3. When a single user statement contains multiple distinct pending actions,
   extract each action as a separate episode even if they involve the same
   item or location.

4. Each memory must be completely self-contained — apply the stranger test
5. Include WHO, WHAT, WHEN where available
6. Be specific not vague
7. Apply filter instructions strictly
8. source_message_index: 0-based index of the message this fact was extracted from.
   Use the index of the MOST SPECIFIC message that contains this information.
   If derived from multiple messages: use the message that contains the key evidence.
   If input is a plain DOCUMENT (not a conversation array), or if uncertain: null

STEP 3 — TEMPORAL GROUNDING

For every memory set these three fields:

document_date: always the session date (given in SESSION CONTEXT below) — when this conversation happened

event_date: when the event actually occurred or will occur — NOT the session date
  This is the most important field for temporal reasoning. Extract it carefully.

  How to calculate event_date:
  - Explicit date → use it directly
      "I started at Stripe on February 1st 2023" → event_date: "2023-02-01"
  - Month + year → use the month
      "I joined in February 2023" → event_date: "2023-02"
  - Relative to session date → calculate from the session date given below
      "I started last month" (session: 2023-05-20) → event_date: "2023-04"
      "I joined two years ago" (session: 2023-05-20) → event_date: "2021-05"
      "I started last Monday" (session: 2023-05-20) → event_date: "2023-05-15"
  - Future event → calculate forward from session date
      "I have a meeting next Friday" (session: 2023-05-20) → event_date: "2023-05-26"
  - Vague past with no anchor → null
      "I used to live in London" with no time reference → event_date: null
  - Ongoing state with no start → null
      "Alex works at Stripe" with no start date mentioned → event_date: null

  Only store what is actually known. Never invent precision that wasn't in the conversation.

expires_at: only for episodes — when the episode becomes irrelevant
  - "exam tomorrow" (session: 2023-05-20) → expires_at: "2023-05-21"
  - "meeting at 3pm today" (session: 2023-05-20) → expires_at: "2023-05-20"
  - null for all facts and preferences

STEP 4 — RETURN JSON ARRAY

Return ONLY a valid JSON array. No markdown. No preamble.
Do NOT include derived or inferred memories — the system generates those automatically.

KEY NAMING RULES — the key is a short generic concept identifier, not a description:
  GOOD: "employer", "location", "role", "language_preference", "meeting_tomorrow"
  BAD:  "alex_current_employer", "alex_works_at_stripe", "user_city", "arun_preference"
  - Never include the entity name in the key
  - Never include the value in the key
  - Use the same key for the same concept across sessions ("employer" always means employer)
  - Short snake_case — 1-3 words maximum

[
  {
    "key":         "employer",
    "value":       "atomic memory as a complete self-contained sentence",
    "memory_type": "fact | preference | episode",
    "event_date":  "YYYY-MM-DD or null",
    "expires_at":  "YYYY-MM-DD or null (episodes only)",
    "context":     "one sentence explaining why this is worth remembering",
    "source_message_index": "0-based index of the source message in a conversation, or null"
  }
]`

// Per-call dynamic suffix: session context + the input + existing memories.
// Kept strictly AFTER the static prefix so the prefix stays byte-identical and
// cacheable. The session date is restated here (it left the prefix).
function buildExtractorDynamicSuffix({
  input,
  existingFacts = [],
  documentDate,
  filterPrompt = '',
  entityContext = '',
}) {
  const isConversation = Array.isArray(input)
  const inputLabel     = isConversation ? 'CONVERSATION' : 'DOCUMENT'
  const inputBody      = isConversation
    ? JSON.stringify(input, null, 2)
    : input

  return `--- SESSION CONTEXT ---
Session date: ${documentDate}
${filterPrompt ? `
--- FILTER INSTRUCTIONS ---
${filterPrompt}
Apply strictly. Do not extract content marked as skip.
---` : ''}
${entityContext ? `
--- ENTITY CONTEXT ---
${entityContext}
Use this to resolve ambiguous references in the conversation.
---` : ''}

For every memory: document_date = ${documentDate}; compute event_date relative to ${documentDate} per STEP 3.

${inputLabel}:
${inputBody}
${existingFacts.length > 0 ? `
Existing memories — skip ONLY if content is identical or near-identical.

Always extract if the new content:
  - Contradicts an existing memory ("now works at Stripe" vs "works at Google") → extract it, system will resolve the contradiction
  - Adds new detail to an existing memory ("PM at Stripe" vs "works at Stripe") → extract it, system will link it
  - Is completely new information with no relation to existing memories → extract it

Do NOT extract:
  - Exact or near-exact duplicates of memories listed below
  - Logical inferences or second-order conclusions — the system derives these automatically

${existingFacts.slice(0, 20).map(f => `- [${f.memory_type}] ${f.value}`).join('\n')}
` : ''}`
}

/**
 * Full extraction prompt = stable static prefix + per-call dynamic suffix.
 *
 * The returned string ALWAYS begins with {@link EXTRACTOR_STATIC_PREFIX}, so a
 * consumer that wants Anthropic prompt caching can split on that boundary and
 * mark the prefix block `cache_control: { type: 'ephemeral' }` (the static
 * block is large enough to cache and identical across calls — ~90% input-token
 * saving on the repeated portion, which dominates round-mode ingest cost).
 */
export function buildExtractorPrompt(opts) {
  return `${EXTRACTOR_STATIC_PREFIX}\n\n${buildExtractorDynamicSuffix(opts)}`
}

/**
 * buildTimeRangeExtractionPrompt
 *
 * Asks an LLM (M_T in LongMemEval §5.4) to extract a date range from a user's
 * question. The output bounds are applied as a filter on the `event_date`
 * column at retrieval time — so the range must describe WHEN THE EVENT
 * OCCURRED, not when the question is being asked.
 *
 * Paper finding (§5.4, Table 4): a strong M_T gives +11.3% temporal recall;
 * a weak M_T (Llama 8B in the paper) hallucinates ranges and makes recall
 * WORSE than baseline. The prompt below leans heavily on examples and a
 * "return nulls when uncertain" instruction to keep weaker models honest.
 *
 * @param {object} opts
 * @param {string} opts.query  the user question
 * @param {string} opts.today  ISO YYYY-MM-DD — date the question is being asked
 *                              (use `asOf` when retrieving from a historical
 *                              point so "last month" resolves correctly)
 */
export function buildTimeRangeExtractionPrompt({ query, today }) {
  return `You extract a date range from a user's question so a memory system can filter retrieval to events that happened in that range.

Today's date: ${today}

Return a JSON object with exactly two fields:
{
  "afterDate":  "YYYY-MM-DD" | null,
  "beforeDate": "YYYY-MM-DD" | null
}

The range describes WHEN THE EVENT BEING ASKED ABOUT OCCURRED — not when the question is being asked.

RULES
1. If the question has NO temporal cue, return {"afterDate": null, "beforeDate": null}.
2. If only one side of the range is constrained, set the other to null.
3. Use \`today\` to resolve relative phrases ("last month", "two weeks ago").
4. Be CONSERVATIVE. A wrong range filters out the correct answer. When uncertain whether a phrase carries a temporal cue, return nulls.
5. Always return YYYY-MM-DD (full ISO). For "April 2024" use afterDate "2024-04-01" and beforeDate "2024-04-30".
6. Return ONLY the JSON object. No prose, no markdown.

EXAMPLES

Q: "What did I eat for breakfast last week?"
today: 2024-05-20
→ {"afterDate": "2024-05-13", "beforeDate": "2024-05-19"}

Q: "When did I switch from Vim to VSCode?"
today: 2024-05-20
→ {"afterDate": null, "beforeDate": null}
(question asks WHEN — no bound is implied; let retrieval find the event)

Q: "What movies did I watch in January 2024?"
today: 2024-05-20
→ {"afterDate": "2024-01-01", "beforeDate": "2024-01-31"}

Q: "What have I been working on since I joined Stripe?"
today: 2024-05-20
→ {"afterDate": null, "beforeDate": null}
(open-ended start "since I joined" cannot be resolved without knowing the join date — return nulls and let retrieval do its work)

Q: "Where do I work?"
today: 2024-05-20
→ {"afterDate": null, "beforeDate": null}

Q: "What did I do two weeks ago?"
today: 2024-05-20
→ {"afterDate": "2024-05-06", "beforeDate": "2024-05-06"}

Q: "What was on my calendar yesterday?"
today: 2024-05-20
→ {"afterDate": "2024-05-19", "beforeDate": "2024-05-19"}

Q: "What books did I read in 2023?"
today: 2024-05-20
→ {"afterDate": "2023-01-01", "beforeDate": "2023-12-31"}

Q: "Did I meet Sarah before the conference?"
today: 2024-05-20
→ {"afterDate": null, "beforeDate": null}
(the conference date is not in the question — cannot resolve)

QUESTION
${query}

Return ONLY the JSON object.`
}
