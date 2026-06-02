// benchmark/test-task-1-1.js
//
// Focused A/B test for Task 1.1 (EXTENDS traversal + supersession-aware walk).
// Runs each question twice: once with expandViaGraph=false (baseline),
// once with expandViaGraph=true (Task 1.1). Shows what expansion added,
// whether the answer changed, and whether correctness changed.
//
// Assumes DBs are already populated. Set DB_FILE to the specific .db file
// containing your target question_id's container.

import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { Memory }              from '../src/memory.js'
import { createBatchEmbedder } from '../src/batch-embedder.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── config ─────────────────────────────────────────────────────────────────

const QUESTION_IDS = ['830ce83f']
const DB_FILE      = path.join(__dirname, '.greymemory-bench-test', 'greymemory.db')
const DATA_FILE    = path.join(__dirname, 'data', 'longmemeval_s_cleaned.json')

const SEARCH_TOP_N    = 10
const EXPANDED_LIMIT  = 10
const EXPAND_DEPTH    = 5

// ── providers (copied from run.js — same models for fair comparison) ───────

const tokenLog = { calls: 0, in: 0, out: 0 }

const extractor = async (prompt) => {
  // Not used in this script (no ingestion) but Memory requires it
  throw new Error('extractor should not be called in test-task-1-1')
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

const answerer = async (prompt) => {
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
  if (data.error) throw new Error(`OpenAI answerer: ${data.error.message}`)
  tokenLog.in  += data.usage?.prompt_tokens     ?? 0
  tokenLog.out += data.usage?.completion_tokens ?? 0
  return data.choices[0].message.content.trim()
}

const judge = async (question, expected, got) => {
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

Respond with ONLY "correct" or "incorrect".`,
      }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`OpenAI judge: ${data.error.message}`)
  return data.choices?.[0]?.message?.content?.trim().toLowerCase() === 'correct'
}

// ── answering prompt (same as run.js) ──────────────────────────────────────

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

  const seen = new Set()
  const unique = events.filter(e => {
    const key = `${e.date}|${e.description.slice(0, 50)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return `
TIMELINE (events sorted chronologically):
${unique.map(e => `  ${e.date}: ${e.description}`).join('\n')}
`
}

function buildAnsweringPrompt({ question, questionDate, results }) {
  const temporalTimeline = buildTemporalTimeline(question, results)
  const retrievedContext = results.map((r, i) => {
    const lines = [`[${i + 1}]`]
    if (r.memory) lines.push(`Memory: ${r.memory}`)
    if (r.chunk && r.chunk !== r.memory) lines.push(`Chunks: ${r.chunk}`)
    if (!r.memory && r.chunk) lines.push(`Raw content: ${r.chunk}`)
    if (r.document_date) lines.push(`documentDate: ${r.document_date}`)
    if (r.event_date)    lines.push(`eventDate: ${r.event_date}`)
    if (r.relation_type) lines.push(`Version: ${r.relation_type}`)
    if (r.source_role)   lines.push(`Source: ${r.source_role}`)

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

  return `You are a question-answering system. Based on the retrieved context below, answer the question.

Question: ${question}
Question Date: ${questionDate}

Retrieved Context:
${retrievedContext || '(no memories retrieved)'}

Version Chains (CRITICAL):
  Some results are marked "⚠️ HISTORICAL VERSION" — these describe what USED TO
  be true, not what is currently true. The replacement value is shown inline.
  When the question asks about a CHANGE ("did you switch from X to Y", "more or
  less", "previous vs current"), you MUST compare:
    - The current fact (the seed, which has no HISTORICAL marker)
    - The historical fact (marked HISTORICAL) — this is what it used to be
  Use the HISTORICAL marker, not your inference about the previous value.

Instructions:
  Provide a clear, concise answer based ONLY on the provided context.
  If insufficient information, respond with "I don't know".

${temporalTimeline}
Answer:`
}

// ── load dataset ───────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_FILE)) {
  console.error(`[test] dataset not found: ${DATA_FILE}`)
  process.exit(1)
}
if (!fs.existsSync(DB_FILE)) {
  console.error(`[test] db not found: ${DB_FILE}`)
  console.error(`        update DB_FILE in this script to point at the correct file`)
  process.exit(1)
}

const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
const questions = QUESTION_IDS
  .map(id => dataset.find(q => q.question_id === id))
  .filter(Boolean)

if (questions.length !== QUESTION_IDS.length) {
  const found = questions.map(q => q.question_id)
  const missing = QUESTION_IDS.filter(id => !found.includes(id))
  console.error(`[test] missing question_ids in dataset: ${missing.join(', ')}`)
  process.exit(1)
}

console.log(`[test] loaded ${questions.length} questions from dataset`)
console.log(`[test] using db: ${DB_FILE}\n`)

// ── shared db ──────────────────────────────────────────────────────────────

const db = new Database(DB_FILE)

// ── helpers ────────────────────────────────────────────────────────────────

function fingerprint(result) {
  // What identifies a "same fact" between two retrievals
  return result.memory ?? `chunk:${(result.chunk ?? '').slice(0, 80)}`
}

function diff(baseline, expanded) {
  const baseFps = new Set(baseline.map(fingerprint))
  const newOnly = expanded.filter(r => !baseFps.has(fingerprint(r)))

  const expFps = new Set(expanded.map(fingerprint))
  const dropped = baseline.filter(r => !expFps.has(fingerprint(r)))

  return { newOnly, dropped }
}

function printResultList(results, label) {
  console.log(`  ${label} (${results.length} results):`)
  for (const [i, r] of results.entries()) {
    let tag
    if (r._expansion?.via === 'UPDATES_HISTORY') {
      tag = `HIST d=${r._expansion.depth} of#${r._expansion.seedId}`
    } else if (r._expansion?.via === 'EXTENDS') {
      tag = `EXP d=${r._expansion.depth}${r._expansion.supersededFrom ? ' supersedes#' + r._expansion.supersededFrom.id : ''}`
    } else {
      tag = 'SEED'
    }
    console.log(`    ${i + 1}. [${tag}] ${r.memory ?? '(chunk only)'}`)
    if (r._expansion?.supersededFrom) {
      console.log(`         ↳ resolved from stale: "${r._expansion.supersededFrom.value}"`)
    }
    if (r._expansion?.supersededBy) {
      console.log(`         ↳ replaced by: "${r._expansion.supersededBy.value}"`)
    }
    if (r.document_date) console.log(`         document_date: ${r.document_date}`)
  }
}

// ── main loop ──────────────────────────────────────────────────────────────

const summary = []

for (const tc of questions) {
  const { question_id, question_type, question, answer: expected, question_date } = tc

  console.log('═'.repeat(78))
  console.log(`▸ ${question_id}  [${question_type}]`)
  console.log(`  Q: ${question}`)
  console.log(`  Expected: ${expected}`)
  console.log(`  Question date: ${question_date}`)
  console.log()

  const memory = new Memory({
    db,
    container:     question_id,
    extractor,
    embedder,
  })

  const questionDateNorm = memory._normalizeDate(question_date) ?? question_date
  const asOf = questionDateNorm.length === 10
    ? questionDateNorm + 'T23:59'
    : questionDateNorm.slice(0, 10) + 'T23:59'

  // ── BASELINE: expansion OFF ─────────────────────────────────────────────
  const baseline = await memory.search(question, {
    topN: SEARCH_TOP_N,
    asOf,
    expandViaGraph: false,
  })

  // ── TASK 1.1: expansion ON ──────────────────────────────────────────────
  const taskRun = await memory.search(question, {
    topN: SEARCH_TOP_N,
    asOf,
    expandViaGraph: true,
    expandedLimit:  EXPANDED_LIMIT,
    expandDepth:    EXPAND_DEPTH,
  })

  // ── diff ────────────────────────────────────────────────────────────────
  const { newOnly, dropped } = diff(baseline, taskRun)

  console.log('─── Retrieval diff ─────────────────────────────────────────')
  printResultList(baseline, 'BASELINE')
  console.log()
  printResultList(taskRun, 'TASK 1.1')
  console.log()

  if (newOnly.length === 0 && dropped.length === 0) {
    console.log('  ⚠️  No difference — expansion added nothing')
  } else {
    if (newOnly.length > 0) {
      console.log(`  + ${newOnly.length} fact(s) ADDED by expansion:`)
      for (const r of newOnly) {
        const exp = r._expansion
        const note = exp?.supersededFrom
          ? `  (resolves stale fact "${exp.supersededFrom.value}")`
          : exp ? `  (depth ${exp.depth})` : ''
        console.log(`    + ${r.memory ?? '(chunk)'}${note}`)
      }
    }
    if (dropped.length > 0) {
      console.log(`  - ${dropped.length} fact(s) DROPPED (shouldn't happen):`)
      for (const r of dropped) console.log(`    - ${r.memory ?? '(chunk)'}`)
    }
  }
  console.log()

  // ── answer with each ────────────────────────────────────────────────────
  console.log('─── Answers ───────────────────────────────────────────────')

  const baseAnswer = await answerer(buildAnsweringPrompt({
    question, questionDate: questionDateNorm, results: baseline,
  }))
  const baseCorrect = await judge(question, expected, baseAnswer)
  console.log(`  BASELINE: ${baseCorrect ? '✅' : '❌'}  "${baseAnswer}"`)

  const taskAnswer = await answerer(buildAnsweringPrompt({
    question, questionDate: questionDateNorm, results: taskRun,
  }))
  const taskCorrect = await judge(question, expected, taskAnswer)
  console.log(`  TASK 1.1: ${taskCorrect ? '✅' : '❌'}  "${taskAnswer}"`)

  if (baseCorrect !== taskCorrect) {
    console.log(`\n  🎯 Outcome change: ${baseCorrect ? 'correct → incorrect (regression!)' : 'incorrect → correct (fixed by Task 1.1)'}`)
  } else if (baseAnswer !== taskAnswer) {
    console.log(`\n  ↪︎  Answer changed but correctness unchanged`)
  } else {
    console.log(`\n  →  No change`)
  }
  console.log()

  summary.push({
    question_id,
    baseline_count: baseline.length,
    task_count:     taskRun.length,
    added:          newOnly.length,
    dropped:        dropped.length,
    base_correct:   baseCorrect,
    task_correct:   taskCorrect,
    base_answer:    baseAnswer,
    task_answer:    taskAnswer,
    expected,
  })
}

// ── summary ────────────────────────────────────────────────────────────────

console.log('═'.repeat(78))
console.log('SUMMARY')
console.log('═'.repeat(78))
for (const s of summary) {
  const flag = s.base_correct === s.task_correct
    ? (s.base_correct ? '✅✅' : '❌❌')
    : (s.task_correct ? '❌→✅ FIXED' : '✅→❌ REGRESSED')
  console.log(`  ${s.question_id}  ${flag}  base:${s.baseline_count} task:${s.task_count} (+${s.added} -${s.dropped})`)
}

const fixed     = summary.filter(s => !s.base_correct &&  s.task_correct).length
const regressed = summary.filter(s =>  s.base_correct && !s.task_correct).length
const stable    = summary.length - fixed - regressed

console.log()
console.log(`  Fixed:     ${fixed}`)
console.log(`  Regressed: ${regressed}`)
console.log(`  Unchanged: ${stable}`)

db.close()