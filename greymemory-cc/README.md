# greymemory-cc

A Claude Code plugin that gives Claude **persistent, self-hosted memory** across sessions,
backed by the local [greymemory](https://github.com/arun-dev-des/greymemory) library — no
SaaS, no auth flow, your data never leaves your machine.

It does two things:

- **Capture** — on every `Stop`, it reads the new transcript turns and ingests them into a
  per-project greymemory SQLite DB (extract → embed → dedup → classify).
- **Inject** — on `SessionStart` and `UserPromptSubmit`, it retrieves relevant memories and
  injects them into Claude's context.

Plus an MCP server so Claude can actively `grey_search` / `grey_add` / `grey_profile`, and
slash commands `/grey-search`, `/grey-save`, `/grey-forget`.

## How it works

```
SessionStart    → retrieve.mjs → memory.getProfile()  ─┐
UserPromptSubmit → retrieve.mjs → memory.search()      ─┼─► <greymemory-context> injected
Stop → capture.mjs → spawn detached capture-worker → exit fast (never blocks the turn)
        worker: readNewEntries (UUID cursor) → prose-flatten → memory.add({ sessionId })
MCP (active): Claude → grey_search / grey_add / grey_profile → same per-project greymemory.db
```

All paths read/write the same DB: `${CLAUDE_PLUGIN_DATA}/<container>/greymemory.db`.

**container vs session_id**
- `container` = project isolation (one DB namespace per repo), derived from the git remote
  (`repo_<name>`) or a hash of the project root (`proj_<sha16>`). Set once; cached per cwd.
- `session_id` = provenance + dedup key for one conversation, passed to `add({ sessionId })`.
  Many sessions write into one container.

## Install

```bash
cd greymemory-cc
npm install            # links the local greymemory lib via "file:.."
```

Then, in Claude Code:

```
/plugin marketplace add <path-or-repo-to greymemory-cc>
/plugin install greymemory-cc@greymemory-plugins
```

## Configuration (env)

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `ANTHROPIC_API_KEY` | yes | — | Extractor LLM (greymemory throws without a working extractor) |
| `GREYMEMORY_EMBEDDER` | no | `ollama` | `ollama` or `openai` |
| `OLLAMA_HOST` | no | `http://localhost:11434` | Ollama endpoint (default embedder) |
| `OLLAMA_EMBED_MODEL` | no | `mxbai-embed-large` | Ollama embedding model |
| `OPENAI_API_KEY` | if openai | — | Required when `GREYMEMORY_EMBEDDER=openai` |
| `OPENAI_EMBED_MODEL` | no | `text-embedding-3-small` | OpenAI embedding model |
| `GREYMEMORY_EXTRACTOR_MODEL` | no | `claude-haiku-4-5-20251001` | Anthropic model for extraction |
| `GREYMEMORY_CONTAINER` | no | derived from git | Force a container tag |

The default embedder is **local Ollama** (free, keeps retrieval latency low). Pull the model
once: `ollama pull mxbai-embed-large`.

## Status & caveats

Both of the library features this plugin was designed around are now live (greymemory ≥ 0.4),
so the plugin uses them directly:

1. **Structured tool fidelity.** [`lib/transcript.mjs`](lib/transcript.mjs) emits structured
   messages — assistant `tool_use` → `tool_calls`, and CC tool results (recorded under
   `role:'user'`) are lifted into dedicated `{ role:'tool', tool_call_id, name }` messages.
   The library folds `tool_calls` into the assistant text and prefixes results with
   `[tool result name=…]`, and tags `source_role:'tool'`. Images become an `[image]`
   placeholder (never the URL); thinking blocks are dropped.
2. **Server-side dedup.** [`hooks/capture-worker.mjs`](hooks/capture-worker.mjs) passes
   `dedupBySession: true`, so re-reading a growing transcript never reprocesses old rounds.
   This is belt-and-suspenders with the **UUID watermark cursor** ([`lib/cursor.mjs`](lib/cursor.mjs)):
   the cursor sends only new entries; `dedupBySession` then catches the
   crash-between-add-and-cursor-write window (the cursor only advances after a successful add).

**Concurrency:** the DB is opened with `journal_mode=WAL` + `busy_timeout=5000` in
[`lib/memory.mjs`](lib/memory.mjs) because multiple processes (capture worker, retrieve hooks,
the long-lived MCP server) touch the same file — greymemory's `Storage` sets no pragmas, so
this is required here, not optional.

## Layout

```
.claude-plugin/   plugin.json + marketplace.json
hooks/            hooks.json, retrieve.mjs, capture.mjs, capture-worker.mjs
lib/              memory.mjs, transcript.mjs, cursor.mjs, container.mjs, io.mjs
mcp/              server.mjs, forget-cli.mjs
commands/         grey-search.md, grey-save.md, grey-forget.md
.mcp.json         wires the stdio MCP server
```
