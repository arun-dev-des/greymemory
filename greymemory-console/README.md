# greymemory-console

One console for inspecting greymemory, built on the principle that **creators need an immediate connection to what they're creating** (Bret Victor, *Inventing on Principle*). It merges the former `greymemory-viz` and `greymemory-diag` tools into a single app: one Express server, one Vite client, a left sidebar that switches between two surfaces.

```
┌──────────────┬───────────────────────────────────────────────┐
│  greymemory  │                                               │
│              │   Visualizer  →  the shape of the graph        │
│ ▸ Visualizer │   Diagnostics →  the forensics of a benchmark  │
│   Diagnostics│                                               │
└──────────────┴───────────────────────────────────────────────┘
```

## Surfaces

### Visualizer — the shape of the graph
One canvas, four modes over greymemory's SQLite:

- **Explore** — pan, zoom, click any memory to see its fact, source chunk, version chain, and neighbors.
- **Debug retrieval** — type a query; watch `search()` light up the graph (seeds bright, EXTENDS expansion green, supersession history dim purple), with RRF / BM25 / vector contributions.
- **Showcase** — clean static render with physics settling, stats, legend.
- **Time scrubber** — drag over `document_date` to replay the graph's growth as UPDATES dim old nodes and EXTENDS branches grow.

### Diagnostics — the forensics of one benchmark question
Reads `benchmark/results/run-*.json` + the `relationship-decisions-*.jsonl` logs, and runs live `search()` over any `benchmark/.greymemory-bench*/*.db`:

- **Runs** — every benchmark run with accuracy, Recall@k / NDCG@k, failure-reason breakdown, per-question verdicts, and an on-demand Claude analysis of any question.
- **DB Browser** — browse facts per container, follow version chains, and run live hybrid search against a chosen DB.

Both surfaces import the library's `Memory` / `Storage` classes directly — no data is duplicated and no schema is changed.

## Architecture

```
greymemory-console/
├── server/                 One Express app on :4000
│   ├── index.js            Repo-root-anchored path resolution; mounts both routers
│   ├── viz/                /api/viz/*   — routes.js + datasets.js + graph.js
│   └── diag/               /api/diag/*  — routes.js + runs.js + databases.js + memory-loader.js + analyze.js
└── client/                 One Vite + React app on :5173
    └── src/
        ├── App.jsx         Sidebar shell + top-level hash router
        ├── shell.css       Sidebar/layout + the one shared reset
        ├── viz/            VizSurface + components + styles (scoped under .surface-viz)
        └── diag/           DiagSurface + pages + components + styles (scoped under .surface-diag)
```

The two route groups are namespaced (`/api/viz/*`, `/api/diag/*`) so their endpoints never collide. Each surface's stylesheet is scoped under a `.surface-viz` / `.surface-diag` wrapper so the two themes don't leak into each other. Only the active surface is mounted, so the force-graph canvas is never running while you're on Diagnostics.

The scenario-DB generator the Visualizer reads from lives separately at [`../greymemory-viz/scenarios/`](../greymemory-viz/scenarios/).

## Setup

```bash
cd greymemory-console
npm run install:all      # installs server + client deps
npm run dev              # server :4000 + client :5173 via concurrently
```

Open <http://localhost:5173>. It opens on the Visualizer (`#/viz`); the sidebar switches to Diagnostics (`#/diag`).

### Configuration

The server loads the **repo-root `.env`** (where `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `VOYAGE_API_KEY` already live). Everything else has working defaults; see [`server/.env.example`](server/.env.example). Notable optional overrides:

| Var | Surface | Default | Purpose |
|---|---|---|---|
| `PORT` | both | `4000` | unified API port |
| `GREYMEMORY_ROOT` | Visualizer | `greymemory-viz/scenarios/.greymemory-scenarios` | dir of `*-greymemory.db` to graph (resolved from repo root) |
| `GREYMEMORY_DIAG_ROOT` | Diagnostics | repo root | where to scan `benchmark/results` + `benchmark/.greymemory-bench*` |
| `OPENAI_API_KEY` | Visualizer | — | enables live graph search |

> Note: `GREYMEMORY_ROOT` (Visualizer data dir) and `GREYMEMORY_DIAG_ROOT` (Diagnostics repo root) are **distinct** variables on purpose — they mean different things.

### Build

```bash
npm run build            # builds the client to client/dist
npm run start            # runs the server only (serve client/dist behind your own static host)
```
