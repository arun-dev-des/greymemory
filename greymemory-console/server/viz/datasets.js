// datasets.js
//
// Multi-database support.
//
// Benchmarks produce many sibling DBs in one folder, named like:
//   benchmark/.greymemory-bench/
//     ├── ku-greymemory.db
//     ├── ms-greymemory.db
//     └── ...
//
// Inside each DB, containers correspond to question numbers (or whatever
// the benchmark uses to namespace runs). The user picks both in the UI:
// the dataset (which db file) and the container (which run).
//
// This module:
//   1. Discovers `*-greymemory.db` files in GREYMEMORY_ROOT.
//   2. Lists distinct containers within each.
//   3. Caches opened DB handles so switching datasets is instant.
//   4. Caches Memory instances per (dataset, container) for live search.

import fs from 'fs'
import path from 'path'
import Database from 'better-sqlite3'
import { pathToFileURL } from 'url'

// ── DB cache ──────────────────────────────────────────────────────────────
// Keyed by absolute path. Connections are kept alive for the process lifetime —
// we never have more than a handful of benchmark DBs.
const dbCache = new Map()

// ── Memory instance cache ─────────────────────────────────────────────────
// Keyed by `${absDbPath}::${container}`. Each entry is a callable search()
// function bound to that specific (db, container) pair. Cleared if live
// search initialization fails.
const memoryCache = new Map()

/**
 * List all `*-greymemory.db` files under the root directory.
 * Returns sorted by display name (the prefix before "-greymemory.db").
 */
export function listDatasets(root) {
  const absRoot = path.resolve(root)
  if (!fs.existsSync(absRoot)) {
    return { root: absRoot, datasets: [], error: 'directory does not exist' }
  }

  let entries
  try {
    entries = fs.readdirSync(absRoot)
  } catch (err) {
    return { root: absRoot, datasets: [], error: err.message }
  }

  const datasets = entries
    .filter(name => name.endsWith('-greymemory.db') || name === 'greymemory.db')
    .map(name => ({
      id: name.replace(/-greymemory\.db$|\.db$/, ''),  // 'ku-greymemory.db' → 'ku'
      filename: name,
      absPath: path.join(absRoot, name),
    }))
    .sort((a, b) => a.id.localeCompare(b.id))

  return { root: absRoot, datasets }
}

/**
 * Open (or reuse) a DB handle for a given dataset id.
 * Returns null if the dataset isn't found.
 */
export function openDataset(root, datasetId) {
  const { datasets } = listDatasets(root)
  const ds = datasets.find(d => d.id === datasetId)
  if (!ds) return null

  if (dbCache.has(ds.absPath)) return { db: dbCache.get(ds.absPath), dataset: ds }

  const db = new Database(ds.absPath)
  db.pragma('journal_mode = WAL')
  dbCache.set(ds.absPath, db)
  return { db, dataset: ds }
}

/**
 * List distinct container values within a DB. Sorted naturally — so question
 * numbers come back as "1, 2, 10" rather than "1, 10, 2".
 *
 * Reads from facts and chunks both, in case some containers exist as raw
 * chunks without any extracted facts yet.
 */
export function listContainers(db) {
  const fromFacts = db.prepare(`SELECT DISTINCT container FROM facts`).all()
  const fromChunks = db.prepare(`SELECT DISTINCT container FROM chunks`).all()

  const seen = new Set()
  const containers = []
  for (const row of [...fromFacts, ...fromChunks]) {
    if (!seen.has(row.container)) {
      seen.add(row.container)
      containers.push(row.container)
    }
  }

  // Natural sort: split numeric runs and compare them as numbers.
  // Handles "q_1", "q_2", "q_10" correctly, and pure numbers like 1, 2, 10.
  containers.sort(naturalCompare)

  // Annotate with row counts so the UI can show "(124 facts)" next to each.
  const counts = db.prepare(`
    SELECT container, COUNT(*) as n
    FROM facts
    WHERE is_latest = 1
    GROUP BY container
  `).all()
  const countMap = Object.fromEntries(counts.map(r => [r.container, r.n]))

  return containers.map(c => ({ id: c, factCount: countMap[c] ?? 0 }))
}

function naturalCompare(a, b) {
  const ax = String(a).match(/(\d+|\D+)/g) ?? []
  const bx = String(b).match(/(\d+|\D+)/g) ?? []
  for (let i = 0; i < Math.min(ax.length, bx.length); i++) {
    const an = Number(ax[i]), bn = Number(bx[i])
    if (!isNaN(an) && !isNaN(bn)) {
      if (an !== bn) return an - bn
    } else if (ax[i] !== bx[i]) {
      return ax[i] < bx[i] ? -1 : 1
    }
  }
  return ax.length - bx.length
}

/**
 * Get (or create) a live-search callable for a (dataset, container) pair.
 *
 * Returns null if API keys aren't configured or memory.js can't be loaded —
 * the caller must handle this and degrade gracefully.
 *
 * The Memory class is dynamically imported once per process and reused;
 * only the per-pair Memory *instance* is cached.
 */
// Read one stored embedding and return its dimension, so we can match the query
// embedder to whatever wrote the DB. Vectors are stored as JSON text (number[])
// or a Float32 blob. Falls back to chunk_embeddings, then null.
function probeStoredDim(db) {
  const dimOf = (v) => {
    if (v == null) return null
    if (Buffer.isBuffer(v)) return v.length / 4
    try { const a = JSON.parse(v); return Array.isArray(a) ? a.length : null } catch { return null }
  }
  for (const table of ['embeddings', 'chunk_embeddings']) {
    try {
      const row = db.prepare(`SELECT vector FROM ${table} WHERE vector IS NOT NULL LIMIT 1`).get()
      const d = dimOf(row?.vector)
      if (d) return d
    } catch { /* table may not exist */ }
  }
  return null
}

// Build a query embedder for the given stored dimension. 1024 → voyage-3,
// 1536 → OpenAI. Returns null if the matching provider key is missing.
function buildEmbedder(storedDim) {
  if (storedDim === 1024 && process.env.VOYAGE_API_KEY) {
    const model = process.env.VOYAGE_MODEL ?? 'voyage-3'
    return async (text) => {
      const resp = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({ model, input: text }),
      })
      if (!resp.ok) throw new Error(`voyage embedding api ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
      const data = await resp.json()
      return data.data[0].embedding
    }
  }

  // Default / 1536: OpenAI. Request an explicit dimension when the DB isn't the
  // model's native 1536, so text-embedding-3-* returns a matching-length vector.
  if (process.env.OPENAI_API_KEY) {
    const model = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'
    return async (text) => {
      const body = { model, input: text }
      if (storedDim && storedDim !== 1536) body.dimensions = storedDim
      const resp = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error(`embedding api ${resp.status}: ${(await resp.text()).slice(0, 200)}`)
      const data = await resp.json()
      return data.data[0].embedding
    }
  }

  return null
}

export async function getSearchFn({ db, dataset, container, memoryModulePath }) {
  const cacheKey = `${dataset.absPath}::${container}`
  if (memoryCache.has(cacheKey)) return memoryCache.get(cacheKey)

  // Need at least one embedding provider key; buildEmbedder picks by stored dim.
  if (!process.env.OPENAI_API_KEY && !process.env.VOYAGE_API_KEY) return null

  if (!memoryModulePath) return null

  let MemoryClass
  try {
    const mod = await import(pathToFileURL(memoryModulePath).href)
    MemoryClass = mod.Memory ?? mod.default
    if (!MemoryClass) return null
  } catch (err) {
    console.warn(`[datasets] failed to import ${memoryModulePath}: ${err.message}`)
    return null
  }

  // The query embedder MUST match the model that wrote this DB — cosine over
  // mismatched dimensions silently returns 0, and the library refuses outright.
  // We probe one stored vector's dimension and pick the provider accordingly:
  //   1024 → voyage-3 (the benchmark embedder), 1536 → OpenAI text-embedding-3-*.
  const storedDim = probeStoredDim(db)
  const embedder = buildEmbedder(storedDim)
  if (!embedder) {
    console.warn(`[datasets] no embedder for ${storedDim}-dim vectors in ${dataset.id} — search disabled`)
    return null
  }

  // Stub extractor — search() never invokes it
  const extractor = async () => { throw new Error('extractor not used during search') }

  const memory = new MemoryClass({ extractor, embedder, container, db })
  const fn = (query, opts) => memory.search(query, opts)
  memoryCache.set(cacheKey, fn)
  return fn
}

/**
 * Find the user's memory.js by walking up from the DB root.
 * Looked up once at server boot since the source layout is static.
 */
export function findMemoryModule(searchRoots) {
  const candidates = []
  for (const root of searchRoots) {
    candidates.push(
      path.join(root, 'src', 'memory.js'),
      path.join(root, 'memory.js'),
      path.join(root, 'lib', 'memory.js'),
      path.join(root, 'dist', 'memory.js'),
    )
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}
