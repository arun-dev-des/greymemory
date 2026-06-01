// Feature 1 (Conversation upsert key) smoke test — opt-in dedupBySession.
//
// Verifies:
//   (a) dedupBySession:true — re-adding the same rounds + 1 new skips the dupes:
//       roundsSkipped===3, chunksStored===1, total chunks in DB ===4
//   (b) dedupBySession:false (default) — full duplicate: roundsSkipped===0, chunks ===7
//   (c) contextualRetrieval:true — skipped rounds don't incur a contextualization call
//   (d) session mode — the second add's extractor prompt contains ONLY the new round
//   (e) same sessionId, different container — NO cross-container skip
//
// Run from project root:  node "test files/test-task-3-dedup.js"

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { Memory } from '../src/memory.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tmpDir = path.join(__dirname, '.tmp-task3-dedup')
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

const embedder = async (text) => {
  const dims = 32, vec = new Array(dims)
  for (let d = 0; d < dims; d++) {
    let h = (d * 7919) ^ 0x9e3779b9
    for (let i = 0; i < text.length; i++) h = ((h * 131) + text.charCodeAt(i)) | 0
    vec[d] = ((h & 0xffff) / 0xffff) - 0.5
  }
  return vec
}

function assert(cond, msg) {
  if (!cond) { console.error('  FAIL:', msg); process.exitCode = 1 }
  else        { console.log('  ok —', msg) }
}

const round = (i) => ([
  { role: 'user',      content: `u${i}: tell me about topic ${i}` },
  { role: 'assistant', content: `a${i}: here is info about topic ${i}` },
])
const flat = (...rs) => rs.flatMap(r => r)

const countChunks = (mem) =>
  mem.storage.db.prepare('SELECT COUNT(*) c FROM chunks WHERE container = ?').get(mem.storage.container).c

function newMem(label, { contextualRetrieval = false, extractionMode = 'session', extractor } = {}) {
  const subdir = path.join(tmpDir, label)
  fs.mkdirSync(subdir, { recursive: true })
  const ext = extractor ?? (async (_p, opts) =>
    opts?.phase === 'contextualization' ? '[CTX] topic round.' : '[]')
  return new Memory({ dir: subdir, extractor: ext, embedder, contextualRetrieval, extractionMode })
}

// ── (a) dedupBySession:true skips already-ingested rounds ────────────────
console.log('\n[a] dedupBySession:true → re-add (3 same + 1 new) skips 3')
{
  const mem = newMem('a')
  const first = await mem.add(flat(round(1), round(2), round(3)), { sessionId: 's1', dedupBySession: true })
  assert(first.chunksStored === 3 && first.roundsSkipped === 0, `first add: 3 chunks, 0 skipped (got ${first.chunksStored}/${first.roundsSkipped})`)

  const second = await mem.add(flat(round(1), round(2), round(3), round(4)), { sessionId: 's1', dedupBySession: true })
  assert(second.roundsSkipped === 3, `second add: roundsSkipped===3 (got ${second.roundsSkipped})`)
  assert(second.chunksStored === 1, `second add: chunksStored===1 (got ${second.chunksStored})`)
  assert(second.chunksSkipped === 3, `second add: chunksSkipped===3 (got ${second.chunksSkipped})`)
  assert(countChunks(mem) === 4, `DB total chunks===4 (got ${countChunks(mem)})`)
}

// ── (b) dedupBySession off (default) → full duplicate ────────────────────
console.log('\n[b] dedupBySession:false → no skipping, chunks duplicated')
{
  const mem = newMem('b')
  const first = await mem.add(flat(round(1), round(2), round(3)), { sessionId: 's1' })
  const second = await mem.add(flat(round(1), round(2), round(3), round(4)), { sessionId: 's1' })
  assert(second.roundsSkipped === 0, `roundsSkipped===0 (got ${second.roundsSkipped})`)
  assert(countChunks(mem) === 7, `DB total chunks===7 (3+4, no dedup) (got ${countChunks(mem)})`)
}

// ── (c) contextualRetrieval: skipped rounds skip the contextualization call ──
console.log('\n[c] contextualRetrieval:true → skipped rounds incur no CTX call')
{
  const mem = newMem('c', { contextualRetrieval: true })
  const first = await mem.add(flat(round(1), round(2), round(3)), { sessionId: 's1', dedupBySession: true })
  assert(first.llmCalls.contextualization === 3, `first add: 3 CTX calls (got ${first.llmCalls.contextualization})`)
  const second = await mem.add(flat(round(1), round(2), round(3), round(4)), { sessionId: 's1', dedupBySession: true })
  assert(second.llmCalls.contextualization === 1, `second add: only 1 CTX call for the new round (got ${second.llmCalls.contextualization})`)
}

// ── (d) session mode: second add's extractor prompt has ONLY the new round ──
console.log('\n[d] session mode → survivor-only extraction prompt')
{
  const prompts = []
  const recExtractor = async (prompt, opts) => {
    if (opts?.phase === 'extraction') prompts.push(prompt)
    return '[]'
  }
  const mem = newMem('d', { extractionMode: 'session', extractor: recExtractor })
  const rA = [{ role: 'user', content: 'ALPHA_UNIQUE question' }, { role: 'assistant', content: 'ALPHA reply' }]
  const rB = [{ role: 'user', content: 'BRAVO_UNIQUE question' }, { role: 'assistant', content: 'BRAVO reply' }]
  await mem.add(rA, { sessionId: 's1', dedupBySession: true })
  prompts.length = 0
  await mem.add([...rA, ...rB], { sessionId: 's1', dedupBySession: true })
  const p = prompts.join('\n')
  assert(p.includes('BRAVO_UNIQUE'), 'second-add prompt includes the NEW round (BRAVO_UNIQUE)')
  assert(!p.includes('ALPHA_UNIQUE'), 'second-add prompt EXCLUDES the already-ingested round (ALPHA_UNIQUE)')
}

// ── (e) same sessionId, different container → no cross-container skip ─────
console.log('\n[e] container isolation → same sessionId never crosses containers')
{
  const db = new Database(path.join(tmpDir, 'shared.db'))
  const memA = new Memory({ db, container: 'projA', extractor: async () => '[]', embedder })
  const memB = new Memory({ db, container: 'projB', extractor: async () => '[]', embedder })
  await memA.add(round(1), { sessionId: 's1', dedupBySession: true })
  const b = await memB.add(round(1), { sessionId: 's1', dedupBySession: true })
  assert(b.roundsSkipped === 0, `container B does not skip (got ${b.roundsSkipped})`)
  assert(b.chunksStored === 1, `container B stores its own chunk (got ${b.chunksStored})`)
  db.close()
}

if (process.exitCode) console.log('\n✗ some assertions failed')
else { console.log('\n✓ all dedup assertions passed'); fs.rmSync(tmpDir, { recursive: true, force: true }) }
