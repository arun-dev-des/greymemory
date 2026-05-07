# greymemory-viz

A visualization tool for the GreyMemory knowledge graph, built on the principle that **creators need an immediate connection to what they're creating** (Bret Victor, *Inventing on Principle*).

GreyMemory builds a rich graph — facts with version chains, EXTENDS refinements, DERIVES inferences, semantic clusters across embeddings, episodes that expire, preferences that strengthen. None of that is visible from the outside. You write `memory.add(...)` and `memory.search(...)` and trust the structure underneath.

This tool makes that structure visible. And queryable. And replayable.

## What it does

One canvas, four modes:

- **Explore** — pan, zoom, click any memory to see its fact, its source chunk, its version chain, its neighbors.
- **Debug retrieval** — type a query. Watch `search()` light up the graph: seeds bright, EXTENDS expansion in green, supersession history in dim purple. See the RRF score, BM25 vs vector contribution, and *why* each result was picked.
- **Showcase** — clean static render with physics settling, statistics, legend.
- **Time scrubber** — drag a slider over `document_date`. Watch the graph grow. Watch UPDATES dim old nodes as new ones replace them. Watch EXTENDS branches grow outward.

The search bar is always visible. You are never more than a keystroke away from seeing retrieval happen on the actual data.

## Architecture

```
greymemory-viz/
├── server/          Express API over GreyMemory's SQLite (Node, better-sqlite3)
└── client/          Vite + React + react-force-graph-2d
```

The server is a thin layer that imports your existing `Memory` and `Storage` classes — no data is duplicated, no schema is changed. The client renders a single canvas; modes are overlays on the same graph data.

## Drop-in setup

Assumes this folder lives next to your `greymemory` package:

```
my-project/
├── greymemory/             ← your existing repo
│   ├── src/
│   │   ├── memory.js
│   │   ├── storage.js
│   │   └── prompts.js
│   └── .greymemory/        ← the SQLite db
└── greymemory-viz/         ← this repo
    ├── server/
    └── client/
```

### 1. Install

```bash
cd greymemory-viz/server && npm install
cd ../client && npm install
```

### 2. Configure the data path

The server reads from your existing `.greymemory/greymemory.db`. Set the path in `server/.env` (or use the default below):

```
GREYMEMORY_DIR=../../greymemory/.greymemory
GREYMEMORY_CONTAINER=default
PORT=4000
```

If your `extractor` and `embedder` use API keys (for live retrieval debugging), the server needs them too:

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...        # or whichever embedding provider you use
```

### 3. Run

In two terminals:

```bash
# terminal 1
cd greymemory-viz/server && npm run dev

# terminal 2
cd greymemory-viz/client && npm run dev
```

Open the URL the client prints (typically `http://localhost:5173`).

## What gets visualized

| Element | Visual |
| --- | --- |
| Memory (latest) | Bright node, color by `memory_type` (fact / preference / episode) |
| Memory (older) | Dimmed node, lower opacity |
| Forgotten / expired | Crossed-out node |
| EXTENDS edge | Green line — semantic refinement chain |
| UPDATES edge | Purple line — supersession (with arrow, old → new) |
| DERIVES edge | Amber line — inferred conclusion from `runDerivations()` |
| Chunk | Square node, joined to the facts extracted from it |
| Document boundary | Faint cluster ring around all facts from one `add()` call |

Statistics panel mirrors the supermemory aesthetic: total memories, documents, connections, broken down by type and status.

## Design notes

- The canvas is a single `react-force-graph-2d` instance. Modes don't swap views — they swap *overlays* on the same simulation. This keeps node positions stable as you switch between modes; you build a mental map of *your* graph.
- The time scrubber works by querying facts where `document_date <= sliderValue` and re-rendering. It uses the same logic as `asOf` in `search()`, so what you see at slider position T is exactly what GreyMemory would have surfaced at that point in time.
- Live retrieval calls the real `search()` on the backend. There is no mock layer — what you see is what the system does.

## Status

This is a v0.1 — explore mode and debug-retrieval mode are working. Time scrubber and showcase polish in progress. See `ROADMAP.md` for what's next.
