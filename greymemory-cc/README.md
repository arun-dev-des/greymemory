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
| `GREYMEMORY_CAPTURE_TOOLS` | no | — | Coding-agent capture: comma-separated tools whose results to fold in, e.g. `Edit,Write,Bash,Task`. `off`/`none` disables. See below. |

The default embedder is **local Ollama** (free, keeps retrieval latency low). Pull the model
once: `ollama pull mxbai-embed-large`.

### Capture mode — conversational vs coding-agent

By default capture is **conversational**: only prompts and answers are stored; tool calls and
their outputs are dropped (the answer already distills them). To also capture what tools *did*,
allowlist them via **`captureTools`** — either the `GREYMEMORY_CAPTURE_TOOLS` env var above, or a
`settings.json` in the plugin's data dir (`${CLAUDE_PLUGIN_DATA}/settings.json`, or
`~/.greymemory-cc/settings.json` by default):

```json
{ "captureTools": ["Edit", "Write", "Bash", "Task"] }
```

Resolution: built-in default (off) → `settings.json` → `GREYMEMORY_CAPTURE_TOOLS` (env wins; set
it to `off` to force-disable). When on, each allowlisted tool's result is folded into that turn's
assistant text as a compact `[tool result name=… ok|error] …` line.

## Status & caveats

How capture behaves, and the safety net around it:

1. **Conversational by default; tool capture is opt-in.** [`lib/transcript.mjs`](lib/transcript.mjs)
   flattens the transcript into a clean, strictly-alternating `{ role, content }[]` stream of
   rounds, keeping only what was *said*: the user's prompt (with `<ide_*>` context and
   injected/notice/error rows stripped) and the assistant's text answer. `tool_use`, raw
   `tool_result` dumps, thinking, and images are dropped — the text answer already distills the
   tool output. Set **`captureTools`** (see [Configuration](#configuration-env)) to additionally
   fold a compact `[tool result name=… ok|error] …` line for the named tools into the assistant
   turn (coding-agent capture). Off by default.
2. **Server-side dedup.** [`hooks/capture-worker.mjs`](hooks/capture-worker.mjs) passes
   `dedupBySession: true`, so re-reading a growing transcript never reprocesses old rounds.
   This is belt-and-suspenders with the **UUID watermark cursor** ([`lib/cursor.mjs`](lib/cursor.mjs)):
   the cursor sends only new entries; `dedupBySession` then catches the
   crash-between-add-and-cursor-write window (the cursor only advances after a successful add).

**Concurrency:** the DB is opened with `journal_mode=WAL` + `busy_timeout=5000` in
[`lib/memory.mjs`](lib/memory.mjs) because multiple processes (capture worker, retrieve hooks,
the long-lived MCP server) touch the same file — greymemory's `Storage` sets no pragmas, so
this is required here, not optional.

## Testing

Three tiers, cheapest first:

```bash
npm test               # Tier 1 — unit (lib logic). Zero deps: no install, no key, no Ollama.
npm run test:integration   # Tier 2 — drives the real hook scripts + MCP server, OFFLINE.
```

- **Tier 1** ([test/plugin.test.mjs](test/plugin.test.mjs)) covers the pure logic — transcript
  mapping (round pairing, ide-context stripping, injected-row dropping, captureTools folding),
  the cursor watermark, container resolution, and config (`captureTools` opt-in). Imports only
  node built-ins, so it runs anywhere (this is the CI gate).
- **Tier 2** ([test/integration.test.mjs](test/integration.test.mjs)) spawns the actual
  `hooks/capture-worker.mjs`, `hooks/retrieve.mjs`, and `mcp/server.mjs` with the exact payloads
  Claude Code sends, using the **offline `stub` providers** — so it verifies the real I/O
  contract, DB writes, conversational + opt-in tool capture, retrieval injection, MCP tools, and dedup with no API
  key and no Ollama. Needs `npm install` first (better-sqlite3 + greymemory).
- **Tier 3 — live in Claude Code:** install the plugin
  (`/plugin marketplace add <path-to greymemory-cc>` → `/plugin install greymemory-cc@greymemory-plugins`)
  with `ANTHROPIC_API_KEY` + Ollama, have a conversation, then check the DB grew, run
  `/grey-search`, and confirm SessionStart injection on a new session. `claude --debug` shows
  hooks firing.

**Provider knobs** (used by Tier 2 and for offline/local runs):

| Env | Values | Default |
|-----|--------|---------|
| `GREYMEMORY_EXTRACTOR` | `anthropic` \| `stub` | `anthropic` |
| `GREYMEMORY_EMBEDDER` | `ollama` \| `openai` \| `stub` | `ollama` |

`stub` is deterministic and offline; it's gated behind the env and never active by default.

## Layout

```
.claude-plugin/   plugin.json + marketplace.json
hooks/            hooks.json, retrieve.mjs, capture.mjs, capture-worker.mjs
lib/              memory.mjs, transcript.mjs, cursor.mjs, container.mjs, config.mjs, io.mjs
mcp/              server.mjs, forget-cli.mjs
commands/         grey-search.md, grey-save.md, grey-forget.md
.mcp.json         wires the stdio MCP server
```
