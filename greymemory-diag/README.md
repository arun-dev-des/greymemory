# greymemory-diag

A diagnostic UI for greymemory: navigate any benchmark run question-by-question, see exactly why each one failed, and inspect any container's live state without dropping into SQLite.

Complementary to [`greymemory-viz`](../greymemory-viz/). Viz shows you *the shape of the graph*; diag shows you *the forensic story of a benchmark question*. Both can run side by side.

## What it shows

Two top-level tabs.

### Runs

For each `benchmark/results/run-*.json` on disk: list of runs → category breakdown → filterable question table → per-question forensic deep-dive.

The **per-question screen** is the payoff. Four panels:

- **Header** — question, expected, got, verdict, `failure_reason` label (`retrieval` / `answering` / `extraction` / `unknown`).
- **Retrieval** — the full ranked list of retrieved items, **gold sessions highlighted**. Each row shows session_id, document_date, event_date, relation_type. R@5/R@10/N@5/N@10 badges. Empty-memory chunks (chunk hits with no atomic fact) are flagged explicitly — they're a known extraction gap.
- **Relationship log** — every `_detectRelationship` decision the ingestion made for this question's container, joined from `relationship-decisions-*.jsonl` by `question_id`. Filterable by `UPDATES` / `EXTENDS` / `NEW` and by reason. Click a row to see the full candidate list + the raw LLM response. This is what makes Task 5.2 (KU diagnosis) tractable.
- **Tokens & cost** — per-phase breakdown (extraction / relationship / contextualization / derivation / time_extraction / answering / judging).

### DB Browser

Pick any `benchmark/.greymemory-bench*/*.db` → pick container → see all current facts (`is_latest=1`), with chain-length badges for ones that have version history. Click a fact to expand its full chain. Type a query in the search box → live hybrid BM25+vector results via the real `Memory.search()`.

## Architecture

```
greymemory-diag/
├── server/    Express + better-sqlite3. Port 4001.
│   ├── runs.js           ── filesystem walk of run-*.json + JSONL streaming
│   ├── databases.js      ── DB enumeration, facts, version chains (raw SQL)
│   └── memory-loader.js  ── lazy Memory.search instantiation for live search
└── client/    Vite + React + hash routing. Port 5174.
```

The server reads benchmark output files directly — no schema changes, no separate DB. Live search lazy-loads the user's `Memory` class from `../../src/memory.js` and embeds queries with Voyage (mirrors the benchmark) or OpenAI as fallback.

## Run

```bash
# terminal 1 — server (defaults to port 4001)
cd greymemory-diag/server && npm install && npm run dev

# terminal 2 — client (Vite, port 5174)
cd greymemory-diag/client && npm install && npm run dev
```

Open <http://localhost:5174>. Live search needs `VOYAGE_API_KEY` (preferred — matches benchmark ingestion embeddings) or `OPENAI_API_KEY` (fallback — only correct if the DB was ingested with the same embedder); the server reads `.env` from the repo root automatically.

## Side by side with greymemory-viz

| | port (server) | port (client) |
|---|---|---|
| greymemory-viz | 4000 | 5173 |
| greymemory-diag | 4001 | 5174 |

Both can be open simultaneously and pointed at the same DB.

## Endpoints

```
GET  /api/runs                                          # list run-*.json summaries
GET  /api/runs/:id                                      # full run JSON
GET  /api/runs/:id/questions/:qid                       # question + matching JSONL entries (the killer endpoint)
GET  /api/dbs                                           # list .greymemory-bench*/*.db + containers
GET  /api/dbs/:dbId/containers/:c/facts                 # current facts
GET  /api/dbs/:dbId/containers/:c/facts/:id/history     # version chain
GET  /api/dbs/:dbId/chunks/:cid                         # raw chunk text
POST /api/dbs/:dbId/containers/:c/search                # live hybrid search { query, topN? }
GET  /api/health
```

`dbId` URL-encodes the slash as `%2F` (e.g. `.greymemory-bench-task5-smoke%2Fgreymemory.db`).
