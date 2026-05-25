// benchmark/verify-task-3.js
//
// Lightweight diagnostic for Task 3 (CP3 Query: time-aware query expansion).
// Pulls ~20 temporal-reasoning questions from LongMemEval-S, runs the new
// M_T extractor (memory._extractQueryTimeRange) on each, and prints a table
// of {question, extracted_range, gold_session_dates}. Auto-classifies each
// row as PASS / FAIL / NEUTRAL so we can sanity-check whether Haiku is
// strong enough as M_T before flipping the default in production.
//
// Failure mode the paper warns about (§5.4): a weak M_T hallucinates ranges
// that EXCLUDE the gold session, dropping recall below the no-filter baseline.
// FAIL count here directly tracks that risk.
//
// Run:  node benchmark/verify-task-3.js

import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Memory } from '../src/memory.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const SAMPLE_SIZE = 20
const DATA_FILE   = path.join(__dirname, 'data', 'longmemeval_s_cleaned.json')
const DB_DIR      = path.join(__dirname, '.greymemory-verify-task3')

// ── providers ────────────────────────────────────────────────────────────

const tokenLog = { haikuIn: 0, haikuOut: 0, haikuCalls: 0 }

const extractor = async (prompt, _ctx) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Anthropic: ${data.error.message}`)
  tokenLog.haikuIn  += data.usage?.input_tokens  ?? 0
  tokenLog.haikuOut += data.usage?.output_tokens ?? 0
  tokenLog.haikuCalls++
  return data.content[0].text.trim()
}

// Embedder is never invoked when calling _extractQueryTimeRange directly,
// but the Memory constructor requires the function to exist.
const embedder = async () => { throw new Error('embedder should not be called') }

// ── load TR questions ────────────────────────────────────────────────────

const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
const trAll   = dataset.filter(q => q.question_type === 'temporal-reasoning')
const sample  = trAll.slice(0, SAMPLE_SIZE)

console.log(`temporal-reasoning questions in dataset: ${trAll.length}`)
console.log(`sample size:                              ${sample.length}`)
console.log()

// ── set up Memory (only _extractQueryTimeRange is exercised) ─────────────

if (fs.existsSync(DB_DIR)) fs.rmSync(DB_DIR, { recursive: true, force: true })
fs.mkdirSync(DB_DIR, { recursive: true })
const memory = new Memory({ extractor, embedder, dir: DB_DIR, container: 'verify-task-3' })

// ── helpers ──────────────────────────────────────────────────────────────

// Convert "2023/02/01 (Wed) 10:20" → "2023-02-01"
const goldDateOf = s => {
  if (!s) return null
  const m = String(s).match(/^(\d{4})[\/\-](\d{2})[\/\-](\d{2})/)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

const classify = (after, before, goldDates) => {
  // both null → M_T abstained. No filter, no harm. NEUTRAL.
  if (!after && !before) return 'NEUTRAL'
  // any gold date falls outside the range → FAIL (this drops recall).
  for (const d of goldDates) {
    if (!d) continue
    if (after  && d < after)  return 'FAIL'
    if (before && d > before) return 'FAIL'
  }
  return 'PASS'
}

// ── run ──────────────────────────────────────────────────────────────────

const counts = { PASS: 0, FAIL: 0, NEUTRAL: 0 }
const rows   = []

for (let i = 0; i < sample.length; i++) {
  const tc = sample[i]
  const today = goldDateOf(tc.question_date) ?? '2023-01-01'

  let result
  try {
    result = await memory._extractQueryTimeRange(tc.question, today)
  } catch (err) {
    result = { afterDate: null, beforeDate: null, _error: err.message }
  }

  const goldIds   = tc.answer_session_ids ?? []
  const goldDates = goldIds.map(id => {
    const idx = tc.haystack_session_ids?.indexOf(id)
    return idx == null || idx < 0 ? null : goldDateOf(tc.haystack_dates?.[idx])
  }).filter(Boolean)

  const verdict = classify(result.afterDate, result.beforeDate, goldDates)
  counts[verdict]++

  rows.push({ tc, today, result, goldDates, verdict })

  const verdictTag = verdict === 'PASS' ? '✓' : verdict === 'FAIL' ? '✗' : '—'
  const range = `${result.afterDate ?? '∅'} … ${result.beforeDate ?? '∅'}`
  const q = tc.question.length > 80 ? tc.question.slice(0, 77) + '…' : tc.question
  console.log(`${verdictTag} [${(i+1).toString().padStart(2)}] today=${today}  range=${range}`)
  console.log(`   Q: ${q}`)
  console.log(`   gold dates: ${goldDates.join(', ') || '(none)'}`)
  if (result._error) console.log(`   ERROR: ${result._error}`)
  console.log()
}

// ── summary ──────────────────────────────────────────────────────────────

console.log('─'.repeat(60))
console.log(`SUMMARY (${sample.length} TR questions):`)
console.log(`  PASS    (range covers all gold dates): ${counts.PASS}`)
console.log(`  NEUTRAL (M_T returned nulls):          ${counts.NEUTRAL}`)
console.log(`  FAIL    (range excludes a gold date):  ${counts.FAIL}`)
console.log()
const usefulCount   = counts.PASS + counts.FAIL  // M_T actually fired
const dangerRate    = usefulCount > 0 ? counts.FAIL / usefulCount : 0
const coverageRate  = (counts.PASS + counts.NEUTRAL) / sample.length
console.log(`  fail-when-fired rate:   ${(dangerRate * 100).toFixed(1)}%  (lower = safer; paper baseline implies <10% is acceptable)`)
console.log(`  safe-or-helpful rate:   ${(coverageRate * 100).toFixed(1)}%  (PASS + NEUTRAL ÷ total)`)
console.log()
console.log(`Pass criterion: FAIL ≤ 3 / ${sample.length}. Got ${counts.FAIL}.`)
console.log(counts.FAIL <= 3 ? '✓ M_T is safe to enable by default' : '✗ M_T is dropping gold sessions — tighten prompt or default to false')
console.log()

// ── cost ─────────────────────────────────────────────────────────────────

const haikuCost = (tokenLog.haikuIn * 1 + tokenLog.haikuOut * 5) / 1_000_000
console.log(`cost: ${tokenLog.haikuCalls} haiku calls, ${tokenLog.haikuIn.toLocaleString()} in / ${tokenLog.haikuOut.toLocaleString()} out → $${haikuCost.toFixed(4)}`)
