// Task 2 (CP2 Key) smoke test — K = V + fact, indexing-stage merge.
//
// Verifies:
//   1. Chunk embedder receives user_text + "Facts:\n- ..." for a paired round with facts
//   2. Chunk embedder receives user_text only (no Facts: block) when extraction is empty
//   3. contextualRetrieval=true: chunks.content carries CR context (the VALUE),
//      but the chunk embedding input does NOT (the KEY stays user_text + facts)
//   4. USER_TEXT_CAP=4000 truncates a 5000-char user turn in the embedding input
//   5. MAX_FACTS_PER_CHUNK=50 caps a 60-fact extraction down to 50 in the embedding input
//   6. Orphan-assistant round embeds the assistant turn text as fallback user_text
//   7. embedderCallCounts.chunk equals distinct chunks saved (one call per chunk)
//
// Run from project root:  node "test files/test-task-2-cp2-keys.js"

import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Memory } from '../src/memory.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tmpDir = path.join(__dirname, '.tmp-cp2-test')
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

// Higher-fidelity stub: each dimension is independently hashed so distinct
// inputs produce near-orthogonal vectors. Without this the in-add() cosine
// dedup (threshold 0.92) collapses lexically-similar fact values into one.
const embedder = async (text, _opts) => {
  const dims = 32
  const vec  = new Array(dims)
  for (let d = 0; d < dims; d++) {
    let h = (d * 7919) ^ 0x9e3779b9
    for (let i = 0; i < text.length; i++) h = ((h * 131) + text.charCodeAt(i)) | 0
    vec[d] = ((h & 0xffff) / 0xffff) - 0.5
  }
  return vec
}

function makeRecordingEmbedder() {
  const calls = []  // { text, phase }
  const wrapped = async (text, opts = {}) => {
    calls.push({ text, phase: opts.phase ?? null })
    return embedder(text, opts)
  }
  return { wrapped, calls }
}

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1 }
  else        { console.log('  ok —', msg) }
}

async function newMem(label, { contextualRetrieval = false, extractor } = {}) {
  const subdir = path.join(tmpDir, label)
  fs.mkdirSync(subdir, { recursive: true })
  const rec = makeRecordingEmbedder()
  const ctxExtractor = async (prompt, opts) => {
    if (opts?.phase === 'contextualization') return '[CTX] this round is about TOPIC.'
    return extractor(prompt, opts)
  }
  const mem = new Memory({
    dir:        subdir,
    extractor:  ctxExtractor,
    embedder:   rec.wrapped,
    contextualRetrieval,
  })
  return { mem, calls: rec.calls }
}

// ── [1] paired round with extracted facts ───────────────────────────────
console.log('\n[1] paired round → chunk embedded as user_text + Facts:')
{
  const extractor = async () => JSON.stringify([
    { key: 'employer',  value: 'Alex works at Stripe in San Francisco',           source_message_index: 0 },
    { key: 'asst_note', value: 'The assistant confirmed payments-industry growth', source_message_index: 1 },
  ])
  const { mem, calls } = await newMem('case1', { extractor })
  const result = await mem.add([
    { role: 'user',      content: 'Where does Alex work?' },
    { role: 'assistant', content: 'Alex works at Stripe in San Francisco, focused on payments.' },
  ], { sessionId: 'case1' })

  const chunkCalls = calls.filter(c => c.phase === 'chunk')
  assert(chunkCalls.length === 1, `exactly 1 chunk embedder call (got ${chunkCalls.length})`)
  const input = chunkCalls[0]?.text ?? ''
  assert(input.startsWith('Where does Alex work?'), `embedding input starts with user_text (got: ${JSON.stringify(input.slice(0, 60))})`)
  assert(input.includes('\n\nFacts:\n- '), 'embedding input contains "Facts:\\n- " block')
  assert(input.includes('Alex works at Stripe in San Francisco'),     'fact value 1 present in embedding input')
  assert(input.includes('The assistant confirmed payments-industry'), 'fact value 2 present in embedding input')
  assert(!input.includes('focused on payments'),                       'embedding input does NOT contain raw assistant prose')
  assert(result.embedderCalls.chunk === 1, `embedderCalls.chunk == 1 (got ${result.embedderCalls.chunk})`)
}

// ── [2] empty extraction → chunk embedded as user_text only ─────────────
console.log('\n[2] empty extraction → chunk embedded as user_text only')
{
  const extractor = async () => '[]'  // nothing extracted
  const { mem, calls } = await newMem('case2', { extractor })
  const result = await mem.add([
    { role: 'user',      content: 'just a thought, no facts here' },
    { role: 'assistant', content: 'sure thing.' },
  ], { sessionId: 'case2' })

  const chunkCalls = calls.filter(c => c.phase === 'chunk')
  assert(chunkCalls.length === 1, `exactly 1 chunk embedder call (got ${chunkCalls.length})`)
  const input = chunkCalls[0]?.text ?? ''
  assert(input === 'just a thought, no facts here', `embedding input is user_text only (got: ${JSON.stringify(input)})`)
  assert(!input.includes('Facts:'), 'no Facts: block when extraction is empty')
  assert(result.embedderCalls.chunk === 1, `embedderCalls.chunk == 1 even on empty extraction (got ${result.embedderCalls.chunk})`)
  assert(result.factsStored === 0, 'factsStored == 0 on empty extraction')
}

// ── [3] contextualRetrieval ON: CR in VALUE, not in KEY ────────────────
console.log('\n[3] contextualRetrieval=true: chunks.content has CR; embedding input does NOT')
{
  const extractor = async () => JSON.stringify([
    { key: 'k', value: 'a self-contained fact', source_message_index: 0 },
  ])
  const { mem, calls } = await newMem('case3', { contextualRetrieval: true, extractor })
  await mem.add([
    { role: 'user',      content: 'tell me about TOPIC' },
    { role: 'assistant', content: 'here is some prose about TOPIC.' },
  ], { sessionId: 'case3' })

  // VALUE side (chunks.content) — used by BM25
  const chunkRow = mem.storage.db.prepare(`SELECT content FROM chunks ORDER BY id LIMIT 1`).get()
  assert(chunkRow.content.startsWith('[CTX]'), `chunks.content starts with CR context (got: ${JSON.stringify(chunkRow.content.slice(0, 40))})`)

  // KEY side (embedding input) — should NOT contain CR context
  const chunkCalls = calls.filter(c => c.phase === 'chunk')
  assert(chunkCalls.length === 1, `exactly 1 chunk embedder call (got ${chunkCalls.length})`)
  const input = chunkCalls[0]?.text ?? ''
  assert(!input.includes('[CTX]'),                  'embedding input does NOT include CR context prefix')
  assert(input.startsWith('tell me about TOPIC'),   'embedding input starts with user_text (no CR prefix)')
  assert(input.includes('a self-contained fact'),   'embedding input includes the extracted fact')
}

// ── [4] USER_TEXT_CAP truncates ────────────────────────────────────────
console.log('\n[4] USER_TEXT_CAP=4000 truncates a 5000-char user turn')
{
  const longUser = 'A'.repeat(5000)
  const extractor = async () => '[]'  // simpler: no facts needed
  const { mem, calls } = await newMem('case4', { extractor })
  await mem.add([
    { role: 'user',      content: longUser },
    { role: 'assistant', content: 'noted.' },
  ], { sessionId: 'case4' })

  const chunkCalls = calls.filter(c => c.phase === 'chunk')
  const input = chunkCalls[0]?.text ?? ''
  assert(input.length === 4000, `embedding input truncated to 4000 chars (got ${input.length})`)
  assert(/^A+$/.test(input),    'embedding input is all A characters')
}

// ── [5] MAX_FACTS_PER_CHUNK caps to 50 ─────────────────────────────────
console.log('\n[5] MAX_FACTS_PER_CHUNK=50 caps a 200-fact extraction')
{
  // Oversaturate well past the cap so the slice(0, 50) is the binding
  // constraint — independent of the (real-world tiny) chance that the
  // toy embedder drops a few near-duplicates via the in-add() cosine
  // dedup. With 200 distinct values, dedup attrition would have to
  // exceed 75% to make the cap *not* fire.
  const twoHundred = Array.from({ length: 200 }, (_, i) => ({
    key:   `k${i}`,
    value: `Marker-${i.toString(36)}-${(i * 7919).toString(36)} signature for unique fact index ${i}.`,
    source_message_index: 0,
  }))
  const extractor = async () => JSON.stringify(twoHundred)
  const { mem, calls } = await newMem('case5', { extractor })
  await mem.add([
    { role: 'user',      content: 'tell me about many things' },
    { role: 'assistant', content: 'here are many things.' },
  ], { sessionId: 'case5' })

  const chunkCalls = calls.filter(c => c.phase === 'chunk')
  const input = chunkCalls[0]?.text ?? ''
  const factBlock = input.split('Facts:\n').pop() ?? ''
  const bullets   = (factBlock.match(/^- /gm) ?? []).length
  assert(bullets === 50, `embedding input has exactly 50 fact bullets (got ${bullets})`)

  // Count distinct extracted-fact markers that survived into the embedding input.
  // With 200 candidates and a 50-fact cap, at LEAST 150 indexes must be missing —
  // which is the cap's job, not the dedup's.
  const present = []
  for (let i = 0; i < 200; i++) {
    if (input.includes(`Marker-${i.toString(36)}-${(i * 7919).toString(36)}`)) present.push(i)
  }
  assert(present.length === 50, `exactly 50 distinct fact markers present (got ${present.length})`)
  assert(present.length < 200,   `cap is the binding constraint: at least 150 facts omitted`)
}

// ── [6] orphan-assistant round → embedding falls back to assistant text ─
console.log('\n[6] orphan assistant round → embedding falls back to assistant turn text')
{
  const extractor = async () => JSON.stringify([
    { key: 'k', value: 'an assistant-only observation', source_message_index: 0 },
  ])
  const { mem, calls } = await newMem('case6', { extractor })
  await mem.add([
    { role: 'assistant', content: 'an unsolicited assistant statement about TOPIC' },
  ], { sessionId: 'case6' })

  const chunkCalls = calls.filter(c => c.phase === 'chunk')
  assert(chunkCalls.length === 1, `exactly 1 chunk embedder call (got ${chunkCalls.length})`)
  const input = chunkCalls[0]?.text ?? ''
  assert(input.startsWith('an unsolicited assistant statement'), `orphan-assistant embedding starts with the assistant text (got: ${JSON.stringify(input.slice(0, 60))})`)
  assert(input.includes('an assistant-only observation'),         'fact still included for orphan rounds')
}

// ── [7] one chunk embedder call per chunk across a multi-round session ─
console.log('\n[7] embedderCalls.chunk equals distinct chunks across a multi-round session')
{
  const extractor = async () => JSON.stringify([
    { key: 'k0', value: 'first round produced fact one',  source_message_index: 0 },
    { key: 'k1', value: 'second round produced fact two', source_message_index: 2 },
  ])
  const { mem, calls } = await newMem('case7', { extractor })
  const result = await mem.add([
    { role: 'user',      content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user',      content: 'q2' },
    { role: 'assistant', content: 'a2' },
  ], { sessionId: 'case7' })

  const chunkCalls = calls.filter(c => c.phase === 'chunk')
  assert(chunkCalls.length === 2, `2 chunk embedder calls (got ${chunkCalls.length})`)
  assert(result.embedderCalls.chunk === 2, `embedderCalls.chunk == 2 (got ${result.embedderCalls.chunk})`)
  assert(result.chunksStored === 2,        `chunksStored == 2 (got ${result.chunksStored})`)
}

console.log('\nDone.')

// cleanup
fs.rmSync(tmpDir, { recursive: true, force: true })
