// Round-pairing smoke test for Task 1 (CP1). No external LLM/embedder calls.
//
// Verifies:
//   1. messages [u, a, u, a] → 2 rounds (paired)
//   2. messages [u, a, u]    → 2 rounds (paired + orphan user)
//   3. messages [a, u, a]    → 2 rounds (orphan leading assistant + paired)
//   4. chunks.content carries BOTH user and assistant text on paired rounds
//   5. chunks table has no source_role column
//   6. per-fact source_role is still correctly derived from source_message_index
//   7. fresh DB applies the new _init schema without migration noise
//
// Run from project root:  node "test files/test-task-1-cp1-rounds.js"

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'
import { Memory } from '../src/memory.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tmpDir = path.join(__dirname, '.tmp-cp1-test')

// fresh dir each run
if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
fs.mkdirSync(tmpDir, { recursive: true })

// deterministic stubs — no network
const extractor = async (_prompt, _opts) => {
  // Two facts intentionally lexically distinct so the cosine-dedup pass in
  // Memory.add() doesn't collapse them (real embedders separate these easily).
  return JSON.stringify([
    { key: 'employer',   value: 'Alex works at Stripe in San Francisco',           source_message_index: 0 },
    { key: 'reply_note', value: 'The assistant confirmed startup hiring trends',   source_message_index: 1 },
  ])
}
const embedder = async (text, _opts) => {
  // Text-varying deterministic embedding so dedup-by-cosine doesn't collapse
  // distinct facts down to one in this test. Real embedders give different
  // vectors per text; this just mimics that property cheaply.
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 131 + text.charCodeAt(i)) | 0
  const seed = (h % 1000) / 1000
  return [0.1 + seed, 0.2 - seed, 0.3 + seed * 0.5, 0.4 - seed * 0.3]
}

async function run(messages, label) {
  const subdir = path.join(tmpDir, label)
  fs.mkdirSync(subdir, { recursive: true })
  const mem = new Memory({ dir: subdir, extractor, embedder })

  const result = await mem.add(messages, { sessionId: label })

  const rows = mem.storage.db.prepare(`SELECT id, content FROM chunks ORDER BY id`).all()
  const colInfo = mem.storage.db.pragma('table_info(chunks)').map(c => c.name)

  return { result, rows, columns: colInfo, mem }
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exitCode = 1
  } else {
    console.log('  ok —', msg)
  }
}

console.log('\n[1] messages [u, a, u, a] → 2 paired rounds')
{
  const { result, rows, columns } = await run([
    { role: 'user',      content: 'where does Alex work' },
    { role: 'assistant', content: 'Alex works at Stripe' },
    { role: 'user',      content: 'what about Bob' },
    { role: 'assistant', content: 'Bob works at Google' },
  ], 'case1')

  assert(rows.length === 2, `chunks: expected 2 rounds, got ${rows.length}`)
  assert(result.chunksStored === 2, `chunksStored: expected 2, got ${result.chunksStored}`)
  assert(!columns.includes('source_role'), `chunks columns should not include source_role (got: ${columns.join(',')})`)
  assert(rows[0].content.includes('user: where does Alex work') && rows[0].content.includes('assistant: Alex works at Stripe'), 'round 0 has both user and assistant text')
  assert(rows[1].content.includes('user: what about Bob') && rows[1].content.includes('assistant: Bob works at Google'), 'round 1 has both user and assistant text')
}

console.log('\n[2] messages [u, a, u] → paired + trailing orphan user')
{
  const { result, rows } = await run([
    { role: 'user',      content: 'q1' },
    { role: 'assistant', content: 'a1' },
    { role: 'user',      content: 'q2 with no reply yet' },
  ], 'case2')

  assert(rows.length === 2, `chunks: expected 2, got ${rows.length}`)
  assert(result.chunksStored === 2, `chunksStored: expected 2, got ${result.chunksStored}`)
  assert(rows[0].content.includes('user: q1') && rows[0].content.includes('assistant: a1'), 'round 0 paired')
  assert(rows[1].content === 'user: q2 with no reply yet', `round 1 single-turn orphan, got: ${JSON.stringify(rows[1].content)}`)
}

console.log('\n[3] messages [a, u, a] → orphan assistant + paired')
{
  const { result, rows } = await run([
    { role: 'assistant', content: 'unsolicited' },
    { role: 'user',      content: 'q1' },
    { role: 'assistant', content: 'a1' },
  ], 'case3')

  assert(rows.length === 2, `chunks: expected 2, got ${rows.length}`)
  assert(result.chunksStored === 2, `chunksStored: expected 2, got ${result.chunksStored}`)
  assert(rows[0].content === 'assistant: unsolicited', `round 0 orphan assistant, got: ${JSON.stringify(rows[0].content)}`)
  assert(rows[1].content.includes('user: q1') && rows[1].content.includes('assistant: a1'), 'round 1 paired')
}

console.log('\n[4] per-fact source_role derivation still works (user→0, assistant→1)')
{
  const subdir = path.join(tmpDir, 'case4')
  fs.mkdirSync(subdir, { recursive: true })
  const mem = new Memory({ dir: subdir, extractor, embedder })
  await mem.add([
    { role: 'user',      content: 'something' },
    { role: 'assistant', content: 'reply' },
  ], { sessionId: 'case4' })

  const facts = mem.storage.db.prepare(`SELECT key, source_role, chunk_id FROM facts ORDER BY id`).all()
  assert(facts.length === 2, `facts: expected 2, got ${facts.length}`)
  assert(facts[0].source_role === 'user',      `fact from index 0 → source_role 'user', got ${facts[0].source_role}`)
  assert(facts[1].source_role === 'assistant', `fact from index 1 → source_role 'assistant', got ${facts[1].source_role}`)
  assert(facts[0].chunk_id === facts[1].chunk_id, `both facts should point to the same round chunk (got ${facts[0].chunk_id} vs ${facts[1].chunk_id})`)
}

console.log('\n[5] fresh DB schema check')
{
  const subdir = path.join(tmpDir, 'case5-fresh')
  fs.mkdirSync(subdir, { recursive: true })
  const mem = new Memory({ dir: subdir, extractor, embedder })
  const cols = mem.storage.db.pragma('table_info(chunks)').map(c => c.name)
  assert(!cols.includes('source_role'), `fresh chunks schema has no source_role (got: ${cols.join(',')})`)
}

console.log('\n[6] migration: existing v0.3 chunks table with source_role')
{
  const subdir = path.join(tmpDir, 'case6-migrate')
  fs.mkdirSync(subdir, { recursive: true })
  const dbPath = path.join(subdir, 'greymemory.db')

  // Build a legacy DB with source_role on chunks (simulates pre-CP1 install)
  const legacy = new Database(dbPath)
  legacy.exec(`
    CREATE TABLE chunks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      content     TEXT NOT NULL,
      container   TEXT NOT NULL DEFAULT 'default',
      session_id  TEXT,
      source_role TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO chunks (content, container, session_id, source_role, created_at)
    VALUES
      ('legacy row 1', 'default', 'sess-A', 'user',      '2025-01-01'),
      ('legacy row 2', 'default', 'sess-A', 'assistant', '2025-01-02');
  `)
  legacy.close()

  const mem = new Memory({ dir: subdir, extractor, embedder })
  const cols = mem.storage.db.pragma('table_info(chunks)').map(c => c.name)
  const surviving = mem.storage.db.prepare(`SELECT id, content, session_id FROM chunks ORDER BY id`).all()

  assert(!cols.includes('source_role'), `migrated chunks has no source_role (got: ${cols.join(',')})`)
  assert(surviving.length === 2, `migrated rows preserved (expected 2, got ${surviving.length})`)
  assert(surviving[0].content === 'legacy row 1' && surviving[0].session_id === 'sess-A', 'row 1 content + session_id preserved')
  assert(surviving[1].content === 'legacy row 2' && surviving[1].session_id === 'sess-A', 'row 2 content + session_id preserved')
}

console.log('\nDone.')
