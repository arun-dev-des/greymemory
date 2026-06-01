// Feature 2 (Structured message support) smoke test.
//
// Verifies:
//   (a) array content [{text},{image_url}] → chunk has the text AND '[image]', never the URL
//   (b) image-only message → chunk carries '[image]', ingestion succeeds (no throw)
//   (c) assistant tool_calls → extractor prompt contains '[tool_call name=...]'
//   (d) role:'tool' result → stored fact source_role==='tool'; chunk carries '[tool result name=...]'
//   (e) plain {role,content:string}[] → chunk content byte-identical to pre-change
//
// Run from project root:  node "test files/test-task-4-structured.js"

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Memory } from '../src/memory.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tmpDir = path.join(__dirname, '.tmp-task4-structured')
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

const chunks = (mem) =>
  mem.storage.db.prepare('SELECT content FROM chunks WHERE container = ? ORDER BY id').all(mem.storage.container).map(r => r.content)
const facts = (mem) =>
  mem.storage.db.prepare('SELECT source_role, value FROM facts WHERE container = ?').all(mem.storage.container)

function newMem(label, extractor) {
  const subdir = path.join(tmpDir, label)
  fs.mkdirSync(subdir, { recursive: true })
  return new Memory({ dir: subdir, extractor: extractor ?? (async () => '[]'), embedder })
}

const IMG_URL = 'https://example.com/secret-diagram.png'

// ── (a) mixed text + image content blocks ────────────────────────────────
console.log('\n[a] content blocks [text, image_url] → text + [image], never the URL')
{
  const mem = newMem('a')
  await mem.add([
    { role: 'user', content: [
      { type: 'text', text: 'Check this diagram' },
      { type: 'image_url', imageUrl: { url: IMG_URL } },
    ]},
    { role: 'assistant', content: 'Looks good' },
  ])
  const c = chunks(mem).join('\n')
  assert(c.includes('Check this diagram'), 'chunk contains the text block')
  assert(c.includes('[image]'), "chunk contains the '[image]' placeholder")
  assert(!c.includes('example.com'), 'chunk does NOT contain the image URL')
}

// ── (b) image-only message ───────────────────────────────────────────────
console.log('\n[b] image-only message → ingests, chunk is [image]')
{
  const mem = newMem('b')
  let threw = false
  try {
    await mem.add([{ role: 'user', content: [{ type: 'image_url', imageUrl: { url: IMG_URL } }] }])
  } catch { threw = true }
  assert(!threw, 'ingestion did not throw on image-only content')
  const c = chunks(mem)
  assert(c.length === 1 && c[0].includes('[image]') && !c[0].includes('example.com'),
    `chunk is the [image] placeholder (got ${JSON.stringify(c)})`)
}

// ── (c) assistant tool_calls fold into the extractor prompt ──────────────
console.log('\n[c] assistant tool_calls → prompt contains [tool_call name=...]')
{
  const prompts = []
  const ext = async (prompt, opts) => { if (opts?.phase === 'extraction') prompts.push(prompt); return '[]' }
  const mem = newMem('c', ext)
  await mem.add([
    { role: 'user', content: 'run the tests' },
    { role: 'assistant', content: '', tool_calls: [{ id: 't1', name: 'Bash', arguments: { command: 'npm test' } }] },
  ])
  const p = prompts.join('\n')
  assert(p.includes('[tool_call name=Bash'), 'extractor prompt includes the serialized tool_call')
  assert(p.includes('npm test'), 'extractor prompt includes the tool arguments')
}

// ── (d) tool-result turn → source_role 'tool', chunk has [tool result ...] ──
console.log("\n[d] role:'tool' result → source_role==='tool', chunk carries the label")
{
  // extractor returns one fact attributed to message index 2 (the tool result)
  const ext = async (_p, opts) => {
    if (opts?.phase === 'extraction')
      return JSON.stringify([{ key: 'weather_paris', value: 'It is 18C and sunny in Paris', source_message_index: 2 }])
    return '{}'
  }
  const mem = newMem('d', ext)
  await mem.add([
    { role: 'user', content: "what's the weather in Paris?" },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'get_weather', arguments: { city: 'Paris' } }] },
    { role: 'tool', tool_call_id: 'c1', name: 'get_weather', content: '18C, sunny' },
    { role: 'assistant', content: 'It is 18C and sunny in Paris.' },
  ])
  const rows = facts(mem)
  assert(rows.some(r => r.source_role === 'tool'), `a stored fact has source_role==='tool' (got ${JSON.stringify(rows.map(r => r.source_role))})`)
  const c = chunks(mem).join('\n')
  assert(c.includes('[tool result name=get_weather]'), 'a chunk carries the [tool result name=...] label')
}

// ── (e) plain conversation → byte-identical chunk format (back-compat) ────
console.log('\n[e] plain {role,content:string}[] → unchanged chunk format')
{
  const mem = newMem('e')
  await mem.add([
    { role: 'user', content: 'I love pizza' },
    { role: 'assistant', content: 'noted' },
  ])
  const c = chunks(mem)
  assert(c.length === 1 && c[0] === 'user: I love pizza\nassistant: noted',
    `chunk format unchanged (got ${JSON.stringify(c)})`)
}

if (process.exitCode) console.log('\n✗ some assertions failed')
else { console.log('\n✓ all structured-message assertions passed'); fs.rmSync(tmpDir, { recursive: true, force: true }) }
