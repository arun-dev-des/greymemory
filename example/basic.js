// example/basic.js
// Run: ANTHROPIC_API_KEY=your_key node example/basic.js
// Requires: Ollama running locally with mxbai-embed-large pulled

import 'dotenv/config'
import GreyMemory from '../src/index.js'
import Anthropic  from '@anthropic-ai/sdk'

// ── Extractor — uses Anthropic to pull facts ───────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const extractor = async (messages) => {
  const res = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Extract facts from this conversation as a flat JSON object.
Rules:
- keys are short snake_case strings
- values are strings only
- no nested objects, no arrays
- only factual information about the user
- respond with JSON only, no explanation

Conversation:
${JSON.stringify(messages)}`
    }]
  })
  const text = res.content[0].text.trim()
  return JSON.parse(text.replace(/```json|```/g, '').trim())
}

// ── Embedder — uses Ollama locally ─────────────────

const embedder = async (text) => {
  const res = await fetch('http://localhost:11434/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'mxbai-embed-large',
      prompt: text
    })
  })
  const data = await res.json()
  return data.embedding
}

// ── Initialise greymemory ──────────────────────────

const memory = new GreyMemory({
  extractor,
  embedder,
  dir:       '.greymemory-example',
  container: 'demo'
})

// ── Add a conversation ─────────────────────────────

console.log('Adding conversation...')

await memory.add([
  { role: 'user',      content: 'Hi, my name is Arun and I train powerlifting' },
  { role: 'assistant', content: 'Great to meet you Arun!' },
  { role: 'user',      content: 'I compete in the 83kg category' },
  { role: 'assistant', content: 'That is a great weight class!' },
  { role: 'user',      content: 'I train at Barbell Cartel in Bangalore' },
  { role: 'assistant', content: 'Noted.' }
])

console.log('Done.\n')

// ── Get all extracted facts ────────────────────────

console.log('Extracted facts:')
console.log(memory.getFacts())

// ── Search memory ──────────────────────────────────

console.log('\nSearch: "where does Arun train"')
const r1 = await memory.search('where does Arun train')
r1.forEach(r => console.log(`  [${r.type}] ${r.key}: ${r.value}`))

console.log('\nSearch: "powerlifting weight class"')
const r2 = await memory.search('powerlifting weight class')
r2.forEach(r => console.log(`  [${r.type}] ${r.key}: ${r.value}`))

// ── Clear memory ───────────────────────────────────

console.log('\nClearing memory...')
memory.clear()
console.log('Facts after clear:', memory.getFacts())