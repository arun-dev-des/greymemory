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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── config ─────────────────────────────────────────────────────────────────

const LIMIT           = true                         // true = use PER_CATEGORY | null = all 500
const PER_CATEGORY    = 15                            // questions per category
const CATEGORY_FILTER = ['multi-session'] // null = all categories
const QUESTION_ID     = null                         // set to a question_id to run a single question
const SEARCH_TOP_N    = 10
const SKIP_INGEST     = false                        // true = skip ingestion, use existing DB

const DB_DIR      = path.join(__dirname, '.greymemory-bench')
const DATA_FILE   = path.join(__dirname, 'data', 'longmemeval_s_cleaned.json')
const RESULTS_DIR = path.join(__dirname, 'results')

const FILTER_PROMPT = ''

const INITIAL_ENTITY_CONTEXT = `This is memory for a single user across multiple conversation sessions with an AI assistant.
"I", "me", "my", "mine" always refer to the same person.
Resolve all pronouns and vague references using context from the full conversation.`

// ── token tracking ─────────────────────────────────────────────────────────

const tokenLog = {
  extraction: { input: 0, output: 0, calls: 0 },
  answering:  { input: 0, output: 0 },
  judging:    { input: 0, output: 0 },
}

// ── providers ──────────────────────────────────────────────────────────────

const extractor = async (prompt) => {
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
  tokenLog.extraction.input  += data.usage?.input_tokens  ?? 0
  tokenLog.extraction.output += data.usage?.output_tokens ?? 0
  tokenLog.extraction.calls  += 1
  return data.content[0].text.trim()
}

const embedder = createBatchEmbedder(async (texts) => {
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

const judge = async (question, expected, got, retries = 3) => {
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
        messages: [{
          role:    'user',
          content: `You are evaluating a question-answering system.

Question: ${question}
Expected answer: ${expected}
System answer: ${got}

Does the system answer correctly answer the question given the expected answer?
The system answer may be phrased differently but must convey the same information.
If the expected answer is an abstention and the system says "I don't know", that is correct.

Respond with ONLY "correct" or "incorrect".`,
        }],
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
    return data.choices?.[0]?.message?.content?.trim().toLowerCase() === 'correct'
  }
  throw new Error('OpenAI judge: max retries exceeded')
}

// ── temporal pre-computation ───────────────────────────────────────────────

function buildTemporalTimeline(question, results) {
  const isTemporal = /how many (days|weeks|months)|how long|how old|which.*(first|before|after|earlier|later)|when did|what day|what date|ago/i.test(question)
  if (!isTemporal) return ''

  const events = results
    .filter(r => r.event_date)
    .map(r => ({
      date: r.event_date,
      description: (r.memory || r.chunk?.slice(0, 150) || '').replace(/\n/g, ' ')
    }))
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
    return lines.join('\n')
  }).join('\n\n')

  return `You are a question-answering system. Based on the retrieved context below, answer the question.

Question: ${question}
Question Date: ${questionDate}

Retrieved Context:
${retrievedContext || '(no memories retrieved)'}

Understanding the Context:
The context contains search results from a memory system. Each result has multiple components:

Memory: A high-level summary/atomic fact — the searchable title/summary of what was stored
Chunks: The actual detailed raw content where the memory was extracted from
  Contains conversations, documents, messages, or text excerpts
  This is your primary source for detailed information and facts
Source: "assistant" means this memory came from something the assistant said
        "user" means this memory came from something the user said

Temporal Context (if present):
  Question Date: The date when the question was asked. Use this for temporal perspective.
  documentDate: When the content was originally authored/written/said.
  eventDate: When the event/fact actually occurred or will occur.

Instructions:
  Before answering, explicitly identify which memory or chunk contains the relevant
  information and note the exact value from it. Then use that noted value to construct
  your final answer.
  If the context contains enough information, provide a clear, concise answer.
  If not, respond with "I don't know" or explain what is missing.
  Base your answer ONLY on the provided context.
  Prioritize information from chunks and raw content — they are the raw source material.
  Match your answer format to the question — number, name, date, or yes/no leads directly.
  When counting items or actions, treat each distinct action as a separate item.
  When calculating days between two dates, count inclusively — include the start date.
  Do not reference result numbers in your answer.

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
  const FIXED_IDS = []
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
          question_date, haystack_sessions, haystack_dates } = tc

  const isAbstention = question_id.endsWith('_abs')

  console.log(`${'─'.repeat(70)}`)
  console.log(`[${String(i + 1).padStart(3)}/${questions.length}] ${question_type}`)
  console.log(`  id:       ${question_id}`)
  console.log(`  question: "${question}"`)
  console.log(`  date:     ${question_date}`)
  console.log(`  sessions: ${haystack_sessions.length}`)
  console.log()

  // reset token log per question
  tokenLog.extraction = { input: 0, output: 0, calls: 0 }
  tokenLog.answering  = { input: 0, output: 0 }
  tokenLog.judging    = { input: 0, output: 0 }

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
      try { await memory.add(haystack_sessions[s], { date: haystack_dates[s] }) }
      catch (err) { process.stderr.write(`\n  [warn] session ${s}: ${err.message}\n`) }
      process.stdout.write('\r' + ' '.repeat(50) + '\r')
    }
  }
  const ingestMs = Date.now() - t0

  console.log(`  ⏱  ingest:         ${(ingestMs / 1000).toFixed(1)}s  (~${(ingestMs / haystack_sessions.length / 1000).toFixed(2)}s/session)`)
  console.log(`  🔢  haiku calls:    ${tokenLog.extraction.calls}  (~${Math.round(tokenLog.extraction.calls / haystack_sessions.length)} calls/session)`)
  console.log(`  🔢  haiku in:       ${tokenLog.extraction.input.toLocaleString()} tokens  (~${Math.round(tokenLog.extraction.input / haystack_sessions.length).toLocaleString()} tokens/session)`)
  console.log(`  🔢  haiku out:      ${tokenLog.extraction.output.toLocaleString()} tokens`)

  // ── search ──────────────────────────────────────────────────────────────
  const t1 = Date.now()
  const questionDateNorm = memory._normalizeDate(question_date) ?? question_date
  // round asOf to end-of-day so all same-day sessions are visible
  const asOf = questionDateNorm.length === 10 
    ? questionDateNorm + 'T23:59' 
    : questionDateNorm.slice(0, 10) + 'T23:59'
  const retrieved = await memory.search(question, { topN: SEARCH_TOP_N, asOf })
  console.log(`\n  ⏱  search:         ${(Date.now() - t1).toFixed(0)}ms  (${retrieved.length} results)`)

  // ── answer ───────────────────────────────────────────────────────────────
  const temporalTimeline = buildTemporalTimeline(question, retrieved)
  const answerPrompt = buildAnsweringPrompt({ question, questionDate: questionDateNorm, results: retrieved, temporalTimeline })
  const t3 = Date.now()
  let answer = 'I don\'t know'
  try { answer = await answerer(answerPrompt) }
  catch (err) { process.stderr.write(`\n  [warn] answering: ${err.message}\n`) }
  console.log(`  ⏱  answer:         ${(Date.now() - t3).toFixed(0)}ms  (${tokenLog.answering.input.toLocaleString()} in / ${tokenLog.answering.output.toLocaleString()} out tokens)`)
  console.log(`  💬  "${answer}"`)
  console.log(`  📊  expected: "${expected}"`)

  // ── judge ────────────────────────────────────────────────────────────────
  const t4 = Date.now()
  let correct = false
  let failureReason = null
  if (isAbstention) {
    correct = /i don.t know|don.t have|no information|cannot find|not mentioned|does not provide/i.test(answer)
  } else {
    correct = await judge(question, expected, answer)
    if (!correct) failureReason = classifyFailure(expected, retrieved)
  }
  console.log(`  ⏱  judge:          ${(Date.now() - t4).toFixed(0)}ms  (${tokenLog.judging.input.toLocaleString()} tokens)`)
  console.log(`  ${correct ? '✅ correct' : `❌ incorrect — ${failureReason ?? 'abstention'}`}`)

  // ── cost breakdown ────────────────────────────────────────────────────────
  const haikuCost = (tokenLog.extraction.input * 1 + tokenLog.extraction.output * 5) / 1_000_000
  const gpt4oCost = (
    (tokenLog.answering.input + tokenLog.judging.input) * 2.5 +
    (tokenLog.answering.output + tokenLog.judging.output) * 10
  ) / 1_000_000
  const totalCost = haikuCost + gpt4oCost
  const totalMs   = Date.now() - t0

  console.log(`\n  💰 Cost breakdown:`)
  console.log(`     Haiku   (extraction):   $${haikuCost.toFixed(4)}`)
  console.log(`     GPT-4o  (answer+judge): $${gpt4oCost.toFixed(4)}`)
  console.log(`     Total   (this question):$${totalCost.toFixed(4)}`)
  console.log(`     × 60 questions:        ~$${(totalCost * 60).toFixed(2)}`)
  console.log(`\n  ⏱  Total time: ${(totalMs / 1000 / 60).toFixed(1)} min`)
  console.log(`     × 60 questions: ~${((totalMs / 1000 / 60) * 60 / 60).toFixed(1)} hours`)

  run.questions.push({
    question_id, question_type, question, expected, answer,
    correct, is_abstention: isAbstention, failure_reason: failureReason,
    ingest_ms: ingestMs, sessions_count: haystack_sessions.length, retrieved_count: retrieved.length,
    tokens: {
      haiku_input:  tokenLog.extraction.input,
      haiku_output: tokenLog.extraction.output,
      haiku_calls:  tokenLog.extraction.calls,
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
    })),
  })

  fs.writeFileSync(resultsFile, JSON.stringify(run, null, 2))
}

// ── summary ────────────────────────────────────────────────────────────────

const byCat = {}
for (const r of run.questions) {
  if (!byCat[r.question_type]) byCat[r.question_type] = { total: 0, correct: 0, failures: {} }
  byCat[r.question_type].total++
  if (r.correct) byCat[r.question_type].correct++
  else if (r.failure_reason) {
    byCat[r.question_type].failures[r.failure_reason] =
      (byCat[r.question_type].failures[r.failure_reason] ?? 0) + 1
  }
}

console.log(`\n${'─'.repeat(70)}`)
console.log('\n── Results ─────────────────────────────────────────────────────────────')

let totalCorrect = 0, totalTotal = 0
for (const [cat, s] of Object.entries(byCat)) {
  const pct  = ((s.correct / s.total) * 100).toFixed(1)
  const sm   = SUPERMEMORY_SCORES[cat]?.toFixed(1) ?? '—'
  const fail = Object.entries(s.failures).map(([k, v]) => `${k}:${v}`).join(' ')
  console.log(`  ${cat.padEnd(35)} ${(pct + '%').padEnd(13)} supermemory:${sm}%  ${fail}`)
  totalCorrect += s.correct
  totalTotal   += s.total
}

const overall = ((totalCorrect / totalTotal) * 100).toFixed(1)
console.log(`  ${'overall'.padEnd(35)} ${(overall + '%').padEnd(13)} supermemory:81.6%`)
console.log(`\n[benchmark] results: ${resultsFile}`)

run.summary = {
  overall_pct:         parseFloat(overall),
  supermemory_overall: 81.6,
  by_category: Object.fromEntries(Object.entries(byCat).map(([cat, s]) => [cat, {
    correct:         s.correct,
    total:           s.total,
    pct:             parseFloat(((s.correct / s.total) * 100).toFixed(1)),
    supermemory_pct: SUPERMEMORY_SCORES[cat] ?? null,
    failures:        s.failures,
  }])),
}

fs.writeFileSync(resultsFile, JSON.stringify(run, null, 2))