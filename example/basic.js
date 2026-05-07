// example/basic.js
// Run: ANTHROPIC_API_KEY=your_key node example/basic.js
// Requires: Ollama running locally with mxbai-embed-large pulled

import 'dotenv/config'
import GreyMemory from '../src/index.js'
import Anthropic  from '@anthropic-ai/sdk'

// ── Extractor — receives a built prompt, returns raw string ────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const extractor = async (prompt) => {
  const res = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages:   [{ role: 'user', content: prompt }]
  })
  return res.content[0].text.trim()
}

// ── Embedder — uses Ollama locally ─────────────────────────────

const embedder = async (text) => {
  const res = await fetch('http://localhost:11434/api/embeddings', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: 'mxbai-embed-large', prompt: text })
  })
  return (await res.json()).embedding
}

// ── Initialise greymemory ──────────────────────────────────────

const memory = new GreyMemory({
  extractor,
  embedder,
  dir:           '.greymemory-example',
  container:     'demo',
  filterPrompt:  'Index: name, sport, gym, location, competitions. Skip: greetings, small talk.',
  entityContext: 'Memory for Arun, a powerlifter based in Bangalore.',
})

// ── Session 1: Basic facts ─────────────────────────────────────

console.log('Session 1: Adding basic facts...\n')

await memory.add([
  { role: 'user',      content: 'Hi, my name is Arun and I train powerlifting' },
  { role: 'assistant', content: 'Great to meet you Arun!' },
  { role: 'user',      content: 'I compete in the 83kg category' },
  { role: 'assistant', content: 'That is a great weight class!' },
  { role: 'user',      content: 'I train at Barbell Cartel in Bangalore' },
  { role: 'assistant', content: 'Noted.' }
])

// ── Get all memories ───────────────────────────────────────────

console.log('All memories:')
const memories = memory.getMemories()
memories.forEach(m => {
  console.log(`  [${m.memory_type}] ${m.value}`)
})

// ── Search — dual retrieval (memory + source chunk) ────────────

console.log('\nSearch: "where does Arun train"')
const r1 = await memory.search('where does Arun train')
r1.forEach(r => {
  console.log(`  memory:      ${r.memory}`)
  console.log(`  chunk:       ${r.chunk ?? 'null'}`)
  console.log(`  source_role: ${r.source_role ?? 'unknown'}`)
  console.log()
})

// ── getProfile — injection-ready for system prompts ────────────

console.log('Profile:')
const { profile } = await memory.getProfile()
console.log('  static:',  profile.static)
console.log('  dynamic:', profile.dynamic)

const systemPrompt = `You are a helpful assistant.

About this user:
${profile.static.join('\n')}

Current context:
${profile.dynamic.join('\n')}`

console.log('\nSystem prompt preview:')
console.log(systemPrompt)

// ── Session 2: Contradiction detection ─────────────────────────

console.log('\n\nSession 2: Arun moved gyms...\n')

await memory.add([
  { role: 'user',      content: 'I recently switched to training at Iron Temple in Chennai.' },
  { role: 'assistant', content: 'A new gym! How is it?' },
  { role: 'user',      content: 'Much better equipment. Also my squat PR is now 200kg, up from 180kg.' },
  { role: 'assistant', content: 'Impressive progress!' }
])

// getCurrent returns the latest version
console.log('Current gym after update:')
const updated = await memory.getCurrent('where does Arun train')
console.log(' ', updated?.value ?? 'not found')

// getHistory shows the full version chain
console.log('\nGym history:')
const history = await memory.getHistory('where does Arun train')
history.forEach((h, i) => {
  console.log(`  ${i + 1}. [is_latest=${h.is_latest}] ${h.value}`)
})

// ── Session 3: Historical data with date ───────────────────────

console.log('\n\nSession 3: Adding historical data with date...\n')

await memory.add([
  { role: 'user',      content: 'I won gold at the Karnataka State Championship last month.' },
  { role: 'assistant', content: 'Congratulations!' }
], { date: '2026-03-15' })

// ── asOf time-travel ───────────────────────────────────────────

console.log('Search with asOf (time-travel):')
console.log('  Before gym change:')
const past = await memory.search('where does Arun train', { asOf: '2026-04-01' })
past.forEach(r => console.log(`    ${r.memory}`))

console.log('  After gym change:')
const present = await memory.search('where does Arun train')
present.forEach(r => console.log(`    ${r.memory}`))

// ── forget — soft delete ───────────────────────────────────────

console.log('\nForgetting weight class...')
const forgotten = await memory.forget('83kg weight class')
console.log('Forgotten:', forgotten)

// ── runDerivations — second-order inferences ───────────────────

console.log('\nRunning derivations...')
const derived = await memory.runDerivations({ sinceDays: 30 })
console.log(`Derived ${derived.length} new inference(s):`)
derived.forEach(d => console.log(' ', d.value))

// ── Cleanup ────────────────────────────────────────────────────

console.log('\nClearing memory...')
memory.clear()
console.log('Memories after clear:', memory.getMemories().length)
