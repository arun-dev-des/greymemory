# greymemory 🧠

> Self-hosted memory for AI agents. Extracts facts, detects contradictions, builds user profiles. Bring your own LLM. Your data never leaves your server.

**Why the name?** Named after Grey Matter from Ben 10 — the tiniest alien in the universe, but the smartest being in existence. Also a nod to grey matter in the brain, where intelligence actually lives. Small footprint. Quietly powerful.

---

## The problem

Every AI agent forgets everything when the conversation ends.

The obvious fix is memory. But every solution — Supermemory, Mem0 — stores your data on their cloud. You're trading one problem for another.

greymemory runs entirely on your server:
```
Your data → your machine → your LLM → stays with you. Always.
```

Hospitals, banks, factories, defence — entire industries are locked out of AI memory because every solution requires trusting a third party with their most sensitive data. greymemory is built for them.

---

## What's new in v0.3

- **Memory types** — facts, preferences, episodes. Each with its own lifecycle. Episodes expire automatically. Preferences strengthen with repetition.
- **Relationship detection** — UPDATES, EXTENDS, DERIVES. Contradictions are resolved. History is preserved, never overwritten.
- **Knowledge graph** — every fact knows what it superseded and what superseded it. `getCurrent()` always returns current truth. `getHistory()` walks the full version chain.
- **Dual retrieval** — search returns atomic memories paired with their source chunks. The LLM gets signal and context together.
- **User profiles** — `getProfile()` splits memory into static (permanent traits) and dynamic (recent context). Injection-ready for system prompts. Matches Supermemory's profile API.
- **Temporal grounding** — every memory has a `document_date` (when recorded) and `event_date` (when it actually happened). Date filtering on search.
- **Forget** — soft delete via `forget()`. Memory disappears from queries immediately but is preserved in the database for audit.
- **DERIVES inference** — `runDerivations()` combines existing memories to generate second-order conclusions.
- **filterPrompt + entityContext** — tell greymemory what to index and who it belongs to. Per-organisation and per-container customisation.

---

## Quick start

```bash
npm install greymemory
npx greymemory init
```

The CLI asks a few questions and generates a ready-to-use config file:

```
✦ greymemory — private memory for AI agents

? Extraction provider: Anthropic
? Extraction model: claude-haiku-4-5-20251001 (fast, cheap — recommended)
? Anthropic API key: ****
? Embedding provider: Ollama (free, local)
? Embedding model: mxbai-embed-large (recommended)
? Storage directory: .greymemory
? Container name: default

✔ greymemory.config.js created
✔ .env updated
  .env added to .gitignore
✔ @anthropic-ai/sdk, dotenv installed

✦ Ready. Add to your project:
  import memory from './greymemory.config.js'
  await memory.add(messages)
  await memory.search('query')
```

---

## Usage

```javascript
import memory from './greymemory.config.js'

// add a conversation — facts extracted, chunks stored, relationships detected
await memory.add([
  { role: 'user',      content: 'My name is Arun. I work at Barbell Cartel as a product designer in Bangalore.' },
  { role: 'assistant', content: 'Got it!' }
])

// search — returns memory + source chunk paired together
const results = await memory.search('where does Arun work')
// [
//   {
//     memory:        'Arun works at Barbell Cartel as a product designer',
//     chunk:         'user: My name is Arun. I work at Barbell Cartel...',
//     memory_type:   'fact',
//     confidence:    1.0,
//     document_date: '2026-04-08',
//     event_date:    null,
//     relation_type: null
//   }
// ]

// inject into your agent via profile
const { profile } = await memory.getProfile()
const systemPrompt = `You are a helpful assistant.

About this user:
${profile.static.join('\n')}

Current context:
${profile.dynamic.join('\n')}`
```

---

## Manual setup (without CLI)

```bash
npm install greymemory dotenv
```

```javascript
import 'dotenv/config'
import GreyMemory from 'greymemory'
import Anthropic  from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const memory = new GreyMemory({
  // extractor receives a built prompt string, returns raw string
  extractor: async (prompt) => {
    const res = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages:   [{ role: 'user', content: prompt }]
    })
    return res.content[0].text
  },

  // embedder converts text to a vector
  embedder: async (text) => {
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ model: 'mxbai-embed-large', prompt: text })
    })
    return (await res.json()).embedding
  },

  // tell greymemory what to index and who this memory belongs to
  filterPrompt:  'Index: decisions, preferences, projects. Skip: small talk.',
  entityContext: 'Memory for Arun, a product designer based in Bangalore.',
})
```

---

## API

### `new GreyMemory(options)`

```typescript
new GreyMemory({
  extractor:     async (prompt: string) => string,   // required
  embedder:      async (text: string)   => number[], // required
  dir?:          string,   // storage directory, default: ".greymemory"
  container?:    string,   // namespace isolation, default: "default"
  filterPrompt?: string,   // what to index and skip (org-level)
  entityContext?: string,  // who this memory belongs to (per-container)
  db?:           Database  // existing better-sqlite3 connection
})
```

---

### `await memory.add(input)`

Extracts memories, detects relationships, stores chunks with provenance.

```javascript
// conversation
await memory.add([
  { role: 'user',      content: 'I now work at Stripe as a PM' },
  { role: 'assistant', content: 'Congratulations!' }
])

// plain text
await memory.add('Arun is building greymemory, an open source memory library.')
```

---

### `await memory.search(query, options?)`

Hybrid BM25 + vector search. Returns atomic memories paired with source chunks.

```javascript
// basic
const results = await memory.search('where does Arun work')

// with options
const results = await memory.search('investor meeting', {
  topN:        3,
  memoryTypes: ['episode'],
  afterDate:   '2026-04-01',
  beforeDate:  '2026-04-30',
})
```

**Search options:**

| Option           | Type       | Default | Description |
|------------------|------------|---------|-------------|
| `topN`           | `number`   | `5`     | Number of results |
| `memoryTypes`    | `string[]` | `null`  | Filter by type: `fact`, `preference`, `episode` |
| `afterDate`      | `string`   | `null`  | Filter by event_date >= date (YYYY-MM-DD) |
| `beforeDate`     | `string`   | `null`  | Filter by event_date <= date (YYYY-MM-DD) |
| `includeHistory` | `boolean`  | `false` | Include superseded facts |
| `includeExpired` | `boolean`  | `false` | Include expired episodes |

---

### `await memory.getProfile(options?)`

Returns static/dynamic user profile for system prompt injection.

```javascript
// profile only
const { profile } = await memory.getProfile()
// profile.static  → ['Arun prefers TypeScript', 'Arun works at Barbell Cartel']
// profile.dynamic → ['Arun is building greymemory v0.3']

// profile + search in one call
const { profile, results } = await memory.getProfile({ q: 'current project' })

// inject into system prompt
const systemPrompt = `You are a helpful assistant.

About this user:
${profile.static.join('\n')}

Current context:
${profile.dynamic.join('\n')}`
```

**Classification:**
- `static` — preferences (always) + facts older than 7 days
- `dynamic` — facts from the last 7 days + current episodes

---

### `await memory.getCurrent(query)`

Returns the current version of a fact via semantic search.

```javascript
const current = await memory.getCurrent('where does Arun work')
// { id: 3, value: 'Arun works at Stripe', memory_type: 'fact', ... }
```

---

### `await memory.getHistory(query)`

Returns the full version chain for a fact, newest first.

```javascript
const history = await memory.getHistory('where has Arun worked')
// [
//   { value: 'Arun works at Stripe', is_latest: true  },
//   { value: 'Arun worked at Google', is_latest: false }
// ]
```

---

### `await memory.forget(query)`

Soft-delete a memory via semantic search. Disappears immediately from all queries. Preserved in database.

```javascript
const forgotten = await memory.forget('investor demo')
// → 'Arun has an investor demo on Friday April 10th at 3pm'
```

---

### `await memory.runDerivations(options?)`

Infers second-order conclusions by combining existing memories. Call after `add()`, on a schedule, or before important queries.

```javascript
await memory.add(messages)
await memory.runDerivations()                            // last 7 days
await memory.runDerivations({ sinceDays: 1, topK: 5 })  // just today
```

---

### `memory.getMemories()`

Returns all current memories as full row objects.

```javascript
const memories = memory.getMemories()
// [{ id, key, value, memory_type, confidence, document_date, ... }]
```

---

### `memory.getFacts()`

Alias for `getMemories()`. Kept for v0.2.x backward compatibility.

---

### `memory.clear()`

Deletes all facts, chunks, and embeddings for this container. Other containers untouched.

---

## Using an existing SQLite database

```javascript
import Database   from 'better-sqlite3'
import GreyMemory from 'greymemory'

const db = new Database('/home/user/.devlog/devlog.db')

const memory = new GreyMemory({ extractor, embedder, db, container: 'memory' })
```

greymemory creates its own tables inside your existing database. Your existing tables are untouched.

---

## Container isolation

```javascript
const userA = new GreyMemory({ container: 'user-123', ...options })
const userB = new GreyMemory({ container: 'user-456', ...options })
```

---

## Migrating from v0.2.x

greymemory v0.3 migrates your existing database automatically on first use. No action needed.

If you prefer to migrate manually before upgrading your code:

```bash
npx greymemory migrate
npx greymemory migrate --dir /custom/path
```

**Breaking changes from v0.2.x:**

- `extractor` signature changed — now receives a `prompt: string` and returns a `string`, not `Message[] → Facts`. Update your extractor function.
- `search()` result shape changed — results now have `memory` and `chunk` instead of `key`, `value`, and `type`.
- `getFacts()` still works but returns the richer v0.3 shape — use `getMemories()` for new code.

---

## How it works

```
Conversation
    ↓
Save chunks first — one per message, with embeddings
    ↓
extractor()
  Resolves ambiguity → classifies memory type → extracts atomic memories
    ↓
For each memory:
  _detectRelationship()    → UPDATES | EXTENDS | NEW
  saveFact()               → stored with chunk_id, relation_type, superseded_from
  supersedeFact()          → if UPDATES, marks old fact is_latest=0
  saveEmbedding()          → each fact version gets its own embedding
    ↓
Optional: runDerivations() → second-order inferences stored as DERIVES

Query
    ↓
BM25 search + vector search on facts only
RRF fusion with confidence weighting for preferences
For each result: fetch source chunk via chunk_id
    ↓
{ memory, chunk, memory_type, confidence, ... }
```

---

## Supported providers

| Provider  | Extractor                        | Embedder                               |
|-----------|----------------------------------|----------------------------------------|
| Anthropic | ✅ Claude Haiku, Sonnet, Opus    | ❌                                     |
| OpenAI    | ✅ GPT-4o-mini, GPT-4o           | ✅ text-embedding-3-small/large        |
| Ollama    | ✅ llama3, mistral, any model    | ✅ mxbai-embed-large, nomic-embed-text |
| Cohere    | ❌                               | ✅ embed-english-v3.0                  |
| Custom    | ✅ any function                  | ✅ any function                        |

---

## Prerequisites

- Node.js 18+
- Ollama (if using local models) → [ollama.com](https://ollama.com)

```bash
brew install ollama
ollama pull mxbai-embed-large
```

---

## Roadmap

- [x] SQLite storage
- [x] Hybrid BM25 + vector search
- [x] Raw chunk storage + dual retrieval
- [x] Model-agnostic LLM interface
- [x] Container isolation
- [x] TypeScript types
- [x] CLI setup wizard
- [x] Existing SQLite database support
- [x] Memory types — fact, preference, episode
- [x] Relationship detection — UPDATES, EXTENDS, DERIVES
- [x] Knowledge graph — getCurrent(), getHistory()
- [x] User profiles — getProfile()
- [x] Soft delete — forget()
- [x] filterPrompt + entityContext
- [ ] Reranking — optional cross-encoder for +67% retrieval accuracy
- [ ] Deep EXTENDS traversal — multi-hop graph at retrieval
- [ ] getTimeline() — temporal history with valid_from/valid_to
- [ ] MCP server — npx greymemory mcp
- [ ] greymemory Cloud
- [ ] Python SDK

---

## Built by

Arunkumar — building AI agents in public.

Follow the journey: [github.com/arun-dev-des](https://github.com/arun-dev-des)

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.