// memory-loader.js — lazy-instantiate the user's Memory class for live search.
//
// Mirrors greymemory-viz/server/datasets.js:142-184. Search only — never
// invokes the extractor (the stub throws if anyone tries). The embedder must
// match the model used at ingestion (Voyage, 1024-dim) or query vectors
// won't align with stored embeddings. We default to Voyage and fall back to
// OpenAI text-embedding-3-small if VOYAGE_API_KEY isn't set, but warn loudly
// because that mismatch silently returns garbage results.

import { pathToFileURL } from 'url'
import path              from 'path'
import fs                from 'fs'
import Database          from 'better-sqlite3'

const cache = new Map()

function findMemoryModule(rootDir) {
  const candidates = [
    path.join(rootDir, 'src', 'memory.js'),
    path.join(rootDir, '..', 'src', 'memory.js'),
  ]
  return candidates.find(p => fs.existsSync(p)) ?? null
}

function makeVoyageEmbedder() {
  const key   = process.env.VOYAGE_API_KEY
  const model = process.env.VOYAGE_MODEL ?? 'voyage-3-large'
  if (!key) return null
  return async (text) => {
    const r = await fetch('https://api.voyageai.com/v1/embeddings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body:    JSON.stringify({ model, input: text, input_type: 'query' }),
    })
    if (!r.ok) throw new Error(`voyage ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()
    return data.data[0].embedding
  }
}

function makeOpenAIEmbedder() {
  const key   = process.env.OPENAI_API_KEY
  const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
  if (!key) return null
  return async (text) => {
    const r = await fetch('https://api.openai.com/v1/embeddings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body:    JSON.stringify({ model, input: text }),
    })
    if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text()).slice(0, 200)}`)
    const data = await r.json()
    return data.data[0].embedding
  }
}

export async function getSearchFn({ absPath, container, rootDir }) {
  const key = `${absPath}::${container}`
  if (cache.has(key)) return cache.get(key)

  const memoryPath = findMemoryModule(rootDir)
  if (!memoryPath) return { error: 'memory.js not found under ' + rootDir }

  let MemoryClass
  try {
    const mod = await import(pathToFileURL(memoryPath).href)
    MemoryClass = mod.Memory ?? mod.default
    if (!MemoryClass) return { error: 'memory.js does not export Memory or default' }
  } catch (err) {
    return { error: `failed to import memory.js: ${err.message}` }
  }

  const embedder = makeVoyageEmbedder() ?? makeOpenAIEmbedder()
  if (!embedder) return { error: 'no embedder available: set VOYAGE_API_KEY (preferred) or OPENAI_API_KEY in greymemory-diag/server/.env' }
  if (!makeVoyageEmbedder()) {
    console.warn('[diag] WARN: VOYAGE_API_KEY not set, using OpenAI embedder — will return garbage if the DB was ingested with Voyage')
  }

  const extractor = async () => { throw new Error('extractor not used during search') }

  // Memory constructor opens its own DB from { dir }, but our path is the
  // db file itself. Open it externally and pass via `db` so we point at the
  // exact file, not a directory.
  const db = new Database(absPath, { readonly: false, fileMustExist: true })
  db.pragma('journal_mode = WAL')
  const memory = new MemoryClass({ extractor, embedder, container, db })
  const fn = (query, opts = {}) => memory.search(query, opts)
  cache.set(key, fn)
  return { fn }
}
