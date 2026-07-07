// The Claude Code plugin's OWN extraction prompt — kept separate from greymemory's library
// prompt (src/prompts.js), which is tuned for the LongMemEval benchmark. This one is adapted
// from Supermemory's claude-supermemory extractor: focus on the USER's intent, condense the
// assistant's output, and extract decisions / actions / preferences / learnings while skipping
// generic explanation the user didn't act on.
//
// Wired via greymemory's `extractorPrompt` option (see lib/memory.mjs) so it replaces the
// library's buildExtractorPrompt for the EXTRACTION phase only. It MUST instruct the model to
// emit greymemory's JSON memory array — the rest of the pipeline parses that exact shape.

/**
 * @param {object} opts
 * @param {string|Array<{role:string,content:string}>} opts.input  conversation (messages) or text
 * @param {Array<{key:string,value:string,memory_type:string}>} [opts.existingFacts]  current memories
 * @param {string} opts.documentDate  ISO date of the session
 * @param {string} [opts.entityContext]  prior-facts / who-context (threaded per round by the library)
 * @returns {string}
 */
export function buildCodingExtractorPrompt({ input, existingFacts = [], documentDate, entityContext = "" }) {
  const conversation = Array.isArray(input) ? JSON.stringify(input, null, 2) : String(input ?? "");
  const existing = existingFacts.slice(0, 20).map((f) => `- [${f.memory_type}] ${f.value}`).join("\n");

  return `Developer coding session transcript. Focus on the USER's message and intent.
Session date: ${documentDate}
${entityContext ? `\nPRIOR CONTEXT (resolve references against this):\n${entityContext}\n` : ""}
RULES:
- Extract the USER's actions, decisions, preferences, and learnings — not every detail the assistant provides.
- Condense assistant responses into what the user gained or decided.
- Skip granular facts and generic explanations the user did not confirm or use.

EXTRACT:
- Research:    "researched whisper.cpp for speech recognition"
- Actions:     "built auth flow with JWT", "fixed memory leak in useEffect"
- Preferences: "prefers Tailwind over CSS modules"
- Decisions:   "chose SQLite for local storage"
- Learnings:   "learned about React Server Components"

SKIP:
- Every fact the assistant merely mentions (condense to the user's action)
- Generic assistant explanations the user did not confirm or use

Each memory must be ONE atomic, self-contained sentence a stranger could understand —
resolve pronouns and vague references to concrete names, files, and commands.

OUTPUT — return ONLY a JSON array (no prose, no markdown). Each item:
{
  "key": "<short snake_case concept, e.g. employer, language_preference, bug_fix>",
  "value": "<the memory as one self-contained sentence>",
  "memory_type": "fact" | "preference" | "episode",
  "event_date": "YYYY-MM-DD or null",
  "expires_at": "YYYY-MM-DD or null (episodes only)",
  "context": "<one sentence: why it is worth remembering>",
  "source_message_index": "<0-based index of the source message, or null>"
}

CONVERSATION:
${conversation}
${existing ? `
Existing memories — skip near-duplicates, but DO extract anything new, more detailed, or contradictory:
${existing}
` : ""}`;
}
