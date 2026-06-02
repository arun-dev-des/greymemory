// benchmark/ingest-single.js
//
// Ingests a single question's haystack sessions into a target DB.
// Use when you want to A/B test against fresh data without running the
// full benchmark loop.

import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Memory }              from '../src/memory.js'
import { createBatchEmbedder } from '../src/batch-embedder.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── config ────────────────────────────────────────────────────────────────
const QUESTION_ID = '830ce83f'
const DB_DIR      = path.join(__dirname, '.greymemory-bench-test') // separate from main bench
const DATA_FILE   = path.join(__dirname, 'data', 'longmemeval_s_cleaned.json')
// ──────────────────────────────────────────────────────────────────────────

const INITIAL_ENTITY_CONTEXT = `This is memory for a single user across multiple conversation sessions with an AI assistant.
"I", "me", "my", "mine" always refer to the same person.
Resolve all pronouns and vague references using context from the full conversation.`

const tokenLog = { input: 0, output: 0, calls: 0 }

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
  tokenLog.input  += data.usage?.input_tokens  ?? 0
  tokenLog.output += data.usage?.output_tokens ?? 0
  tokenLog.calls  += 1
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

// ── load question ─────────────────────────────────────────────────────────

const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
const tc = dataset.find(q => q.question_id === QUESTION_ID)

if (!tc) {
  console.error(`[ingest] question_id not found: ${QUESTION_ID}`)
  process.exit(1)
}

console.log(`[ingest] question: "${tc.question}"`)
console.log(`[ingest] expected: "${tc.answer}"`)
console.log(`[ingest] sessions: ${tc.haystack_sessions.length}`)
console.log(`[ingest] target db: ${DB_DIR}/greymemory.db\n`)

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

// ── ingest ────────────────────────────────────────────────────────────────

const memory = new Memory({
  extractor,
  embedder,
  dir:           DB_DIR,
  container:     QUESTION_ID,
  entityContext: INITIAL_ENTITY_CONTEXT,
})

const t0 = Date.now()

for (let s = 0; s < tc.haystack_sessions.length; s++) {
  process.stdout.write(`  ingesting ${s + 1}/${tc.haystack_sessions.length}...`)
  try {
    await memory.add(tc.haystack_sessions[s], { date: tc.haystack_dates[s] })
    process.stdout.write(' ok\r' + ' '.repeat(50) + '\r')
  } catch (err) {
    process.stderr.write(`\n  [warn] session ${s}: ${err.message}\n`)
  }
}

const elapsed = (Date.now() - t0) / 1000

console.log(`\n[ingest] done in ${elapsed.toFixed(1)}s`)
console.log(`[ingest] haiku calls: ${tokenLog.calls}`)
console.log(`[ingest] tokens: ${tokenLog.input.toLocaleString()} in / ${tokenLog.output.toLocaleString()} out`)
console.log(`[ingest] cost: $${((tokenLog.input * 1 + tokenLog.output * 5) / 1_000_000).toFixed(2)}`)
console.log(`\n[ingest] db ready: ${path.join(DB_DIR, 'greymemory.db')}`)