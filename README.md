# greymemory 🧠

> Self-hosted memory for AI agents. Extracts facts, detects contradictions, builds user profiles. Bring your own LLM. Your data never leaves your server.

**[▶ Live demo — greymemory.vercel.app](https://greymemory.vercel.app)** — the full story with interactive exhibits, ending in a real LongMemEval memory graph served live from SQLite: hover to read memories, click to light a retrieval neighborhood, and run a one-click `memory.search()` against the live database. ([npm](https://www.npmjs.com/package/greymemory) · [llms.txt](https://greymemory.vercel.app/llms.txt))

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

## Benchmark results

Tested against [LongMemEval](https://arxiv.org/abs/2410.10813) — the standard benchmark for long-term memory systems. 90 questions across 6 categories, compared against [Supermemory](https://supermemory.ai) (funded startup, cloud infrastructure).

| Category | greymemory | Supermemory | Gap |
|---|---|---|---|
| single-session-user | **93.3%** | 97.1% | -3.8% |
| single-session-assistant | **93.3%** | 96.4% | -3.1% |
| knowledge-update | **80.0%** | 88.5% | -8.5% |
| temporal-reasoning | **73.3%** | 76.7% | -3.4% |
| single-session-preference | **66.7%** | 70.0% | -3.3% |
| multi-session | **66.7%** | 71.4% | -4.7% |
| **Overall** | **80.0%** | **83.4%** | **-3.4%** |

96% of a funded startup's accuracy. Zero cloud dependency. $0.013 per session ingestion cost. SQLite on your own machine.

---

## One repo, three packages

- **`greymemory`** (this package) — the full memory engine. Contradictions are resolved at **write time**: an LLM classifier detects `UPDATES` / `EXTENDS` relationships, supersedes stale facts, and keeps full version history for time-travel queries, profiles, and derivations.
- **[`greymemory-lite`](greymemory-lite/README.md)** — the [LongMemEval](https://arxiv.org/abs/2410.10813) paper's recommended design and *nothing else*: ~1,600 lines, one dependency (`better-sqlite3`), zero LLM calls at read time. Contradictions are resolved at **read time** — results arrive chronologically sorted and a Chain-of-Note reading prompt tells the answering model that the latest same-topic item wins. Pick it when you want the simplest design that benchmarks in the same band as far heavier systems.
- **[`claude-greymemory`](claude-greymemory/README.md)** — a Claude Code plugin (in progress) that gives Claude persistent, self-hosted memory: hooks capture every conversation into a per-project greymemory database and inject relevant memories back at session start, plus an MCP server (`grey_search` / `grey_add` / `grey_profile`) and `/grey-search`, `/grey-save`, `/grey-forget` slash commands.

The two libraries' databases are **not** interchangeable — lite refuses to open a database it didn't create. See the [feature comparison](greymemory-lite/README.md#how-lite-differs-from-greymemory) in the lite README.

---

## What's new in v0.4

- **Benchmarked** — LongMemEval integration with reproducible benchmark runner. 6 categories, 15 questions each, automated scoring.
- **Temporal reasoning** — pre-computed timeline injection extracts `event_date` values, sorts chronologically, and injects into the answering context. Improved temporal-reasoning by 13.3% (60% → 73.3%).
- **State change detection** — new extraction rule catches casual mid-sentence updates to quantities, frequencies, locations, and durations that were previously missed.
- **Chunk date fix** — chunks now store the session's `document_date` instead of the ingestion timestamp. Critical for temporal queries and asOf time-travel.
- **asOf time-travel** — `memory.search()` accepts an `asOf` parameter to query memory state at any point in time. End-of-day rounding ensures same-day sessions are visible.
- **Source provenance** — every memory tracks `source_role` (user vs assistant) as a first-class field. Enables filtering by who said what.
- **Batch embedder** — batches multiple embedding calls within a time window for efficient API usage.
- **Retry with backoff** — exponential backoff for rate-limited API calls.

---

## Visualize your memory graph

![greymemory's memory graph — 218 memories from a LongMemEval run, showing fact/preference/episode nodes linked by EXTENDS, UPDATES, and source-chunk edges](assets/memory-graph.png)

The bundled **greymemory-console** renders your memory graph live over the same SQLite — nodes coloured by type (fact / preference / episode / raw chunk), edges by relation (`EXTENDS`, `UPDATES`, `DERIVES`, source-chunk), plus a time scrubber and live hybrid search. The capture above is a real 218-memory container from a LongMemEval run.

A hosted instance runs at **[greymemory.vercel.app](https://greymemory.vercel.app)** (static client on Vercel, graph API + SQLite on Railway, serving four real LongMemEval users), or run it locally over your own database:

```bash
cd greymemory-console && npm run install:all && npm run dev
#   → http://localhost:5173
```

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
//     relation_type: null,
//     source_role:   'user'
//   }
// ]

// time-travel — query memory state at a specific date
const pastResults = await memory.search('where does Arun work', {
  asOf: '2026-01-15'
})

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
      max_tokens: 4096,
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

### `await memory.add(input, options?)`

Extracts memories, detects relationships, stores chunks with provenance.

```javascript
// conversation
await memory.add([
  { role: 'user',      content: 'I now work at Stripe as a PM' },
  { role: 'assistant', content: 'Congratulations!' }
])

// plain text
await memory.add('Arun is building greymemory, an open source memory library.')

// with date (for historical data ingestion)
await memory.add(messages, { date: '2026-01-15T10:30' })
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
  asOf:        '2026-04-15',  // time-travel to this date
})
```

**Search options:**

| Option           | Type       | Default | Description |
|------------------|------------|---------|-------------|
| `topN`           | `number`   | `5`     | Number of results |
| `memoryTypes`    | `string[]` | `null`  | Filter by type: `fact`, `preference`, `episode` |
| `afterDate`      | `string`   | `null`  | Filter by event_date >= date |
| `beforeDate`     | `string`   | `null`  | Filter by event_date <= date |
| `asOf`           | `string`   | `null`  | Time-travel: only return facts that existed at this date |
| `includeHistory` | `boolean`  | `false` | Include superseded facts |
| `includeExpired` | `boolean`  | `false` | Include expired episodes |
| `expandViaGraph` | `boolean`  | `true`  | Follow `EXTENDS` edges and supersession chains from seed results |
| `expandDepth`    | `number`   | `5`     | Max `EXTENDS` hops to walk during expansion |
| `expandedLimit`  | `number`   | `10`    | Max additional facts added by graph expansion |
| `timeAwareQuery` | `boolean`  | `true`  | Auto-extract a date range from the query (one extractor call) |
| `rerank`         | `boolean`  | `false` | LLM-as-reranker over the candidate pool (one extractor call) |
| `reranker`       | `function` | `null`  | Pluggable reranker `(query, texts[]) => orderedIndices[]`; overrides the LLM path |
| `multiQuery`     | `boolean \| number` | `false` | Expand the query into N paraphrases and union candidates (`true` → 3) |
| `adaptiveAggregation` | `boolean` | `false` | Raise effective topN for count/aggregation questions ("how many", "total"…) |
| `maxPerSession`  | `number`   | `null`  | Demote results beyond N per session, protecting multi-session diversity |
| `candidatePool`  | `number`   | `null`  | Candidates fetched before filtering/rerank (default `max(topN*4, 40)`) |

---

### `await memory.getProfile(options?)`

Returns static/dynamic user profile for system prompt injection.

```javascript
// profile only
const { profile } = await memory.getProfile()
// profile.static  → ['Arun prefers TypeScript', 'Arun works at Stripe']
// profile.dynamic → ['Arun is building greymemory v0.4']

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

## Cost

| Component | Cost per session | Monthly (1 session/day) |
|---|---|---|
| Extraction (Haiku) | ~$0.008 | ~$0.24 |
| Embedding (Voyage) | ~$0.004 | ~$0.12 |
| Embedding (Ollama) | free | free |
| **Total (cloud embeddings)** | **~$0.013** | **~$0.39** |
| **Total (local embeddings)** | **~$0.008** | **~$0.24** |

Query cost: ~$0.001 per search (embedding only). Storage: SQLite, zero cost.

---

## Architecture

```
Conversation
    ↓
Save chunks — one per message, with embeddings + source_role
    ↓
extractor()
  Resolves ambiguity → classifies memory type → extracts atomic memories
  STATE CHANGE RULE: captures casual mid-sentence updates
    ↓
For each memory:
  _detectRelationship()    → UPDATES | EXTENDS | NEW
  saveFact()               → stored with chunk_id, relation_type, event_date
  supersedeFact()          → if UPDATES, marks old fact is_latest=0
  saveEmbedding()          → each fact version gets its own embedding
    ↓
Optional: runDerivations() → second-order inferences stored as DERIVES

Query
    ↓
BM25 search + vector search (facts + chunks)
RRF fusion with confidence weighting
asOf filtering for time-travel queries
For each result: fetch source chunk via chunk_id
    ↓
{ memory, chunk, memory_type, confidence, source_role, document_date, event_date, ... }
```

---

## Supported providers

| Provider  | Extractor                        | Embedder                               |
|-----------|----------------------------------|----------------------------------------|
| Anthropic | ✅ Claude Haiku, Sonnet, Opus    | ❌                                     |
| OpenAI    | ✅ GPT-4o-mini, GPT-4o           | ✅ text-embedding-3-small/large        |
| Voyage    | ❌                               | ✅ voyage-3, voyage-3-lite             |
| Ollama    | ✅ llama3, mistral, any model    | ✅ mxbai-embed-large, nomic-embed-text |
| Cohere    | ❌                               | ✅ embed-english-v3.0                  |
| Custom    | ✅ any function                  | ✅ any function                        |

---

## Migrating from v0.3.x

greymemory v0.4 is backward compatible with v0.3. No breaking changes.

New features (asOf, source_role, batch embedder) work automatically on existing databases. The `source_role` column is added via automatic migration on first use.

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
- [x] Source provenance — source_role tracking
- [x] Temporal reasoning — event_date extraction + timeline
- [x] asOf time-travel queries
- [x] Batch embedder
- [x] LongMemEval benchmark (80.0% vs Supermemory 83.4%)
- [x] Graph traversal — search expands seeds through `EXTENDS` edges and supersession chains
- [x] Reranking — LLM-as-reranker (`rerank`) or pluggable `reranker` fn, plus adaptive topN for aggregation questions
- [x] Multi-query expansion — LLM paraphrases unioned by best RRF score (`multiQuery`)
- [x] Episode expiration — extractor-set `expires_at`, enforced in search and profile (`includeExpired` to override)
- [x] greymemory-lite — standalone paper-faithful core package
- [x] Claude Code plugin — claude-greymemory (capture/inject hooks, MCP server, slash commands)
- [ ] Memory graph — fact_relations table with `SIMILAR_TO` / `SIBLING` edges + sibling expansion
- [ ] 3-layer context — static profile + dynamic profile + reranked search results in one call
- [ ] Question-type-aware boosts — boost preferences/temporal/current-state by question type
- [ ] Query decomposition — split compound "A or B?" queries
- [ ] Configurable TTL per memory type
- [ ] Standalone MCP server — `npx greymemory-mcp` for Cursor, Windsurf (Claude Code is covered by the plugin)
- [ ] Fine-tuned extraction model — local 7B model, zero API dependency
- [ ] Community detection — topic clustering in memory graph
- [ ] Python SDK

---

## Built by

Arunkumar — building AI agents in public.

Follow the journey: [github.com/arun-dev-des](https://github.com/arun-dev-des)

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.