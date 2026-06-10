# greymemory-lite

> The genuinely valuable, genuinely simple core: **SQLite + FTS5/BM25 + vector cosine + RRF fusion, with bring-your-own-LLM extraction. Self-hosted — no data leaves the box.**

A memory layer for AI agents that implements the [LongMemEval](https://arxiv.org/abs/2410.10813) paper's recommended design — and nothing else. One dependency (`better-sqlite3`), one LLM call per conversation round at write time, zero LLM calls at read time.

## Architecture (paper-faithful)

| Stage | What happens | Paper basis |
|---|---|---|
| Indexing | One chunk = one conversation **round** (user turn + assistant reply); facts extracted per round with exact provenance | CP1, §5.2 |
| Indexing | Chunks embedded as **K = V + fact** (user text merged with that round's facts) | CP2, §5.3 — the paper's largest indexing win |
| Retrieval | Hybrid **BM25 + vector cosine**, fused with **RRF** (k=60), over both facts and raw chunks | — |
| Reading | `formatForReading()` builds a **JSON + Chain-of-Note** prompt over chronologically-sorted results | CP4, §5.5 — up to +10 accuracy points |

**There is no supersession/relationship machinery, no knowledge graph, no query-time LLM calls — deliberately.** Contradictions ("I work at Google" → "I now work at Stripe") are resolved by the *reader*: results carry timestamps, arrive chronologically sorted, and the Chain-of-Note prompt instructs the model that among same-topic items the latest is the current state. This is the paper's design, and it benchmarks in the same band as far heavier systems.

## Install

```bash
npm install greymemory-lite
```

## Usage

```javascript
import Memory, { formatForReading, parseReadingAnswer } from "greymemory-lite";

const memory = new Memory({
  // bring your own LLM — any provider, any model
  extractor: async (prompt) => callYourLLM(prompt),       // returns raw text
  embedder:  async (text)   => embedWithAnything(text),   // returns number[]
});

// write: chunks persist first, then 1 extraction LLM call per round
await memory.add([
  { role: "user", content: "I train at Barbell Cartel in Bangalore" },
  { role: "assistant", content: "Noted!" },
], { date: "2026-05-01", sessionId: "s1", dedupBySession: true });

// read: 1 embedder call, 0 LLM calls
const results = await memory.search("where does Arun train", { topN: 10 });
// [{ memory, chunk, memory_type, document_date, event_date, source_role, session_id }]

// answer: the reading prompt is where contradictions get resolved
const prompt = formatForReading({ question, questionDate: "2026-06-10", results });
const answer = parseReadingAnswer(await callYourLLM(prompt));
```

## API

| Method | Cost | Description |
|---|---|---|
| `add(input, {date?, sessionId?, dedupBySession?})` | 1 LLM call/round + embeddings | Ingest a conversation or raw text. Chunks always persist before extraction — a failed extraction never loses the raw conversation. |
| `search(query, {topN?, memoryTypes?, afterDate?, beforeDate?, asOf?})` | 1 embedder call | Hybrid BM25+vector+RRF. `asOf` hides anything recorded after that date. |
| `getProfile({q?, topN?, asOf?})` | 0 (plus search if `q`) | `{ static, dynamic }` lists, injection-ready for system prompts. |
| `getMemories()` | 0 | Every stored memory as full rows — see exactly what is stored. |
| `forget(query)` | 1 embedder call | Soft-delete the closest match. Row preserved for audit. |
| `clear()` | 0 | Wipe this container. |

Helpers: `formatForReading(opts)`, `parseReadingAnswer(text)`, `buildExtractorPrompt(opts)`, `EXTRACTOR_STATIC_PREFIX` (for provider prompt caching), `createBatchEmbedder(batchFn)`.

### Constructor

```javascript
new Memory({
  extractor,            // required: async (prompt, {phase}) => string
  embedder,             // required: async (text, {phase})   => number[]
  dir: ".greymemory-lite",  // storage directory
  container: "default",     // namespace isolation (multi-tenant in one file)
  db,                       // or: an existing better-sqlite3 connection
  extractorPrompt,          // optional custom prompt builder — THE customization seam
})
```

There is no `filterPrompt`/`entityContext` — if you need domain filtering or persona context, supply your own `extractorPrompt` builder (it receives `{input, existingFacts, documentDate, entityContext}` and must instruct the model to emit the JSON memory array).

## How lite differs from `greymemory`

| | greymemory (full) | greymemory-lite |
|---|---|---|
| Extraction | per session or per round | per round only |
| Contradictions | LLM relationship classifier + supersession at ingest | resolved by the reader (chronological CoN) |
| Query-time LLM calls | up to 3 (time-aware query, rerank, multi-query) | **0** |
| Knowledge graph / derivations / profiles history | yes | no |
| Vector storage | JSON text | Float32 BLOBs (~3× smaller, no parse) |
| Schema migrations | automatic in-place | none — fresh databases only (old DBs fail loudly) |
| Lines of library code | ~5,600 | ~1,600 |

Databases are **not** interchangeable between the two packages. Lite refuses to open a database it didn't create.

## Operational notes

- **WAL + busy_timeout are set automatically** — multiple processes (hooks, MCP servers) can share one memory DB.
- Ingestion is sequential and costs one extraction call per round (~$0.01 per long session on a Haiku-class model). Run it off the hot path; `dedupBySession` makes re-ingestion idempotent.
- `topN` should scale with your answering model: ~5 for small local models, 10–25 for GPT-4o/Claude-class readers (LongMemEval §5.2).
- Dates: pass ISO-ish strings (`"2026-06-10"`, `"2023/05/20 (Sat) 02:21"`) or `Date` objects. Anything else falls back to today.

## License

Apache-2.0
