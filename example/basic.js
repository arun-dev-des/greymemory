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
    max_tokens: 1024,
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

// ── Add a conversation ─────────────────────────────────────────

console.log('Adding conversation...\n')

await memory.add([
  { role: 'user',      content: 'Hi, my name is Arun and I train powerlifting' },
  { role: 'assistant', content: 'Great to meet you Arun!' },
  { role: 'user',      content: 'I compete in the 83kg category' },
  { role: 'assistant', content: 'That is a great weight class!' },
  { role: 'user',      content: 'I train at Barbell Cartel in Bangalore' },
  { role: 'assistant', content: 'Noted.' }
])

console.log('Done.\n')

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
  console.log(`  memory: ${r.memory}`)
  console.log(`  chunk:  ${r.chunk ?? 'null'}`)
  console.log()
})

// ── getProfile — injection-ready for system prompts ────────────

console.log('Profile:')
const { profile } = await memory.getProfile()
console.log('  static:',  profile.static)
console.log('  dynamic:', profile.dynamic)

// use in system prompt
const systemPrompt = `You are a helpful assistant.

About this user:
${profile.static.join('\n')}

Current context:
${profile.dynamic.join('\n')}`

console.log('\nSystem prompt preview:')
console.log(systemPrompt)

// ── getCurrent — current truth for a concept ───────────────────

console.log('\nCurrent gym:')
const current = await memory.getCurrent('where does Arun train')
console.log(' ', current?.value ?? 'not found')

// ── Add second session — contradiction detection ────────────────

console.log('\nAdding second session — Arun moved gyms...\n')

await memory.add([
  { role: 'user',      content: 'I recently switched to training at Iron Temple in Chennai.' },
  { role: 'assistant', content: 'A new gym!' }
])

// getCurrent now returns the updated gym
console.log('Current gym after update:')
const updated = await memory.getCurrent('where does Arun train')
console.log(' ', updated?.value ?? 'not found')

// getHistory shows the full chain
console.log('\nGym history:')
const history = await memory.getHistory('where does Arun train')
history.forEach((h, i) => {
  console.log(`  ${i + 1}. [is_latest=${h.is_latest}] ${h.value}`)
})

// ── forget — soft delete ───────────────────────────────────────

console.log('\nForgetting weight class...')
const forgotten = await memory.forget('83kg weight class')
console.log('Forgotten:', forgotten)

// ── runDerivations — second-order inferences ───────────────────

console.log('\nRunning derivations...')
const derived = await memory.runDerivations({ sinceDays: 1 })
console.log(`Derived ${derived.length} new inference(s):`)
derived.forEach(d => console.log(' ', d.value))

// ── Clear memory ───────────────────────────────────────────────

console.log('\nClearing memory...')
memory.clear()
console.log('Memories after clear:', memory.getMemories().length)