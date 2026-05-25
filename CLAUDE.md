# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

greymemory is a self-hosted memory layer for AI agents. It extracts atomic memories from conversations, detects contradictions, and exposes them through hybrid search — all on SQLite, with user-supplied LLM and embedder functions ("bring your own LLM"). The library is ESM-only (`"type": "module"`), Node 18+, and the public entry point is `src/index.js`.

## Repository layout

- [src/](src/) — the library. Self-contained, no build step.
  - [src/memory.js](src/memory.js) — `Memory` class, the main orchestrator. Owns `add()`, `search()`, `getProfile()`, `getCurrent()`, `getHistory()`, `forget()`, `runDerivations()`. Contains relationship classification (`_detectRelationship`), graph expansion (`_expandViaExtends`, `_expandViaSupersessionHistory`), preference strengthening, and the extraction-parsing logic. Date normalisation lives here too (`_normalizeDate`).
  - [src/storage.js](src/storage.js) — `Storage` class wrapping `better-sqlite3`. Owns the schema, all FTS5 triggers, the hybrid BM25 + vector search (`hybridSearch`), the v0.2 → v0.3 in-place migration (`_migrate`), and `saveFact` / `saveChunk` / `supersedeFact`.
  - [src/prompts.js](src/prompts.js) — `buildExtractorPrompt`. The single source of truth for what the extractor LLM is asked to do (self-containment test, STATE CHANGE RULE, memory-type classification, source_message_index).
  - [src/answering.js](src/answering.js) — `buildAnsweringPrompt`. Used by the benchmark runner and exported for downstream apps that want temporal-reasoning-aware answering.
  - [src/batch-embedder.js](src/batch-embedder.js) — `createBatchEmbedder`. Wraps a batch embedding API into a single-text embedder, collecting calls within a time window.
  - [src/index.js](src/index.js) / [src/index.d.ts](src/index.d.ts) — default + named exports and the full TypeScript surface.
- [bin/](bin/) — CLI. `init.js` is the setup wizard (`npx greymemory init`); `migrate.js` is the v0.2 → v0.3 standalone migrator (`npx greymemory-migrate`). Both are registered in [package.json](package.json) under `bin`.
- [example/basic.js](example/basic.js) — end-to-end demo touching every public method. Run this to sanity-check changes to `Memory`.
- [benchmark/](benchmark/) — LongMemEval runner. [benchmark/run.js](benchmark/run.js) is the main entry; flags at the top (`LIMIT`, `PER_CATEGORY`, `CATEGORY_FILTER`, `SKIP_INGEST`) gate behaviour. Results land in `benchmark/results/`, the ingestion DB in `benchmark/.greymemory-bench/`. Both are git-ignored.
- [test files/](test%20files/) — manual integration scripts named `test-v03-weekN.js`. They are deliberately git-ignored (see `.gitignore`) and are run individually with `node "test files/test-v03-week5.js"`.
- [greymemory-viz/](greymemory-viz/) — separate visualisation tool with its own `node_modules` per sub-package. Three independent packages: `server/` (Express over the same SQLite), `client/` (Vite + React + react-force-graph-2d), `scenarios/` (handcrafted reproducible cases). They reuse the library's `Memory` / `Storage` classes — no data duplication or schema changes.

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

# Visualisation tool — three packages, install + run separately
cd greymemory-viz/server && npm install && npm run dev   # terminal 1
cd greymemory-viz/client && npm install && npm run dev   # terminal 2
cd greymemory-viz/scenarios && npm install && npm run all
```

There is no test framework, no lint script, and no build step. Type-checking is available via `tsc --noEmit` (config in [tsconfig.json](tsconfig.json) — `allowJs: true`, `noEmit: true`, includes `src` and `test-types.ts`).

## Architecture notes that span files

**Ingestion pipeline (`memory.add`)**. Chunks are always persisted first, before extraction runs, so a failed/empty extraction still leaves the raw conversation queryable. Each message becomes one row in `chunks` + one row in `chunk_embeddings`. Only then does the extractor run; extracted memories get embedded, deduped within the batch (cosine > 0.92), classified by relationship, and saved to `facts` + `embeddings`. After every `add()`, `entityContext` is automatically updated from the accumulated profile — reference resolution improves across sessions.

**Hybrid search (`storage.hybridSearch` + `memory.search`)**. SQLite FTS5 supplies BM25; vectors are loaded from the `embeddings` / `chunk_embeddings` tables and scored with cosine similarity. Results are fused with reciprocal rank fusion, then `memory.search` applies filters (`memoryTypes`, `afterDate`, `beforeDate`, `asOf`, `includeHistory`, `includeExpired`), slices to `topN` seeds, and then runs **graph expansion**: forward through `EXTENDS` edges and backward through `superseded_from` (version history). Expansion respects the same temporal/type filters. The final list order is seeds → semantic expansion → temporal history.

**Memory + relationship taxonomy**. Three `memory_type`s — `fact`, `preference`, `episode`. Three `relation_type`s — `UPDATES` (supersedes), `EXTENDS` (refines), `DERIVES` (inferred by `runDerivations()`). `UPDATES` is intentionally restricted to singular attributes (employer, location, role) and the prompt in [src/memory.js](src/memory.js) (`_detectRelationship`) spells this out — additive concepts must use `EXTENDS` or `NEW`. Preferences never go through `UPDATES`; they are strengthened via `_strengthenPreference`, which boosts `confidence` on a same-key or cosine-similar match.

**Schema and migrations**. The schema is defined in `Storage._init` and lives in `.greymemory/greymemory.db` by default. `Storage._migrate` is idempotent and runs on every construction — it rebuilds the `facts` table to drop the old `UNIQUE(key, container)` constraint, backfills v0.3 columns (`memory_type`, `document_date`, `event_date`, `expires_at`, `is_latest`, `superseded_by`, `superseded_from`, `relation_type`, `related_to`, `chunk_id`, `confidence`, `metadata`), then rebuilds `embeddings` to switch `fact_key` → `fact_id` and drop its own UNIQUE constraint. The `source_role` column is added by a separate ALTER. When changing schema, update both `_init` (fresh installs) and `_migrate` (existing DBs) and consider whether the standalone [bin/migrate.js](bin/migrate.js) needs the same change.

**Container isolation**. Every `facts` / `embeddings` / `chunks` / `chunk_embeddings` row carries a `container` column. All queries filter on it. Multiple `Memory` instances can share a `better-sqlite3` database (`new GreyMemory({ db, container })`) — greymemory's tables coexist with any other tables in the file.

**Provider-agnostic by design**. The `extractor` and `embedder` are user-supplied async functions — never branch on which model is in use. The extractor receives a complete prompt string and must return a raw JSON-array string; the embedder receives text and returns `number[]`. Internal code should never bake in Anthropic / OpenAI / Voyage assumptions.

## When editing

- The library has no build step — edits to `src/` are picked up directly by `example/basic.js`, the benchmark, the viz server, and consumers.
- The viz tool's `server/` imports the library's `Memory` / `Storage` classes directly from the parent path. Renaming exports in [src/index.js](src/index.js) or shifting public methods on `Memory` / `Storage` will break `greymemory-viz` even though it lives in the same repo.
- The TypeScript surface in [src/index.d.ts](src/index.d.ts) is hand-maintained — update it alongside any change to a public method signature on the `Memory` class or the exported `buildAnsweringPrompt`.
- `git status` at session start showed `M src/memory.js` and untracked `benchmark/ingest-single.js` + `benchmark/test-task-1-1.js` + `benchmark/.greymemory-bench-test/` — these are in-progress and not yet committed.
