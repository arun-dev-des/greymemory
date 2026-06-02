# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

greymemory is a self-hosted memory layer for AI agents. It extracts atomic memories from conversations, detects contradictions, and exposes them through hybrid search — all on SQLite, with user-supplied LLM and embedder functions ("bring your own LLM"). The library is ESM-only (`"type": "module"`), Node 18+, and the public entry point is `src/index.js`.

## Repository layout

- [src/](src/) — the library. Self-contained, no build step.
  - [src/memory.js](src/memory.js) — `Memory` class, the main orchestrator. Owns `add()`, `search()`, `getProfile()`, `getCurrent()`, `getHistory()`, `forget()`, `runDerivations()`. Contains relationship classification (`_detectRelationship`), graph expansion (`_expandViaExtends`, `_expandViaSupersessionHistory`), preference strengthening, and the extraction-parsing logic. Date normalisation lives here too (`_normalizeDate`).
  - [src/storage.js](src/storage.js) — `Storage` class wrapping `better-sqlite3`. Owns the schema, all FTS5 triggers, the hybrid BM25 + vector search (`hybridSearch`), the v0.2 → v0.3 in-place migration (`_migrate`), and `saveFact` / `saveChunk` / `supersedeFact`.
  - [src/prompts.js](src/prompts.js) — `buildExtractorPrompt`. The single source of truth for what the extractor LLM is asked to do (self-containment test, STATE CHANGE RULE, memory-type classification, source_message_index).
  - [src/answering.js](src/answering.js) — answerer-prompt builders consumed by the benchmark and exported for downstream apps. `formatForReadingV2` is the current default (CP4 / Chain-of-Note v2: topic anchors, 3-tier scoring, self-check); `formatForReading` is the v1 JSON + Chain-of-Note prompt; `formatRetrievedContext` formats raw results; `buildAnsweringPrompt` is the **deprecated** pre-CoN prose builder, kept only for regression comparison. All four are re-exported from `src/index.js`.
  - [src/batch-embedder.js](src/batch-embedder.js) — `createBatchEmbedder`. Wraps a batch embedding API into a single-text embedder, collecting calls within a time window.
  - [src/index.js](src/index.js) / [src/index.d.ts](src/index.d.ts) — default + named exports (`Memory` plus the four `answering.js` helpers) and the full TypeScript surface.
- [bin/](bin/) — CLI. `init.js` is the setup wizard (`npx greymemory init`); `migrate.js` is the v0.2 → v0.3 standalone migrator (`npx greymemory-migrate`). Both are registered in [package.json](package.json) under `bin`.
- [example/basic.js](example/basic.js) — end-to-end demo touching every public method. Run this to sanity-check changes to `Memory`.
- [benchmark/](benchmark/) — LongMemEval runner. [benchmark/run.js](benchmark/run.js) is the main entry; flags at the top of the file (`LIMIT`, `PER_CATEGORY`, `CATEGORY_FILTER`, `SKIP_INGEST`, `TIME_AWARE_QUERY`, `READING_MODE`, `CON_PROMPT_VERSION`, `JUDGE_DUAL`) gate behaviour — there are no CLI args, you edit the constants. [benchmark/judge-prompts.js](benchmark/judge-prompts.js) is the LongMemEval official LLM-as-judge prompt + verdict parser. Each run writes `benchmark/results/run-*.json` and a `relationship-decisions-*.jsonl` classifier log; the ingestion DBs are the `benchmark/.greymemory-bench*/` dirs. Everything under `benchmark/results/`, `benchmark/data/`, and `benchmark/.greymemory-bench*/` is git-ignored. The benchmark vocabulary (CP1–CP4) comes from `greymemory-longmemeval-implementation-plan.md` — see the benchmark architecture note below.
- [test files/](test%20files/) — manual integration scripts run individually, e.g. `node "test files/test-v03-week5.js"`. The `test-v03-*.js` / `test-v3-*.js` ones are git-ignored; the newer `test-task-N-cpN-*.js` ones (matching the benchmark's CP work) are **not** ignored and are tracked.
- [greymemory-console/](greymemory-console/) — the single inspection console (merger of the former `greymemory-viz` + `greymemory-diag`). One Express server (`server/`, port **4000**) mounting two namespaced route groups, and one Vite + React client (`client/`, port **5173**) whose left sidebar switches between two surfaces. Both reuse the library's `Memory` / `Storage` classes — no data duplication or schema changes.
  - **Visualizer surface** (`/api/viz/*` ← `server/viz/`; `client/src/viz/`) — Vite + React + react-force-graph-2d over the same SQLite. Shows the *shape of the graph*. Live graph search needs `OPENAI_API_KEY`. Default data dir = `greymemory-viz/scenarios/.greymemory-scenarios` (override via `GREYMEMORY_ROOT`).
  - **Diagnostics surface** (`/api/diag/*` ← `server/diag/`; `client/src/diag/`) — reads `benchmark/results/run-*.json` and the `relationship-decisions-*.jsonl` logs directly, and runs live `Memory.search()` over any `benchmark/.greymemory-bench*/*.db`. Shows the *forensic story of one benchmark question*: Recall@k/NDCG@k vs gold sessions, every `_detectRelationship` decision, per-phase token/cost breakdown, and a Claude-powered analysis (`ANTHROPIC_API_KEY`). Scans the repo root by default (override via `GREYMEMORY_DIAG_ROOT` — a **distinct** var from the Visualizer's `GREYMEMORY_ROOT`). See [greymemory-console/README.md](greymemory-console/README.md).
- [greymemory-viz/scenarios/](greymemory-viz/scenarios/) — standalone scenario-DB generator (handcrafted reproducible cases) with its own `node_modules`. Independent of the console; the Visualizer surface reads the `.greymemory-scenarios/*.db` files it produces.

## Common commands

```bash
# Library install (consumer side)
npm install

# CLI setup wizard — generates greymemory.config.js + .env
npx greymemory init

# Migrate an older (v0.2.x) DB to v0.3 — idempotent
npx greymemory-migrate --dir .greymemory

# Run the end-to-end example (needs ANTHROPIC_API_KEY + Ollama running locally)
node example/basic.js

# Run the benchmark — edit flags at the top of run.js first
node benchmark/run.js

# Inspection console — Visualizer + Diagnostics, one server (4000) + one client (5173)
cd greymemory-console && npm run install:all && npm run dev   # both via concurrently
#   → http://localhost:5173  (opens on #/viz; sidebar switches to #/diag)

# Regenerate the Visualizer's scenario DBs (independent sub-package)
cd greymemory-viz/scenarios && npm install && npm run all
```

There is no test framework, no lint script, and no build step. Type-checking is available via `tsc --noEmit` (config in [tsconfig.json](tsconfig.json) — `allowJs: true`, `noEmit: true`, includes `src` and `test-types.ts`).

## Architecture notes that span files

**Ingestion pipeline (`memory.add`)**. Chunks are always persisted first, before extraction runs, so a failed/empty extraction still leaves the raw conversation queryable. Each message becomes one row in `chunks` + one row in `chunk_embeddings`. Only then does the extractor run; extracted memories get embedded, deduped within the batch (cosine > 0.92), classified by relationship, and saved to `facts` + `embeddings`. After every `add()`, `entityContext` is automatically updated from the accumulated profile — reference resolution improves across sessions.

**Hybrid search (`storage.hybridSearch` + `memory.search`)**. SQLite FTS5 supplies BM25; vectors are loaded from the `embeddings` / `chunk_embeddings` tables and scored with cosine similarity. Results are fused with reciprocal rank fusion, then `memory.search` applies filters (`memoryTypes`, `afterDate`, `beforeDate`, `asOf`, `includeHistory`, `includeExpired`), slices to `topN` seeds, and then runs **graph expansion**: forward through `EXTENDS` edges and backward through `superseded_from` (version history). Expansion respects the same temporal/type filters. The final list order is seeds → semantic expansion → temporal history.

**Memory + relationship taxonomy**. Three `memory_type`s — `fact`, `preference`, `episode`. Three `relation_type`s — `UPDATES` (supersedes), `EXTENDS` (refines), `DERIVES` (inferred by `runDerivations()`). `UPDATES` is intentionally restricted to singular attributes (employer, location, role) and the prompt in [src/memory.js](src/memory.js) (`_detectRelationship`) spells this out — additive concepts must use `EXTENDS` or `NEW`. Preferences never go through `UPDATES`; they are strengthened via `_strengthenPreference`, which boosts `confidence` on a same-key or cosine-similar match.

**Schema and migrations**. The schema is defined in `Storage._init` and lives in `.greymemory/greymemory.db` by default. `Storage._migrate` is idempotent and runs on every construction — it rebuilds the `facts` table to drop the old `UNIQUE(key, container)` constraint, backfills v0.3 columns (`memory_type`, `document_date`, `event_date`, `expires_at`, `is_latest`, `superseded_by`, `superseded_from`, `relation_type`, `related_to`, `chunk_id`, `confidence`, `metadata`), then rebuilds `embeddings` to switch `fact_key` → `fact_id` and drop its own UNIQUE constraint. The `source_role` column is added by a separate ALTER. When changing schema, update both `_init` (fresh installs) and `_migrate` (existing DBs) and consider whether the standalone [bin/migrate.js](bin/migrate.js) needs the same change.

**Container isolation**. Every `facts` / `embeddings` / `chunks` / `chunk_embeddings` row carries a `container` column. All queries filter on it. Multiple `Memory` instances can share a `better-sqlite3` database (`new GreyMemory({ db, container })`) — greymemory's tables coexist with any other tables in the file.

**Provider-agnostic by design**. The `extractor` and `embedder` are user-supplied async functions — never branch on which model is in use. The extractor receives a complete prompt string and must return a raw JSON-array string; the embedder receives text and returns `number[]`. Both are also called with a second argument `{ phase }` naming the internal stage that triggered the call — extractor phases are `extraction` / `relationship` / `contextualization` / `derivation` / `time_extraction`; embedder phases are `chunk` / `dedup_seed` / `memory` / `query` / `derivation`. Providers may ignore it; the benchmark runner uses it to attribute tokens and cost per phase. Internal code should never bake in Anthropic / OpenAI / Voyage assumptions.

**LongMemEval benchmark and the CP framework**. The benchmark exists to push accuracy toward the LongMemEval paper's "Our Design", and most recent commits are framed around its four **control points** (`greymemory-longmemeval-implementation-plan.md`, git-ignored, is the source of this vocabulary): **CP1 Value** = round-level chunk granularity (indexing), **CP2 Key** = fact-augmented chunk embeddings, `K = V + fact` (indexing), **CP3 Query** = LLM-extracted time-range query expansion, gated by `TIME_AWARE_QUERY` and driven by the extractor's `time_extraction` phase (retrieval), **CP4 Reading** = JSON + Chain-of-Note answering via `formatForReading` / `formatForReadingV2` in [src/answering.js](src/answering.js), selected by `READING_MODE` + `CON_PROMPT_VERSION` (reading). The runner computes binary session-level Recall@k / NDCG@k (k ≥ 10, hence the `SEARCH_TOP_N >= 10` guard) and scores answers with the official judge in [benchmark/judge-prompts.js](benchmark/judge-prompts.js). When a change targets one CP, keep the others' flags fixed so the effect is isolated.

## When editing

- The library has no build step — edits to `src/` are picked up directly by `example/basic.js`, the benchmark, the console server, and consumers.
- The console server's two route groups (`greymemory-console/server/viz/` and `.../diag/`) import the library's `Memory` / `Storage` classes directly from the parent path via dynamic `import()`. Renaming exports in [src/index.js](src/index.js) or shifting public methods on `Memory` / `Storage` will break `greymemory-console` even though it lives in the same repo. All path/data-dir resolution is anchored once in [greymemory-console/server/index.js](greymemory-console/server/index.js) and injected into the router factories.
- The Diagnostics surface also depends on the *shape* of benchmark output — the fields in `run-*.json` and the `relationship-decisions-*.jsonl` rows that [benchmark/run.js](benchmark/run.js) writes (e.g. `session_id`, `failure_reason`, the per-phase token buckets). Changing what the runner logs can silently break the diag panels.
- The TypeScript surface in [src/index.d.ts](src/index.d.ts) is hand-maintained — update it alongside any change to a public method signature on the `Memory` class or any exported `answering.js` helper.
