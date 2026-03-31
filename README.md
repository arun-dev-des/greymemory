# greymemory 🧠

> Private, self-hosted memory for AI agents. Bring your own LLM. Your data never leaves your server.

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

## What's new in v0.2.3

- **Existing SQLite database support** — pass your own database connection. greymemory creates its tables inside your existing db. One file instead of two.

---

## What's in v0.2.0

- **Model-agnostic** — bring your own LLM and embedder. Works with Anthropic, OpenAI, Ollama, anything.
- **SQLite storage** — replaces flat JSON files. Concurrent writes, container isolation, timestamps, history preserved.
- **Hybrid search** — BM25 keyword search + vector semantic search fused via RRF. Nothing falls through the cracks.
- **Raw chunk storage** — every message stored alongside extracted facts. Details the LLM might miss are still searchable.
- **Container isolation** — separate memory namespaces for different users or projects.
- **TypeScript types** — full type safety and autocomplete in your editor.
- **CLI setup wizard** — `npx greymemory init` gets you running in 3 minutes.

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
? Do you want greymemory data stored in an existing SQLite database? No

✔ greymemory.config.js created
✔ .env updated
  .env added to .gitignore
✔ @anthropic-ai/sdk, dotenv installed

✦ Ready. Add to your project:
  import memory from './greymemory.config.js'
  await memory.add(messages)
  await memory.search('query')

⚠ Never commit .env to git. Your API keys are inside.
```

---

## Usage

```javascript
import memory from './greymemory.config.js'

// add a conversation — facts extracted + chunks stored automatically
await memory.add([
  { role: 'user',      content: 'My name is Arun and I train powerlifting' },
  { role: 'assistant', content: 'Got it.' }
])

// hybrid search — finds by meaning AND exact keywords
const results = await memory.search('what sport does this person train')
// [
//   { type: 'fact',  key: 'sport',   value: 'powerlifting',            sources: ['bm25', 'vector'] },
//   { type: 'chunk', key: 'chunk_1', value: 'user: My name is Arun...', sources: ['vector'] }
// ]

// inject into your agent
const facts   = memory.getFacts()
const context = results.map(r => r.value).join('\n')

const systemPrompt = `You are a helpful assistant.
What you know about this user: ${JSON.stringify(facts)}`
```

---

## Manual setup (without CLI)

If you prefer to wire it up yourself:

```bash
npm install greymemory dotenv
```

```javascript
import 'dotenv/config'
import GreyMemory from 'greymemory'
import Anthropic  from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const memory = new GreyMemory({
  extractor: async (messages) => {
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Extract facts as flat JSON. Keys: snake_case strings. Values: strings only.
Conversation: ${JSON.stringify(messages)}`
      }]
    })
    return JSON.parse(res.content[0].text.trim())
  },

  embedder: async (text) => {
    const res = await fetch('http://localhost:11434/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'mxbai-embed-large', prompt: text })
    })
    return (await res.json()).embedding
  }
})
```

---

## API

### `new GreyMemory(options)`

```typescript
new GreyMemory({
  extractor:  async (messages: Message[]) => Facts,  // required
  embedder:   async (text: string) => number[],      // required
  dir?:       string,    // storage directory, default: ".greymemory"
  container?: string,    // namespace isolation, default: "default"
  db?:        Database   // existing better-sqlite3 connection (optional)
})
```

### `await memory.add(messages)`

Extracts facts, stores raw chunks, generates embeddings. All three happen automatically.

```javascript
await memory.add([
  { role: 'user',      content: 'I met Priya at the Bangalore AI meetup' },
  { role: 'assistant', content: 'Got it.' }
])
```

### `await memory.search(query, topN?)`

Hybrid BM25 + vector search across facts and chunks. Default topN = 5.

```javascript
const results = await memory.search('Priya hiring')
// [
//   { type: 'fact',  key: 'person',  value: 'Priya',               sources: ['bm25', 'vector'] },
//   { type: 'chunk', key: 'chunk_1', value: 'user: I met Priya...', sources: ['bm25'] }
// ]
```

### `memory.getFacts()`

Returns all extracted facts for this container.

```javascript
memory.getFacts()
// { name: 'Arun', sport: 'powerlifting', gym_location: 'Bangalore' }
```

### `memory.clear()`

Deletes all facts, chunks and embeddings for this container. Other containers untouched.

```javascript
memory.clear()
```

---

## Using an existing SQLite database

If your project already uses SQLite, greymemory can store its data inside your existing database file. No second file.

This is useful when integrating greymemory into an existing tool — like [DevLog](https://devlog-web-black.vercel.app/), which already stores engineering journals in SQLite.

### Via CLI

```
? Do you want greymemory data stored in an existing SQLite database? Yes
? Path to existing SQLite database: /home/user/.devlog/devlog.db
```

The generated `greymemory.config.js` will include the database connection automatically.

### Via code

```javascript
import Database   from 'better-sqlite3'
import GreyMemory from 'greymemory'

// your existing database
const db = new Database('/home/user/.devlog/devlog.db')

const memory = new GreyMemory({
  extractor,
  embedder,
  db,                    // greymemory creates its tables inside this db
  container: 'memory'
})
```

greymemory creates its own tables (`facts`, `embeddings`, `chunks`, etc.) inside your existing database. Your existing tables are untouched.

---

## Container isolation

Use different containers to isolate memory between users or projects:

```javascript
const userA = new GreyMemory({ container: 'user-123', ...options })
const userB = new GreyMemory({ container: 'user-456', ...options })

// each container has its own facts, chunks and embeddings
// clearing one never touches the other
```

---

## How it works

```
Conversation
    ↓
extractor()          → extracts facts → saved to SQLite facts table
    ↓
Each message         → saved to SQLite chunks table
    ↓
embedder()           → embeds facts and chunks → saved to SQLite

Query
    ↓
BM25 search          → exact keyword match on facts + chunks
Vector search        → semantic similarity on facts + chunks
    ↓
RRF fusion           → combines both rankings
    ↓
Top N results returned (type: fact | chunk)
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
# install Ollama on Mac
brew install ollama

# pull embedding model
ollama pull mxbai-embed-large
```

---

## Roadmap

- [x] SQLite storage
- [x] Hybrid BM25 + vector search
- [x] Raw chunk storage
- [x] Model-agnostic LLM interface
- [x] Container isolation
- [x] TypeScript types
- [x] CLI setup wizard
- [x] Existing SQLite database support
- [ ] Temporal facts — current truth always returned, history preserved
- [ ] Contradiction resolution — UPDATES, EXTENDS, DERIVES relationships
- [ ] User profiles — static + dynamic, ready for system prompt injection
- [ ] MCP server — works in Claude Code, Cursor, any agent tool
- [ ] greymemory Cloud — managed hosting
- [ ] Python SDK

---

## Built by

Arunkumar — building AI agents in public.

Follow the journey: [github.com/arun-dev-des](https://github.com/arun-dev-des)

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.
