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
export function buildExtractorPrompt({
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

  return `You are a memory extraction system for an AI agent.
Session date: ${documentDate}
${filterPrompt ? `
--- FILTER INSTRUCTIONS ---
${filterPrompt}
Apply strictly. Do not extract content marked as skip.
---` : ''}
${entityContext ? `
--- ENTITY CONTEXT ---
${entityContext}
Use this to resolve ambiguous references and focus extraction.
---` : ''}

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

Resolve all of the following before extracting:
- Pronouns → actual names
- Vague references → specific names and places
- Relative dates → approximate real dates (session date is ${documentDate})
- Implicit subjects → explicit
- Incomplete descriptions → add missing context from the conversation

Never use: he, she, they, it, there, here, that, this, the company, the team, the project
Always use: the actual name, place, or thing being referred to.

STEP 2 — CLASSIFY AND EXTRACT ATOMIC MEMORIES

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

Rules:
1. CRITICAL: ONE fact per memory object. Never combine multiple facts into one.

   BAD  → "Arun is a product designer who prefers TypeScript and works in Bangalore"
   GOOD → "Arun is a product designer"
           "Arun prefers TypeScript over JavaScript"
           "Arun is based in Bangalore"

   Why this matters: each memory gets its own embedding. Combined facts produce
   weak embeddings that match nothing well. Atomic facts produce strong, precise
   embeddings that surface exactly when needed.

2. Each memory must be completely self-contained — apply the stranger test
3. Include WHO, WHAT, WHEN where available
4. Be specific not vague
5. Apply filter instructions strictly

STEP 3 — TEMPORAL GROUNDING

Session date: ${documentDate}

For every memory set these three fields:

document_date: always ${documentDate} — when this conversation happened

event_date: when the event actually occurred or will occur — NOT the session date
  This is the most important field for temporal reasoning. Extract it carefully.

  How to calculate event_date:
  - Explicit date → use it directly
      "I started at Stripe on February 1st 2023" → event_date: "2023-02-01"
  - Month + year → use the month
      "I joined in February 2023" → event_date: "2023-02"
  - Relative to session date → calculate from ${documentDate}
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
    "context":     "one sentence explaining why this is worth remembering"
  }
]

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