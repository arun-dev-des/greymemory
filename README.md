# GreyMemory 🧠

> Self-hosted memory layer for AI agents. Local embeddings, semantic search, persistent facts. No API keys required for embeddings.

I built this while learning AI agents from scratch. This is v0.1 — single user, file-based, honest scope. Built in public, growing in public.

**Why the name?** Grey matter is where intelligence actually lives in the brain. Small footprint. Quietly powerful.

---

## The problem

Most memory solutions for AI agents send your data to a cloud API:
```
Your user's data → their servers → embeddings → back to you
```

GreyMemory runs entirely on your machine:
```
Your user's data → your machine → Ollama embeddings → stays with you
```

---

## What it does

- **Extracts facts** from conversations automatically using Claude
- **Remembers across sessions** — survives restarts
- **Finds relevant facts** by meaning, not keywords
- **Resolves contradictions** — overwrites automatically
- **Runs locally** — embeddings via Ollama, zero API cost

---

## Prerequisites

- Node.js 18+
- Ollama → [ollama.com](https://ollama.com)
- Anthropic API key (for fact extraction only)
```bash
ollama pull nomic-embed-text
```

---

## Install
```bash
npm install greymemory
```

---

## Quick start
```javascript
import GreyMemory from "greymemory"

const memory = new GreyMemory()

// add a conversation — facts extracted automatically
const facts = await memory.add([
  { role: "user", content: "Hi, I'm Arun and I train powerlifting" },
  { role: "assistant", content: "Great to meet you Arun!" },
  { role: "user", content: "I want an annual membership" },
  { role: "assistant", content: "Annual is our best value!" },
])

console.log(facts)
// { name: 'Arun', interest: 'powerlifting', membership: 'annual' }

// search by meaning — not keywords
const context = await memory.search("what sport does this person train?")
// { interest: 'powerlifting' }

// inject into your agent
const systemPrompt = `You are a helpful assistant.
What you know about this user: ${JSON.stringify(context)}`
```

---

## API

### `new GreyMemory(options?)`
```javascript
const memory = new GreyMemory({
  dir: ".greymemory",                    // storage folder
  model: "nomic-embed-text",             // Ollama embedding model
  ollamaUrl: "http://localhost:11434",   // Ollama URL
  apiKey: process.env.ANTHROPIC_API_KEY  // Claude API key
})
```

### `await memory.add(messages)`

Extracts facts from a conversation and stores them with embeddings.
```javascript
const facts = await memory.add(messages)
// returns: { name: 'Arun', interest: 'powerlifting' }
```

### `await memory.search(query, topN?)`

Finds relevant facts by semantic similarity. Default topN = 3.
```javascript
const context = await memory.search("what does this user want?")
// returns: { membership: 'annual' }
```

### `memory.getFacts()`

Returns all stored facts.
```javascript
const all = memory.getFacts()
// returns: { name: 'Arun', interest: 'powerlifting', membership: 'annual' }
```

### `memory.clear()`

Deletes all stored facts and embeddings from disk and memory.
```javascript
memory.clear()
```

---

## How it works
```
Conversation
    ↓
Claude extracts facts → facts.json
    ↓
Ollama embeds each fact → embeddings.json

Query
    ↓
Ollama embeds query
    ↓
Cosine similarity vs stored embeddings
    ↓
Top N relevant facts returned
```

---

## v0.1 — honest scope

This is a learning-in-public project. v0.1 is intentionally simple:

- Single user only
- File-based storage (not SQLite)
- No TypeScript types yet
- No streaming support

It works. Use it. Break it. File issues.

---

## Roadmap

- [ ] SQLite storage + multi-user support
- [ ] TypeScript types
- [ ] OpenAI / Voyage embedding support
- [ ] Automatic compaction for long conversations
- [ ] MCP server
- [ ] Cloud option (GreyMemory Cloud)

---

## Built by

Arunkumar — building AI agents in public.

Follow the journey: [github.com/arun-dev-des](https://github.com/arun-dev-des)

---

## License

Apache 2.0 — see [LICENSE](./LICENSE) for details.