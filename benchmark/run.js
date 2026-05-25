// benchmark/run.js
// LongMemEval benchmark runner for greymemory
//
// Config:
//   LIMIT = true + PER_CATEGORY = 1  → 1 question per category
//   LIMIT = true + PER_CATEGORY = 10 → 60 questions (full benchmark)
//   LIMIT = null                     → all 500 questions
//   CATEGORY_FILTER = ['single-session-assistant'] → only run specific categories

import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Memory }              from '../src/memory.js'
import { createBatchEmbedder } from '../src/batch-embedder.js'
import { formatForReading }    from '../src/answering.js'
import { buildJudgePrompt, parseJudgeVerdict } from './judge-prompts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── config ─────────────────────────────────────────────────────────────────

const LIMIT           = true                         // true = use PER_CATEGORY | null = all 500
const PER_CATEGORY    = 15                            // questions per category
const CATEGORY_FILTER = ['single-session-preference'] // null = all categories
const QUESTION_ID     = null                         // set to a question_id to run a single question
const SEARCH_TOP_N    = 10
const SKIP_INGEST     = true                         // true = skip ingestion, use existing DB
const TIME_AWARE_QUERY = true                        // CP3 (LongMemEval §5.4): auto-extract date range from query
const READING_MODE    = 'json-con'                   // CP4 (§5.5): 'json-con' = JSON + Chain-of-Note | 'legacy' = pre-Task-4 prose

const DB_DIR      = path.join(__dirname, '.greymemory-bench')
const DATA_FILE   = path.join(__dirname, 'data', 'longmemeval_s_cleaned.json')
const RESULTS_DIR = path.join(__dirname, 'results')

const FILTER_PROMPT = ''

const INITIAL_ENTITY_CONTEXT = `This is memory for a single user across multiple conversation sessions with an AI assistant.
"I", "me", "my", "mine" always refer to the same person.
Resolve all pronouns and vague references using context from the full conversation.`

// ── retrieval metrics (LongMemEval §3.3) ───────────────────────────────────
// Binary relevance at session granularity. Both metrics dedupe by session —
// only the first appearance of each gold session contributes (NDCG gain /
// Recall set inclusion). See plan: read-this-file-greymemory-longmemeval-im-sorted-hamming.md

function recallAtK(rankedSessionIds, goldSet, k) {
  if (goldSet.size === 0) return null
  const seen = new Set()
  for (let i = 0; i < Math.min(k, rankedSessionIds.length); i++) {
    const sid = rankedSessionIds[i]
    if (sid != null && goldSet.has(sid)) seen.add(sid)
  }
  return seen.size / goldSet.size
}

function ndcgAtK(rankedSessionIds, goldSet, k) {
  if (goldSet.size === 0) return null
  const seenRelevant = new Set()
  let dcg = 0
  for (let i = 0; i < Math.min(k, rankedSessionIds.length); i++) {
    const sid = rankedSessionIds[i]
    if (sid != null && goldSet.has(sid) && !seenRelevant.has(sid)) {
      seenRelevant.add(sid)
      dcg += 1 / Math.log2(i + 2)
    }
  }
  let idcg = 0
  for (let i = 0; i < Math.min(k, goldSet.size); i++) {
    idcg += 1 / Math.log2(i + 2)
  }
  return idcg === 0 ? 0 : dcg / idcg
}

if (SEARCH_TOP_N < 10) {
  throw new Error(`SEARCH_TOP_N must be >= 10 to compute Recall@10 / NDCG@10 (got ${SEARCH_TOP_N})`)
}

// ── token tracking ─────────────────────────────────────────────────────────
// Phase-keyed buckets. Library passes { phase } to extractor/embedder so the
// wrapper can attribute tokens/calls to the internal stage that caused them.
// New phases added by the library fall back into the default bucket defensively.

const tokenLog = {
  extractor: {
    extraction:        { input: 0, output: 0, calls: 0 },
    relationship:      { input: 0, output: 0, calls: 0 },
    contextualization: { input: 0, output: 0, calls: 0 },
    derivation:        { input: 0, output: 0, calls: 0 },
    time_extraction:   { input: 0, output: 0, calls: 0 },
  },
  embedder: {
    chunk:      { calls: 0 },
    dedup_seed: { calls: 0 },
    memory:     { calls: 0 },
    query:      { calls: 0 },
    derivation: { calls: 0 },
  },
  answering: { input: 0, output: 0 },
  judging:   { input: 0, output: 0 },
}

const sumCalls = obj => Object.values(obj).reduce((s, p) => s + (p.calls  ?? 0), 0)
const sumIn    = obj => Object.values(obj).reduce((s, p) => s + (p.input  ?? 0), 0)
const sumOut   = obj => Object.values(obj).reduce((s, p) => s + (p.output ?? 0), 0)

function resetTokenLog() {
  for (const p of Object.values(tokenLog.extractor)) { p.input = 0; p.output = 0; p.calls = 0 }
  for (const p of Object.values(tokenLog.embedder))  { p.calls = 0 }
  tokenLog.answering = { input: 0, output: 0 }
  tokenLog.judging   = { input: 0, output: 0 }
}

// ── providers ──────────────────────────────────────────────────────────────

const extractor = async (prompt, context) => {
  const phase  = context?.phase ?? 'extraction'
  const bucket = tokenLog.extractor[phase] ?? tokenLog.extractor.extraction
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 8192,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Anthropic: ${data.error.message}`)
  bucket.input  += data.usage?.input_tokens  ?? 0
  bucket.output += data.usage?.output_tokens ?? 0
  bucket.calls  += 1
  return data.content[0].text.trim()
}

const rawBatchedEmbedder = createBatchEmbedder(async (texts) => {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: 'voyage-3', input: texts }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Voyage: ${data.error.message}`)
  return data.data.map(d => d.embedding)
}, { windowMs: 20, maxBatch: 128 })

// Phase-aware wrapper around the batched embedder. Counts the call before it
// enters the batch queue so dedup/batching can't lose attribution.
const embedder = async (text, context) => {
  const phase  = context?.phase ?? 'query'
  const bucket = tokenLog.embedder[phase] ?? tokenLog.embedder.query
  bucket.calls += 1
  return rawBatchedEmbedder(text)
}

const answerer = async (prompt, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'gpt-4o',
        max_tokens:  512,
        temperature: 0,
        messages:    [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (data.error?.type === 'rate_limit_exceeded' || data.error?.code === 'rate_limit_exceeded') {
      const wait = Math.pow(2, attempt) * 2000
      process.stderr.write(`\n  [retry] rate limited, waiting ${wait/1000}s...\n`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (data.error) throw new Error(`OpenAI answerer: ${data.error.message}`)
    tokenLog.answering.input  += data.usage?.prompt_tokens     ?? 0
    tokenLog.answering.output += data.usage?.completion_tokens ?? 0
    return data.choices[0].message.content.trim()
  }
  throw new Error('OpenAI answerer: max retries exceeded')
}

// Uses LongMemEval's official per-question-type prompts (see ./judge-prompts.js).
// Routes by questionType + isAbstention so accuracy is comparable to the paper.
const judge = async (question, expected, got, questionType, isAbstention, retries = 3) => {
  const prompt = buildJudgePrompt({
    questionType, isAbstention,
    question, answer: expected, response: got,
  })
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'gpt-4o',
        max_tokens:  10,
        temperature: 0,
        messages:    [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (data.error?.type === 'rate_limit_exceeded' || data.error?.code === 'rate_limit_exceeded') {
      const wait = Math.pow(2, attempt) * 2000
      process.stderr.write(`\n  [retry] judge rate limited, waiting ${wait/1000}s...\n`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (data.error) throw new Error(`OpenAI judge: ${data.error.message}`)
    tokenLog.judging.input  += data.usage?.prompt_tokens     ?? 0
    tokenLog.judging.output += data.usage?.completion_tokens ?? 0
    return parseJudgeVerdict(data.choices?.[0]?.message?.content)
  }
  throw new Error('OpenAI judge: max retries exceeded')
}

// ── temporal pre-computation ───────────────────────────────────────────────

function buildTemporalTimeline(question, results) {
  const isTemporal = /how many (days|weeks|months)|how long|how old|which.*(first|before|after|earlier|later)|when did|what day|what date|ago/i.test(question)
  if (!isTemporal) return ''

  const events = results
    .map(r => {
      const date = r.event_date ?? r.document_date
      return date ? {
        date,
        description: (r.memory || r.chunk?.slice(0, 150) || '').replace(/\n/g, ' ')
      } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (events.length === 0) return ''

  // deduplicate same date + similar description
  const seen = new Set()
  const unique = events.filter(e => {
    const key = `${e.date}|${e.description.slice(0, 50)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return `
TIMELINE (events sorted chronologically — use these dates for any date arithmetic):
${unique.map(e => `  ${e.date}: ${e.description}`).join('\n')}

IMPORTANT: Use the dates above for all calculations. Do NOT estimate dates from
phrases like "a few weeks ago" or "last month" — use the extracted eventDate values.
When computing durations, subtract the earlier date from the later date.
`
}

// ── answering prompt ───────────────────────────────────────────────────────

function buildAnsweringPrompt({ question, questionDate, results, temporalTimeline }) {
  const retrievedContext = results.map((r, i) => {
    const lines = [`[${i + 1}]`]
    if (r.memory) lines.push(`Memory: ${r.memory}`)
    if (r.chunk && r.chunk !== r.memory) lines.push(`Chunks: ${r.chunk}`)
    if (!r.memory && r.chunk) lines.push(`Raw content: ${r.chunk}`)
    if (r.document_date) lines.push(`documentDate: ${r.document_date}`)
    if (r.event_date)    lines.push(`eventDate: ${r.event_date}`)
    if (r.relation_type) lines.push(`Version: ${r.relation_type}`)
    if (r.source_role)   lines.push(`Source: ${r.source_role}`)

    // NEW: surface graph expansion provenance
    if (r._expansion?.via === 'UPDATES_HISTORY') {
      lines.push(
        `⚠️ HISTORICAL VERSION: this fact USED TO be true but was replaced. ` +
        `Current value (from result #${r._expansion.seedId}): "${r._expansion.supersededBy.value}". ` +
        `When answering, treat this as the previous state, not a current fact.`
      )
    } else if (r._expansion?.via === 'EXTENDS') {
      lines.push(`(Related context: connected to result #${r._expansion.seedId} via EXTENDS chain, depth ${r._expansion.depth})`)
    }

    return lines.join('\n')
  }).join('\n\n')

  // Also strengthen the instructions section to handle version chains explicitly:
  return `You are a question-answering system. Based on the retrieved context below, answer the question.

Question: ${question}
Question Date: ${questionDate}

Retrieved Context:
${retrievedContext || '(no memories retrieved)'}

Understanding the Context:
The context contains search results from a memory system. Each result has multiple components:

Memory: A high-level summary/atomic fact — the searchable title/summary of what was stored
Chunks: The actual detailed raw content where the memory was extracted from
Source: "assistant" means this came from something the assistant said
        "user" means this came from something the user said

Temporal Context (if present):
  Question Date: when the question was asked
  documentDate: when the content was originally authored/written/said
  eventDate: when the event/fact actually occurred or will occur

Version Chains (CRITICAL):
  Some results are marked "⚠️ HISTORICAL VERSION" — these describe what USED TO
  be true, not what is currently true. The replacement value is shown inline.
  When the question asks about a CHANGE ("did you switch from X to Y", "more or
  less", "previous vs current"), you MUST compare:
    - The current fact (the seed, which has no HISTORICAL marker)
    - The historical fact (marked HISTORICAL) — this is what it used to be
  Do not infer the previous value from anywhere else. Use the HISTORICAL marker.

Instructions:
  Before answering, identify which memory or chunk contains the relevant
  information and note the exact value from it.
  If the context contains enough information, provide a clear, concise answer.
  If not, respond with "I don't know" or explain what is missing.
  Base your answer ONLY on the provided context.
  Match your answer format to the question.

${temporalTimeline}
Answer:`
}

// ── failure classification ─────────────────────────────────────────────────

function classifyFailure(expected, retrieved) {
  const exp = String(expected).toLowerCase()
  const inRetrieval = retrieved.some(r =>
    r.memory?.toLowerCase().includes(exp) ||
    r.chunk?.toLowerCase().includes(exp)
  )
  return inRetrieval ? 'answering' : 'extraction'
}

// ── pre-flight checks ──────────────────────────────────────────────────────

console.log('[benchmark] checking API keys...')

const checks = [
  {
    name: 'Anthropic (extractor)',
    fn: async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Say OK' }] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      return data.content[0].text.trim()
    },
  },
  {
    name: 'OpenAI (answerer + judge)',
    fn: async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 10, messages: [{ role: 'user', content: 'Say OK' }] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      return data.choices[0].message.content.trim()
    },
  },
  {
    name: 'Voyage (embedder)',
    fn: async () => {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}` },
        body: JSON.stringify({ model: 'voyage-3', input: ['test'] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      return `vector[${data.data[0].embedding.length}] batch-enabled`
    },
  },
]

let allPassed = true
for (const check of checks) {
  try {
    const result = await check.fn()
    console.log(`  ✅  ${check.name} — ${result}`)
  } catch (err) {
    console.error(`  ❌  ${check.name} — ${err.message}`)
    allPassed = false
  }
}

if (!allPassed) {
  console.error('\n[benchmark] fix API key errors above before running')
  process.exit(1)
}

console.log('[benchmark] all keys OK\n')

// ── dataset loading ────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_FILE)) {
  console.error(`[benchmark] dataset not found: ${DATA_FILE}`)
  process.exit(1)
}

const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
console.log(`[benchmark] loaded ${dataset.length} questions`)

// ── question selection ─────────────────────────────────────────────────────

let questions = dataset

// single question override — highest priority
if (QUESTION_ID) {
  questions = dataset.filter(q => q.question_id === QUESTION_ID)
  console.log(`[benchmark] single question override: ${QUESTION_ID}`)
  if (questions.length === 0) {
    console.error(`[benchmark] question_id not found: ${QUESTION_ID}`)
    process.exit(1)
  }
} else {
  // apply category filter first
  if (CATEGORY_FILTER) {
    questions = questions.filter(q => CATEGORY_FILTER.includes(q.question_type))
    console.log(`[benchmark] category filter: ${CATEGORY_FILTER.join(', ')} (${questions.length} questions available)`)
  }

  // then apply limit — random pick per category
  // if (LIMIT) {
  //   const byCategory = {}
  //   for (const q of questions) {
  //     const cat = q.question_type
  //     if (!byCategory[cat]) byCategory[cat] = []
  //     byCategory[cat].push(q)
  //   }
  //   questions = Object.values(byCategory).flatMap(qs => {
  //     const shuffled = qs.sort(() => Math.random() - 0.5)
  //     return shuffled.slice(0, PER_CATEGORY)
  //   })
  // }

  // fixed set for reproducible comparison
  const FIXED_IDS = ['57f827a0', 'b6025781', '35a27287', '1d4e3b97', '32260d93']

  if (FIXED_IDS.length > 0) {
    questions = questions.filter(q => FIXED_IDS.includes(q.question_id))
  } else if (LIMIT) {
    const byCategory = {}
    for (const q of questions) {
      const cat = q.question_type
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(q)
    }
    questions = Object.values(byCategory).flatMap(qs => {
      const shuffled = qs.sort(() => Math.random() - 0.5)
      return shuffled.slice(0, PER_CATEGORY)
    })
  }

  console.log(`[benchmark] selected ${questions.length} questions (${PER_CATEGORY} random per category):`)
  questions.forEach(q => console.log(`  ${q.question_type} — ${q.question_id}`))
}

// ── setup ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })
if (!fs.existsSync(DB_DIR))      fs.mkdirSync(DB_DIR,      { recursive: true })

const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const resultsFile = path.join(RESULTS_DIR, `run-${timestamp}.json`)

const run = {
  meta: {
    timestamp, total: questions.length, per_category: PER_CATEGORY,
    category_filter: CATEGORY_FILTER ?? 'all',
    search_top_n:    SEARCH_TOP_N,
    model_extractor: 'claude-haiku-4-5-20251001',
    model_answerer:  'gpt-4o',
    model_embedder:  'voyage-3',
    model_judge:     'gpt-4o',
    tokens_format:   'v2-phase-keyed',  // see questions[].tokens shape
    judge_format:    'paper-official-v1',  // LongMemEval per-type prompts (./judge-prompts.js)
  },
  summary:   {},
  questions: [],
}

const SUPERMEMORY_SCORES = {
  'single-session-user':       97.1,
  'single-session-assistant':  96.4,
  'single-session-preference': 70.0,
  'knowledge-update':          88.5,
  'temporal-reasoning':        76.7,
  'multi-session':             71.4,
}

// ── main loop ──────────────────────────────────────────────────────────────

console.log(`\n[benchmark] starting — results: ${resultsFile}\n`)

for (let i = 0; i < questions.length; i++) {
  const tc = questions[i]
  const { question_id, question_type, question, answer: expected,
          question_date, haystack_sessions, haystack_dates,
          haystack_session_ids, answer_session_ids } = tc

  const isAbstention = question_id.endsWith('_abs')

  console.log(`${'─'.repeat(70)}`)
  console.log(`[${String(i + 1).padStart(3)}/${questions.length}] ${question_type}`)
  console.log(`  id:       ${question_id}`)
  console.log(`  question: "${question}"`)
  console.log(`  date:     ${question_date}`)
  console.log(`  sessions: ${haystack_sessions.length}`)
  console.log()

  // reset token log per question
  resetTokenLog()

  const memory = new Memory({
    extractor, embedder,
    dir:           DB_DIR,
    container:     question_id,
    filterPrompt:  FILTER_PROMPT,
    entityContext: INITIAL_ENTITY_CONTEXT,
  })

  // ── ingest ─────────────────────────────────────────────────────────────
  const t0 = Date.now()
  if (SKIP_INGEST) {
    console.log(`  ⏩ skipping ingestion (SKIP_INGEST=true)`)
  } else {
    for (let s = 0; s < haystack_sessions.length; s++) {
      process.stdout.write(`  ingesting session ${s + 1}/${haystack_sessions.length}...`)
      try {
        await memory.add(haystack_sessions[s], {
          date:      haystack_dates[s],
          sessionId: haystack_session_ids?.[s] ?? null,
        })
      }
      catch (err) { process.stderr.write(`\n  [warn] session ${s}: ${err.message}\n`) }
      process.stdout.write('\r' + ' '.repeat(50) + '\r')
    }
  }
  const ingestMs = Date.now() - t0

  const ext = tokenLog.extractor
  const emb = tokenLog.embedder
  const totalHaikuCalls = sumCalls(ext)
  const totalHaikuIn    = sumIn(ext)
  const totalHaikuOut   = sumOut(ext)

  console.log(`  ⏱  ingest:         ${(ingestMs / 1000).toFixed(1)}s  (~${(ingestMs / haystack_sessions.length / 1000).toFixed(2)}s/session)`)
  console.log(`  🔢  haiku — extraction:        ${ext.extraction.calls} calls, ${ext.extraction.input.toLocaleString()} in / ${ext.extraction.output.toLocaleString()} out`)
  console.log(`  🔢  haiku — relationship:      ${ext.relationship.calls} calls, ${ext.relationship.input.toLocaleString()} in / ${ext.relationship.output.toLocaleString()} out`)
  console.log(`  🔢  haiku — contextualization: ${ext.contextualization.calls} calls, ${ext.contextualization.input.toLocaleString()} in / ${ext.contextualization.output.toLocaleString()} out`)
  if (ext.derivation.calls > 0) {
    console.log(`  🔢  haiku — derivation:        ${ext.derivation.calls} calls, ${ext.derivation.input.toLocaleString()} in / ${ext.derivation.output.toLocaleString()} out`)
  }
  console.log(`  🔢  haiku — total:             ${totalHaikuCalls} calls, ${totalHaikuIn.toLocaleString()} in / ${totalHaikuOut.toLocaleString()} out`)
  console.log(`  📐  embedder calls — chunk/dedup/memory/query/derivation: ${emb.chunk.calls}/${emb.dedup_seed.calls}/${emb.memory.calls}/${emb.query.calls}/${emb.derivation.calls}  (total ${sumCalls(emb)})`)

  // ── search ──────────────────────────────────────────────────────────────
  const t1 = Date.now()
  const questionDateNorm = memory._normalizeDate(question_date) ?? question_date
  // round asOf to end-of-day so all same-day sessions are visible
  const asOf = questionDateNorm.length === 10
    ? questionDateNorm + 'T23:59'
    : questionDateNorm.slice(0, 10) + 'T23:59'
  const timeExtractCallsBefore = ext.time_extraction.calls
  const retrieved = await memory.search(question, { topN: SEARCH_TOP_N, asOf, timeAwareQuery: TIME_AWARE_QUERY })
  const timeExtractFired = ext.time_extraction.calls > timeExtractCallsBefore
  console.log(`\n  ⏱  search:         ${(Date.now() - t1).toFixed(0)}ms  (${retrieved.length} results)${timeExtractFired ? `  [M_T fired: ${ext.time_extraction.input}↓/${ext.time_extraction.output}↑]` : '  [M_T skipped]'}`)

  // ── retrieval metrics ───────────────────────────────────────────────────
  const goldSessions     = new Set(answer_session_ids ?? [])
  const rankedSessionIds = retrieved.map(r => r.session_id ?? null)
  const trackedRetrieved = rankedSessionIds.filter(s => s != null).length
  const legacyDb         = retrieved.length > 0 && trackedRetrieved === 0

  let recall_at_5, recall_at_10, ndcg_at_5, ndcg_at_10
  if (goldSessions.size === 0) {
    recall_at_5 = recall_at_10 = ndcg_at_5 = ndcg_at_10 = null
  } else if (legacyDb) {
    recall_at_5 = recall_at_10 = ndcg_at_5 = ndcg_at_10 = null
    process.stderr.write(`  [warn] metrics skipped — retrieved items have no session_id (re-ingest needed)\n`)
  } else {
    recall_at_5  = recallAtK(rankedSessionIds, goldSessions, 5)
    recall_at_10 = recallAtK(rankedSessionIds, goldSessions, 10)
    ndcg_at_5    = ndcgAtK  (rankedSessionIds, goldSessions, 5)
    ndcg_at_10   = ndcgAtK  (rankedSessionIds, goldSessions, 10)
  }

  const fmtMetric = v => v == null ? '—' : (v * 100).toFixed(0) + '%'
  console.log(`  📚  R@5 ${fmtMetric(recall_at_5)}  R@10 ${fmtMetric(recall_at_10)}  N@5 ${fmtMetric(ndcg_at_5)}  N@10 ${fmtMetric(ndcg_at_10)}  (${trackedRetrieved}/${retrieved.length} tagged, ${goldSessions.size} gold)`)

  // ── answer ───────────────────────────────────────────────────────────────
  const temporalTimeline = buildTemporalTimeline(question, retrieved)
  let answerPrompt
  if (READING_MODE === 'json-con') {
    answerPrompt = formatForReading({
      question,
      questionDate: questionDateNorm,
      results:      retrieved,
    })
    if (temporalTimeline) answerPrompt += '\n' + temporalTimeline
  } else {
    answerPrompt = buildAnsweringPrompt({ question, questionDate: questionDateNorm, results: retrieved, temporalTimeline })
  }
  const t3 = Date.now()
  let answer = 'I don\'t know'
  try { answer = await answerer(answerPrompt) }
  catch (err) { process.stderr.write(`\n  [warn] answering: ${err.message}\n`) }
  console.log(`  ⏱  answer:         ${(Date.now() - t3).toFixed(0)}ms  (${tokenLog.answering.input.toLocaleString()} in / ${tokenLog.answering.output.toLocaleString()} out tokens)`)
  console.log(`  💬  "${answer}"`)
  console.log(`  📊  expected: "${expected}"`)

  // ── judge ────────────────────────────────────────────────────────────────
  // All question types (incl. _abs) route through the paper's per-type prompts.
  // CoN answers start with a "Notes:" block; strip to the final "Answer:" line
  // so the paper's terse-answer judge prompt sees what it was designed for.
  const t4 = Date.now()
  let correct = false
  let failureReason = null
  const judgedAnswer = answer.match(/^Answer:\s*(.*)$/m)?.[1]?.trim() ?? answer
  correct = await judge(question, expected, judgedAnswer, question_type, isAbstention)
  if (!correct) failureReason = classifyFailure(expected, retrieved)
  console.log(`  ⏱  judge:          ${(Date.now() - t4).toFixed(0)}ms  (${tokenLog.judging.input.toLocaleString()} tokens)`)
  console.log(`  ${correct ? '✅ correct' : `❌ incorrect — ${failureReason ?? 'abstention'}`}`)

  // ── cost breakdown ────────────────────────────────────────────────────────
  const HAIKU_IN_PER_M  = 1    // $ per million input tokens
  const HAIKU_OUT_PER_M = 5
  const costFor = b => (b.input * HAIKU_IN_PER_M + b.output * HAIKU_OUT_PER_M) / 1_000_000

  const haikuExtractionCost = costFor(ext.extraction)
  const haikuRelationCost   = costFor(ext.relationship)
  const haikuContextCost    = costFor(ext.contextualization)
  const haikuDerivationCost = costFor(ext.derivation)
  const haikuSubtotal       = haikuExtractionCost + haikuRelationCost + haikuContextCost + haikuDerivationCost
  const gpt4oCost = (
    (tokenLog.answering.input + tokenLog.judging.input) * 2.5 +
    (tokenLog.answering.output + tokenLog.judging.output) * 10
  ) / 1_000_000
  const totalCost = haikuSubtotal + gpt4oCost
  const totalMs   = Date.now() - t0

  console.log(`\n  💰 Cost breakdown:`)
  console.log(`     Haiku — extraction:        $${haikuExtractionCost.toFixed(4)}  (${ext.extraction.calls} calls)`)
  console.log(`     Haiku — relationship:      $${haikuRelationCost.toFixed(4)}  (${ext.relationship.calls} calls)`)
  console.log(`     Haiku — contextualization: $${haikuContextCost.toFixed(4)}  (${ext.contextualization.calls} calls)`)
  if (haikuDerivationCost > 0) {
    console.log(`     Haiku — derivation:        $${haikuDerivationCost.toFixed(4)}  (${ext.derivation.calls} calls)`)
  }
  console.log(`     Haiku — subtotal:          $${haikuSubtotal.toFixed(4)}`)
  console.log(`     GPT-4o (answer+judge):     $${gpt4oCost.toFixed(4)}`)
  console.log(`     Total (this question):     $${totalCost.toFixed(4)}`)
  console.log(`     × 60 questions:           ~$${(totalCost * 60).toFixed(2)}`)
  console.log(`\n  ⏱  Total time: ${(totalMs / 1000 / 60).toFixed(1)} min`)
  console.log(`     × 60 questions: ~${((totalMs / 1000 / 60) * 60 / 60).toFixed(1)} hours`)

  run.questions.push({
    question_id, question_type, question, expected, answer,
    correct, is_abstention: isAbstention, failure_reason: failureReason,
    ingest_ms: ingestMs, sessions_count: haystack_sessions.length, retrieved_count: retrieved.length,
    recall_at_5, recall_at_10, ndcg_at_5, ndcg_at_10,
    gold_sessions:      [...goldSessions],
    retrieved_sessions: rankedSessionIds,
    tokens: {
      extractor: {
        extraction:        { ...ext.extraction },
        relationship:      { ...ext.relationship },
        contextualization: { ...ext.contextualization },
        derivation:        { ...ext.derivation },
        time_extraction:   { ...ext.time_extraction },
        total: { input: sumIn(ext), output: sumOut(ext), calls: sumCalls(ext) },
      },
      embedder: {
        chunk:      { ...emb.chunk },
        dedup_seed: { ...emb.dedup_seed },
        memory:     { ...emb.memory },
        query:      { ...emb.query },
        derivation: { ...emb.derivation },
        total: { calls: sumCalls(emb) },
      },
      gpt4o_input:  tokenLog.answering.input  + tokenLog.judging.input,
      gpt4o_output: tokenLog.answering.output + tokenLog.judging.output,
    },
    retrieved: retrieved.map(r => ({
      memory:        r.memory,
      chunk:         r.chunk?.slice(0, 300),
      memory_type:   r.memory_type,
      confidence:    r.confidence,
      document_date: r.document_date,
      event_date:    r.event_date,
      relation_type: r.relation_type,
      source_role:   r.source_role,
      session_id:    r.session_id ?? null,
    })),
  })

  fs.writeFileSync(resultsFile, JSON.stringify(run, null, 2))
}

// ── summary ────────────────────────────────────────────────────────────────

const LLM_PHASES      = ['extraction', 'relationship', 'contextualization', 'derivation']
const EMBEDDER_PHASES = ['chunk', 'dedup_seed', 'memory', 'query', 'derivation']

const byCat = {}
const llmTotal      = Object.fromEntries(LLM_PHASES.map(p      => [p, { input: 0, output: 0, calls: 0 }]))
const embedderTotal = Object.fromEntries(EMBEDDER_PHASES.map(p => [p, { calls: 0 }]))

for (const r of run.questions) {
  if (!byCat[r.question_type]) {
    byCat[r.question_type] = {
      total: 0, correct: 0, failures: {},
      r5_sum: 0, r10_sum: 0, n5_sum: 0, n10_sum: 0, metric_n: 0,
      extractor: Object.fromEntries(LLM_PHASES.map(p      => [p, { input: 0, output: 0, calls: 0 }])),
      embedder:  Object.fromEntries(EMBEDDER_PHASES.map(p => [p, { calls: 0 }])),
    }
  }
  const cat = byCat[r.question_type]
  cat.total++
  if (r.correct) cat.correct++
  else if (r.failure_reason) {
    cat.failures[r.failure_reason] = (cat.failures[r.failure_reason] ?? 0) + 1
  }
  if (r.recall_at_5 != null) {
    cat.r5_sum  += r.recall_at_5
    cat.r10_sum += r.recall_at_10
    cat.n5_sum  += r.ndcg_at_5
    cat.n10_sum += r.ndcg_at_10
    cat.metric_n += 1
  }
  // phase-keyed token/call accumulation
  const t = r.tokens
  if (t?.extractor) {
    for (const phase of LLM_PHASES) {
      const src = t.extractor[phase]; if (!src) continue
      cat.extractor[phase].input  += src.input  ?? 0
      cat.extractor[phase].output += src.output ?? 0
      cat.extractor[phase].calls  += src.calls  ?? 0
      llmTotal[phase].input  += src.input  ?? 0
      llmTotal[phase].output += src.output ?? 0
      llmTotal[phase].calls  += src.calls  ?? 0
    }
  }
  if (t?.embedder) {
    for (const phase of EMBEDDER_PHASES) {
      const src = t.embedder[phase]; if (!src) continue
      cat.embedder[phase].calls += src.calls ?? 0
      embedderTotal[phase].calls += src.calls ?? 0
    }
  }
}

console.log(`\n${'─'.repeat(70)}`)
console.log('\n── Results ─────────────────────────────────────────────────────────────')

const pct = (sum, n) => n ? ((sum / n) * 100).toFixed(1) + '%' : '—'
const head = `  ${'category'.padEnd(28)} ${'acc'.padStart(7)} ${'R@5'.padStart(7)} ${'R@10'.padStart(7)} ${'N@5'.padStart(7)} ${'N@10'.padStart(7)}  ${'supermem'.padStart(8)}  failures`
console.log(head)

let totalCorrect = 0, totalTotal = 0
let totalR5 = 0, totalR10 = 0, totalN5 = 0, totalN10 = 0, totalMetricN = 0
for (const [cat, s] of Object.entries(byCat)) {
  const acc  = ((s.correct / s.total) * 100).toFixed(1) + '%'
  const sm   = SUPERMEMORY_SCORES[cat] != null ? SUPERMEMORY_SCORES[cat].toFixed(1) + '%' : '—'
  const fail = Object.entries(s.failures).map(([k, v]) => `${k}:${v}`).join(' ')
  console.log(
    `  ${cat.padEnd(28)} ${acc.padStart(7)} ` +
    `${pct(s.r5_sum,  s.metric_n).padStart(7)} ` +
    `${pct(s.r10_sum, s.metric_n).padStart(7)} ` +
    `${pct(s.n5_sum,  s.metric_n).padStart(7)} ` +
    `${pct(s.n10_sum, s.metric_n).padStart(7)}  ` +
    `${sm.padStart(8)}  ${fail}`
  )
  totalCorrect += s.correct
  totalTotal   += s.total
  totalR5  += s.r5_sum;  totalR10 += s.r10_sum
  totalN5  += s.n5_sum;  totalN10 += s.n10_sum
  totalMetricN += s.metric_n
}

const overall = ((totalCorrect / totalTotal) * 100).toFixed(1) + '%'
console.log(
  `  ${'overall'.padEnd(28)} ${overall.padStart(7)} ` +
  `${pct(totalR5,  totalMetricN).padStart(7)} ` +
  `${pct(totalR10, totalMetricN).padStart(7)} ` +
  `${pct(totalN5,  totalMetricN).padStart(7)} ` +
  `${pct(totalN10, totalMetricN).padStart(7)}  ` +
  `${'81.6%'.padStart(8)}`
)
// ── Cost & call dominance ─────────────────────────────────────────────────
const HAIKU_IN_PER_M  = 1
const HAIKU_OUT_PER_M = 5
const phaseCost = b => (b.input * HAIKU_IN_PER_M + b.output * HAIKU_OUT_PER_M) / 1_000_000

const llmCostTotal = LLM_PHASES.reduce((s, p) => s + phaseCost(llmTotal[p]), 0)

console.log('\n── Cost & call dominance ───────────────────────────────────────────────')
console.log(`  ${'phase'.padEnd(30)} ${'calls'.padStart(8)} ${'in tok'.padStart(12)} ${'out tok'.padStart(10)} ${'$'.padStart(9)} ${'% LLM $'.padStart(9)}`)
for (const phase of LLM_PHASES) {
  const b = llmTotal[phase]
  const $ = phaseCost(b)
  const pctShare = llmCostTotal > 0 ? ((($ / llmCostTotal) * 100).toFixed(1) + '%') : '—'
  console.log(
    `  ${('Haiku — ' + phase).padEnd(30)} ${String(b.calls).padStart(8)} ${b.input.toLocaleString().padStart(12)} ${b.output.toLocaleString().padStart(10)} ${('$' + $.toFixed(4)).padStart(9)} ${pctShare.padStart(9)}`
  )
}
const llmCallsAll = LLM_PHASES.reduce((s, p) => s + llmTotal[p].calls,  0)
const llmInAll    = LLM_PHASES.reduce((s, p) => s + llmTotal[p].input,  0)
const llmOutAll   = LLM_PHASES.reduce((s, p) => s + llmTotal[p].output, 0)
console.log(
  `  ${'Haiku — TOTAL'.padEnd(30)} ${String(llmCallsAll).padStart(8)} ${llmInAll.toLocaleString().padStart(12)} ${llmOutAll.toLocaleString().padStart(10)} ${('$' + llmCostTotal.toFixed(4)).padStart(9)} ${'100.0%'.padStart(9)}`
)
console.log()
for (const phase of EMBEDDER_PHASES) {
  const b = embedderTotal[phase]
  console.log(`  ${('Embedder — ' + phase).padEnd(30)} ${String(b.calls).padStart(8)}`)
}
const embCallsAll = EMBEDDER_PHASES.reduce((s, p) => s + embedderTotal[p].calls, 0)
console.log(`  ${'Embedder — TOTAL'.padEnd(30)} ${String(embCallsAll).padStart(8)}`)

console.log(`\n[benchmark] results: ${resultsFile}`)

const toPct = (sum, n) => n ? parseFloat(((sum / n) * 100).toFixed(1)) : null

run.summary = {
  overall_pct:                parseFloat(overall),
  supermemory_overall:        81.6,
  overall_recall_at_5_pct:    toPct(totalR5,  totalMetricN),
  overall_recall_at_10_pct:   toPct(totalR10, totalMetricN),
  overall_ndcg_at_5_pct:      toPct(totalN5,  totalMetricN),
  overall_ndcg_at_10_pct:     toPct(totalN10, totalMetricN),
  overall_metric_n:           totalMetricN,
  cost: {
    by_phase: Object.fromEntries(LLM_PHASES.map(phase => {
      const b = llmTotal[phase]
      const $ = phaseCost(b)
      return [phase, {
        calls:      b.calls,
        in_tokens:  b.input,
        out_tokens: b.output,
        cost_usd:   parseFloat($.toFixed(4)),
        pct_of_llm: llmCostTotal > 0 ? parseFloat((($ / llmCostTotal) * 100).toFixed(1)) : null,
      }]
    })),
    embedder_calls_by_phase: Object.fromEntries(EMBEDDER_PHASES.map(p => [p, embedderTotal[p].calls])),
    total_haiku_usd: parseFloat(llmCostTotal.toFixed(4)),
  },
  by_category: Object.fromEntries(Object.entries(byCat).map(([cat, s]) => [cat, {
    correct:           s.correct,
    total:             s.total,
    pct:               parseFloat(((s.correct / s.total) * 100).toFixed(1)),
    supermemory_pct:   SUPERMEMORY_SCORES[cat] ?? null,
    recall_at_5_pct:   toPct(s.r5_sum,  s.metric_n),
    recall_at_10_pct:  toPct(s.r10_sum, s.metric_n),
    ndcg_at_5_pct:     toPct(s.n5_sum,  s.metric_n),
    ndcg_at_10_pct:    toPct(s.n10_sum, s.metric_n),
    metric_n:          s.metric_n,
    failures:          s.failures,
    extractor:         s.extractor,
    embedder:          s.embedder,
  }])),
}

fs.writeFileSync(resultsFile, JSON.stringify(run, null, 2))