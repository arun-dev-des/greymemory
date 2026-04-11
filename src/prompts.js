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
  today,
  filterPrompt = '',
  entityContext = '',
}) {
  const isConversation = Array.isArray(input)
  const inputLabel     = isConversation ? 'CONVERSATION' : 'DOCUMENT'
  const inputBody      = isConversation
    ? JSON.stringify(input, null, 2)
    : input

  return `You are a memory extraction system for an AI agent.
Today's date: ${today}
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
"Could a complete stranger understand this sentence with zero prior context?"
If the answer is no — resolve it before extracting.

Resolve all of the following:
- Pronouns → actual names
    BAD:  "He joined them in February"
    GOOD: "Alex joined Stripe in February 2026"

- Vague references → specific names
    BAD:  "User moved there for the job"
    GOOD: "Alex moved to San Francisco for his PM role at Stripe"

- Relative locations → explicit places
    BAD:  "She works at the office downtown"
    GOOD: "Sarah works at the Stripe office in San Francisco"

- Relative dates → approximate real dates (today is ${today})
    BAD:  "Alex started last month"
    GOOD: "Alex started at Stripe in March 2026"

- Implicit subjects → explicit
    BAD:  "Switched to TypeScript last year"
    GOOD: "Arun switched from JavaScript to TypeScript in 2025"

- Vague quantities → specific where possible
    BAD:  "Leads a small team"
    GOOD: "Alex leads a team of 8 engineers"

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

2. Each memory must be completely self-contained
3. Include WHO, WHAT, WHEN where available
4. Be specific not vague
5. Apply filter instructions strictly

STEP 3 — TEMPORAL GROUNDING

For every memory:
- document_date: always ${today}
- event_date: when the event actually occurred or will occur (YYYY-MM-DD or null)
- expires_at: only for episodes — when the episode becomes irrelevant (YYYY-MM-DD or null)

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