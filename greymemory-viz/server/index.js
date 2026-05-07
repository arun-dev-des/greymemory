// index.js
//
// Express API for greymemory-viz, multi-dataset edition.
//
// Every read endpoint takes ?dataset=<id>&container=<id> query params:
//   GET  /api/datasets                           — list available DBs and their containers
//   GET  /api/graph?dataset&container[&asOf]     — graph payload
//   GET  /api/stats?dataset&container[&asOf]     — stats panel data
//   GET  /api/memory/:id?dataset                 — full detail for one fact
//   POST /api/search   { dataset, container, query, topN, expandViaGraph }
//
// The server holds no current dataset/container — every request is
// self-describing. Caching of DB handles + Memory instances lives in
// datasets.js so switching is cheap.

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildGraph, buildStats, getMemoryDetail } from './graph.js'
import { listDatasets, openDataset, listContainers, getSearchFn, findMemoryModule } from './datasets.js'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GREYMEMORY_ROOT is the directory containing many DB files.
// Falls back to GREYMEMORY_DIR for back-compat with single-db setups.
const GREYMEMORY_ROOT = path.resolve(
  __dirname,
  process.env.GREYMEMORY_ROOT
    ?? process.env.GREYMEMORY_DIR
    ?? '../../greymemory/.greymemory'
)
const PORT = Number(process.env.PORT ?? 4000)

console.log(`[greymemory-viz] dataset root: ${GREYMEMORY_ROOT}`)

// Locate the user's memory.js once at startup. Search a few candidate paths
// since memory.js typically lives alongside the bench harness or in the
// parent project, not inside the .greymemory-bench folder.
const memoryModulePath = findMemoryModule([
  path.resolve(GREYMEMORY_ROOT, '..'),                    // benchmark/.greymemory-bench → benchmark/
  path.resolve(GREYMEMORY_ROOT, '..', '..'),              // benchmark/.greymemory-bench → ./
  path.resolve(__dirname, '..', '..', 'greymemory'),      // greymemory-viz/server → greymemory/
  path.resolve(__dirname, '..', '..'),
])
if (memoryModulePath) console.log(`[greymemory-viz] memory.js: ${memoryModulePath}`)
else console.log(`[greymemory-viz] memory.js not found — live search disabled`)

const liveSearchAvailable = !!memoryModulePath && !!process.env.OPENAI_API_KEY

// ── Helper: resolve dataset+container from query string ───────────────────
function resolveContext(req, res) {
  const datasetId = req.query.dataset ?? req.body?.dataset
  const container = req.query.container ?? req.body?.container

  if (!datasetId) {
    res.status(400).json({ error: 'dataset query param required' })
    return null
  }
  if (!container) {
    res.status(400).json({ error: 'container query param required' })
    return null
  }

  const opened = openDataset(GREYMEMORY_ROOT, datasetId)
  if (!opened) {
    res.status(404).json({ error: `dataset '${datasetId}' not found` })
    return null
  }
  return { ...opened, container }
}

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// ── Datasets index ─────────────────────────────────────────────────────────
app.get('/api/datasets', (_req, res) => {
  const { datasets, error } = listDatasets(GREYMEMORY_ROOT)
  if (error) return res.status(500).json({ error })

  const enriched = datasets.map(ds => {
    try {
      const opened = openDataset(GREYMEMORY_ROOT, ds.id)
      const containers = opened ? listContainers(opened.db) : []
      return { id: ds.id, filename: ds.filename, containers }
    } catch (err) {
      return { id: ds.id, filename: ds.filename, containers: [], error: err.message }
    }
  })

  res.json({
    root: GREYMEMORY_ROOT,
    datasets: enriched,
    liveSearchAvailable,
  })
})

// ── Graph ──────────────────────────────────────────────────────────────────
app.get('/api/graph', (req, res) => {
  const ctx = resolveContext(req, res); if (!ctx) return
  const asOf = req.query.asOf || null
  const includeChunks = req.query.chunks !== 'false'
  const includeOlder = req.query.older !== 'false'
  res.json(buildGraph(ctx.db, ctx.container, { asOf, includeChunks, includeOlder }))
})

// ── Stats ──────────────────────────────────────────────────────────────────
app.get('/api/stats', (req, res) => {
  const ctx = resolveContext(req, res); if (!ctx) return
  const asOf = req.query.asOf || null
  res.json(buildStats(ctx.db, ctx.container, asOf))
})

// ── Memory detail ──────────────────────────────────────────────────────────
app.get('/api/memory/:id', (req, res) => {
  const datasetId = req.query.dataset
  if (!datasetId) return res.status(400).json({ error: 'dataset query param required' })
  const opened = openDataset(GREYMEMORY_ROOT, datasetId)
  if (!opened) return res.status(404).json({ error: `dataset '${datasetId}' not found` })

  const detail = getMemoryDetail(opened.db, Number(req.params.id))
  if (!detail) return res.status(404).json({ error: 'not found' })
  res.json(detail)
})

// ── Live retrieval ─────────────────────────────────────────────────────────
app.post('/api/search', async (req, res) => {
  const ctx = resolveContext(req, res); if (!ctx) return

  if (!liveSearchAvailable) {
    return res.status(503).json({
      error: 'live search disabled',
      hint: 'Set OPENAI_API_KEY in server/.env and ensure memory.js is reachable',
    })
  }

  const { query, topN = 5, expandViaGraph = true } = req.body ?? {}
  if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query required' })

  try {
    const search = await getSearchFn({
      db: ctx.db,
      dataset: ctx.dataset,
      container: ctx.container,
      memoryModulePath,
    })
    if (!search) return res.status(503).json({ error: 'live search not available for this dataset' })

    const results = await search(query, { topN, expandViaGraph })
    res.json({ query, results })
  } catch (err) {
    console.error('[search]', err)
    res.status(500).json({ error: err.message })
  }
})

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, root: GREYMEMORY_ROOT, liveSearchAvailable })
})

app.listen(PORT, () => {
  console.log(`[greymemory-viz] listening on http://localhost:${PORT}`)
})