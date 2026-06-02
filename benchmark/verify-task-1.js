// benchmark/verify-task-1.js
//
// End-to-end verification for Task 1 (CP1 Value, round-level chunks).
// Picks a small LongMemEval question, ingests it fresh, inspects the
// resulting chunks/facts to confirm round-level granularity, then runs
// search + an OpenAI answerer to check correctness.
//
// Run:  node benchmark/verify-task-1.js

import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Memory }              from '../src/memory.js'
import { createBatchEmbedder } from '../src/batch-embedder.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const QUESTION_ID = '852ce960'  // smallest in dataset (396 msgs, knowledge-update)
const DB_DIR      = path.join(__dirname, '.greymemory-verify-task1')
const DATA_FILE   = path.join(__dirname, 'data', 'longmemeval_s_cleaned.json')
const SEARCH_TOP_N = 10

const INITIAL_ENTITY_CONTEXT = `This is memory for a single user across multiple conversation sessions with an AI assistant.
"I", "me", "my", "mine" always refer to the same person.
Resolve all pronouns and vague references using context from the full conversation.`

// ── providers ────────────────────────────────────────────────────────────

const tokenLog = { haikuIn: 0, haikuOut: 0, haikuCalls: 0, openaiIn: 0, openaiOut: 0 }

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
  tokenLog.haikuIn  += data.usage?.input_tokens  ?? 0
  tokenLog.haikuOut += data.usage?.output_tokens ?? 0
  tokenLog.haikuCalls++
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
  if (data.error) throw new Error(`OpenAI: ${data.error.message}`)
  tokenLog.openaiIn  += data.usage?.prompt_tokens     ?? 0
  tokenLog.openaiOut += data.usage?.completion_tokens ?? 0
  return data.choices[0].message.content.trim()
}

// ── load question ────────────────────────────────────────────────────────

const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
const tc = dataset.find(q => q.question_id === QUESTION_ID)
if (!tc) { console.error(`question_id not found: ${QUESTION_ID}`); process.exit(1) }

const totalMessages = tc.haystack_sessions.reduce((s, sess) => s + sess.length, 0)
const roleCounts = { user: 0, assistant: 0 }
const pairedHint = (() => {
  let paired = 0
  for (const sess of tc.haystack_sessions) {
    for (let i = 0; i < sess.length; i++) {
      roleCounts[sess[i].role] = (roleCounts[sess[i].role] ?? 0) + 1
      if (sess[i].role === 'user' && sess[i+1]?.role === 'assistant') { paired++; i++ }
    }
  }
  return paired
})()

console.log(`question:  "${tc.question}"`)
console.log(`expected:  "${tc.answer}"`)
console.log(`type:      ${tc.question_type}`)
console.log(`sessions:  ${tc.haystack_sessions.length}`)
console.log(`messages:  ${totalMessages} (user=${roleCounts.user}, assistant=${roleCounts.assistant})`)
console.log(`hint:      ~${pairedHint} pairable rounds + ${totalMessages - pairedHint * 2} orphans → ~${pairedHint + (totalMessages - pairedHint * 2)} chunks expected`)
console.log()

// ── fresh DB ─────────────────────────────────────────────────────────────

if (fs.existsSync(DB_DIR)) fs.rmSync(DB_DIR, { recursive: true, force: true })
fs.mkdirSync(DB_DIR, { recursive: true })

const memory = new Memory({
  extractor, embedder,
  dir:           DB_DIR,
  container:     QUESTION_ID,
  entityContext: INITIAL_ENTITY_CONTEXT,
})

// ── ingest ───────────────────────────────────────────────────────────────

console.log('--- INGEST ---')
const t0 = Date.now()
let chunksReturnedSum = 0
for (let s = 0; s < tc.haystack_sessions.length; s++) {
  process.stdout.write(`  session ${s + 1}/${tc.haystack_sessions.length}...\r`)
  try {
    const r = await memory.add(tc.haystack_sessions[s], {
      date:      tc.haystack_dates?.[s],
      sessionId: tc.haystack_session_ids?.[s] ?? `s${s}`,
    })
    chunksReturnedSum += r.chunksStored
  } catch (err) {
    process.stderr.write(`\n  [warn] session ${s}: ${err.message}\n`)
  }
}
console.log(`  ingested ${tc.haystack_sessions.length} sessions in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
console.log()

// ── inspect chunks ───────────────────────────────────────────────────────

console.log('--- CHUNK INSPECTION (Task 1 round-level granularity) ---')
const chunkCols = memory.storage.db.pragma('table_info(chunks)').map(c => c.name)
console.log(`  chunks schema columns:        ${chunkCols.join(', ')}`)
console.log(`  schema has source_role?       ${chunkCols.includes('source_role') ? 'YES (FAIL)' : 'no (ok)'}`)

const chunkCount = memory.storage.db
  .prepare(`SELECT COUNT(*) AS n FROM chunks WHERE container = ?`)
  .get(QUESTION_ID).n
console.log(`  total chunks in DB:           ${chunkCount}`)
console.log(`  chunksStored sum from add():  ${chunksReturnedSum}`)
console.log(`  total source messages:        ${totalMessages}`)
console.log(`  rounds saved messages:        ${totalMessages - chunkCount} (= ${((totalMessages - chunkCount) / totalMessages * 100).toFixed(1)}% reduction)`)

// Pairing distribution: how many chunks look paired (contain "user:" AND "assistant:")?
const allChunks = memory.storage.db
  .prepare(`SELECT id, content FROM chunks WHERE container = ? ORDER BY id`)
  .all(QUESTION_ID)
let paired = 0, orphanUser = 0, orphanAsst = 0, other = 0
for (const c of allChunks) {
  const hasU = /^user: /m.test(c.content)
  const hasA = /^assistant: /m.test(c.content)
  if (hasU && hasA) paired++
  else if (hasU) orphanUser++
  else if (hasA) orphanAsst++
  else other++
}
console.log(`  chunk shape distribution:     paired=${paired}, orphan-user=${orphanUser}, orphan-assistant=${orphanAsst}, other=${other}`)

console.log(`\n  sample paired round (chunk #${allChunks.find(c => /^user: /m.test(c.content) && /^assistant: /m.test(c.content))?.id}):`)
const samplePaired = allChunks.find(c => /^user: /m.test(c.content) && /^assistant: /m.test(c.content))
if (samplePaired) {
  const preview = samplePaired.content.length > 400 ? samplePaired.content.slice(0, 400) + '…' : samplePaired.content
  console.log(preview.split('\n').map(l => '    ' + l).join('\n'))
}
console.log()

// ── inspect facts ────────────────────────────────────────────────────────

console.log('--- FACT INSPECTION (per-fact source_role still works) ---')
const factsByRole = memory.storage.db.prepare(`
  SELECT source_role, COUNT(*) AS n
  FROM facts
  WHERE container = ?
  GROUP BY source_role
`).all(QUESTION_ID)
console.log(`  source_role distribution:`, Object.fromEntries(factsByRole.map(r => [r.source_role ?? 'null', r.n])))

const sharedChunks = memory.storage.db.prepare(`
  SELECT chunk_id, COUNT(*) AS n
  FROM facts
  WHERE container = ? AND chunk_id IS NOT NULL
  GROUP BY chunk_id
  HAVING n > 1
  ORDER BY n DESC
  LIMIT 3
`).all(QUESTION_ID)
console.log(`  top chunks with multiple facts (proves both turns of a round point to one chunk):`)
for (const sc of sharedChunks) {
  const facts = memory.storage.db.prepare(`
    SELECT key, source_role FROM facts WHERE chunk_id = ? AND container = ? LIMIT 5
  `).all(sc.chunk_id, QUESTION_ID)
  console.log(`    chunk #${sc.chunk_id}: ${sc.n} facts → roles: [${facts.map(f => f.source_role ?? '?').join(', ')}]`)
}
console.log()

// ── search + answer ─────────────────────────────────────────────────────

console.log('--- QUESTION ---')
const asOf = tc.question_date ? tc.question_date.split(' ')[0].replace(/\//g, '-') : null
const retrieved = await memory.search(tc.question, { topN: SEARCH_TOP_N, asOf })
console.log(`  retrieved ${retrieved.length} items (asOf=${asOf})`)
console.log(`  top 5 (by relevance):`)
for (const r of retrieved.slice(0, 5)) {
  const text = r.memory ?? r.chunk ?? '(empty)'
  const preview = text.length > 200 ? text.slice(0, 200) + '…' : text
  const tag = r.memory_type ?? 'chunk'
  console.log(`    [${tag}] ${preview.replace(/\n/g, ' ')}`)
}

const prompt = `You are a question-answering system. Based ONLY on the retrieved context below, answer the question concisely. If the context does not contain the answer, say so.

Question: ${tc.question}

Retrieved context (most relevant first):
${retrieved.map((r, i) => {
  const text = r.memory ?? r.chunk ?? ''
  return `[${i+1}] (${r.memory_type ?? 'chunk'}${r.document_date ? `, ${r.document_date}` : ''}): ${text}`
}).join('\n\n')}

Provide a clear, concise answer.`

console.log('\n--- ANSWER ---')
const got = await answerer(prompt)
console.log(`  expected: ${tc.answer}`)
console.log(`  got:      ${got}`)
console.log(`  match:    ${got.toLowerCase().includes(String(tc.answer).toLowerCase()) ? 'YES ✓' : 'NO (manual review needed — wording may differ)'}`)

// ── cost ────────────────────────────────────────────────────────────────

console.log('\n--- COST ---')
const haikuCost  = (tokenLog.haikuIn * 1 + tokenLog.haikuOut * 5) / 1_000_000
const openaiCost = (tokenLog.openaiIn * 2.5 + tokenLog.openaiOut * 10) / 1_000_000
console.log(`  haiku (extract+relate): ${tokenLog.haikuCalls} calls, ${tokenLog.haikuIn.toLocaleString()} in / ${tokenLog.haikuOut.toLocaleString()} out → $${haikuCost.toFixed(3)}`)
console.log(`  gpt-4o (answer):        ${tokenLog.openaiIn.toLocaleString()} in / ${tokenLog.openaiOut.toLocaleString()} out → $${openaiCost.toFixed(3)}`)
console.log(`  total:                  $${(haikuCost + openaiCost).toFixed(3)}`)
console.log(`\n  db kept at: ${path.join(DB_DIR, 'greymemory.db')}`)
