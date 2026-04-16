/**
 * buildAnsweringPrompt
 *
 * Builds the prompt for answering a question using retrieved memories.
 * Used by the benchmark runner and can be used by developers directly.
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