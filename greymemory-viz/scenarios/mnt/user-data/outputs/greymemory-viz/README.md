# greymemory-viz

A visualization tool for the GreyMemory knowledge graph, built on the principle that **creators need an immediate connection to what they're creating** (Bret Victor, *Inventing on Principle*).

GreyMemory builds a rich graph — facts with version chains, EXTENDS refinements, DERIVES inferences, semantic clusters across embeddings, episodes that expire, preferences that strengthen. None of that is visible from the outside. You write `memory.add(...)` and `memory.search(...)` and trust the structure underneath.

This tool makes that structure visible. And queryable. And replayable. Across all your benchmark runs.

## What it does

One canvas, four modes, with dataset and container pickers in the header:

- **Explore** — pan, zoom, click any memory to see its fact, source chunk, version chain, neighbors.
- **Debug retrieval** — type a query. Watch `search()` light up the graph: seeds bright, EXTENDS expansion in green, supersession history in dim purple. Each result is clickable to jump to its node.
- **Showcase** — clean static render with physics settling, statistics, legend.
- **Time scrubber** — drag a slider over `document_date`. Watch the graph grow. Watch UPDATES dim old nodes as new ones replace them.

The dataset picker (top center) lists every `*-greymemory.db` file in your benchmark folder. The container picker shows every container inside the selected db, with fact counts. Switch either, and the graph reloads instantly — you keep your mode, your search bar, your aesthetic.

## Test scenarios

For when you want to debug behavior on small, readable data instead of dense benchmark runs, this repo includes three handcrafted scenarios in `scenarios/`:

- **01-updates** — singular attribute changes over time (Alex's job)
- **02-extends** — refinement chains where prior facts stay true (Sarah's location)
- **03-expires** — episodes that auto-expire (upcoming events)

Each one runs against your real extractor + embedder and produces a small, readable graph where you know exactly what *should* happen. Then you compare against what the viz actually shows.

```bash
cd scenarios
npm install
cp .env.example .env  # add ANTHROPIC_API_KEY and OPENAI_API_KEY
npm run all
```

Then point the server at the scenarios output (`GREYMEMORY_ROOT=../scenarios/.greymemory-scenarios` in `server/.env`) and switch between them in the dataset picker. See `scenarios/README.md` for what each scenario tests and what looking-wrong looks like.

## Architecture

```
greymemory-viz/
├── server/          Express API over your benchmark DB files (Node, better-sqlite3)
└── client/          Vite + React + react-force-graph-2d
```

The server discovers DB files at request time, caches handles, and routes each request to the right (db, container) pair. The client never holds a DB; it just sends `?dataset=ku&container=42` with every call.

## Setup

### 1. Folder layout

This works for any layout, but the default config assumes:

```
your-project/
├── benchmark/
│   └── .greymemory-bench/
│       ├── ku-greymemory.db
│       ├── ms-greymemory.db
│       └── ...
├── greymemory/                 ← your GreyMemory source
│   └── src/
│       ├── memory.js
│       ├── storage.js
│       └── prompts.js
└── greymemory-viz/             ← this repo, drop it here
```

Adjust `GREYMEMORY_ROOT` in `server/.env` if your DBs live elsewhere.

### 2. Install

```bash
cd greymemory-viz/server && npm install
cd ../client && npm install
```

### 3. Configure

```bash
cd greymemory-viz/server
cp .env.example .env
```

Edit `.env`:

```
GREYMEMORY_ROOT=../../benchmark/.greymemory-bench
PORT=4000

# Optional — only needed for the live debug-retrieval mode:
OPENAI_API_KEY=sk-...
EMBEDDING_MODEL=text-embedding-3-small
```

The server discovers `*-greymemory.db` files in `GREYMEMORY_ROOT` and reads each one's containers from the `facts` table. If you used a different naming convention, all `*.db` files matching `*-greymemory.db` are picked up — plain `greymemory.db` is also supported.

### 4. Run

Two terminals:

```bash
# terminal 1
cd greymemory-viz/server && npm run dev

# terminal 2
cd greymemory-viz/client && npm run dev
```

Open the URL Vite prints, usually `http://localhost:5173`.

## Using it

- **Top-left** — the brand mark.
- **Top-center** — dataset picker (ku, ms, ...) and container picker (1, 2, 3, ... with fact counts).
- **Top-right** — mode switcher.
- **Below brand** — search bar (`⌘K` to focus). Active in debug mode.
- **Bottom-right** — legend with stats and color key.
- **Bottom-center** — time scrubber, only in scrubber mode.
- **Bottom-left** — retrieval report, only in debug mode after a search.
- **Right side panel** — appears when you click a node, shows full fact detail with version history.

Switch datasets and watch the graph reshape itself. Switch containers and watch the structure of one question's memory state. Type a query in debug mode and watch which memories light up.

## What gets visualized

| Element | Visual |
| --- | --- |
| Memory (latest) | Bright node, color by `memory_type` (fact / preference / episode) |
| Memory (older) | Dimmed node, lower opacity |
| Forgotten / expired | Crossed-out node |
| EXTENDS edge | Green line — semantic refinement chain |
| UPDATES edge | Purple dashed line — supersession (with arrow, old → new) |
| DERIVES edge | Amber line — inferred conclusion from `runDerivations()` |
| Chunk | Cyan square, joined to the facts extracted from it |

## Caveats

- The server imports your `Memory` class from disk at first search call (per dataset). It looks for `memory.js` in standard locations near `GREYMEMORY_ROOT` and `greymemory-viz/`. If yours lives somewhere unusual, edit the `findMemoryModule` candidates in `server/datasets.js`.
- `Storage._migrate()` runs on first DB open. It's idempotent; it won't change a v0.3 schema. But because it can write, the server opens DBs in normal (writable) mode.
- Memory instances are cached per (dataset, container) — first switch is slow (LLM module import + embedder warmup), every subsequent switch is instant.

## Status

v0.2 — multi-dataset switching is working. See `ROADMAP.md` for what's next.
