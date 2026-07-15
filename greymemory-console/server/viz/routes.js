// viz/routes.js — Visualizer API, mounted at /api/viz by the console entry.
//
// Routes (relative to the /api/viz mount point):
//   GET  /datasets                           — list available DBs and their containers
//   GET  /graph?dataset&container[&asOf]     — graph payload
//   GET  /stats?dataset&container[&asOf]     — stats panel data
//   GET  /memory/:id?dataset                 — full detail for one fact
//   POST /search   { dataset, container, query, topN, expandViaGraph }
//   GET  /health
//
// The router holds no current dataset/container — every request is
// self-describing. Caching of DB handles + Memory instances lives in
// datasets.js so switching is cheap. Path resolution (GREYMEMORY_ROOT,
// memoryModulePath) is done once in the console entry and injected here.

import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildGraph, buildStats, getMemoryDetail } from './graph.js'
import { listDatasets, openDataset, listContainers, getSearchFn } from './datasets.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Slim LongMemEval index (question_id → question/answer/type), generated from
// benchmark/data/longmemeval_s_cleaned.json. In the benchmark DBs a container
// IS the question_id, so this lets a chip show that container's real question.
// Loaded once, lazily; absent file just means no per-container questions.
let LME_QUESTIONS = null
function loadLmeQuestions() {
  if (LME_QUESTIONS !== null) return LME_QUESTIONS
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'longmemeval-questions.json'), 'utf8')
    const arr = JSON.parse(raw)
    LME_QUESTIONS = new Map(arr.map(q => [q.question_id, q]))
  } catch {
    LME_QUESTIONS = new Map()   // benchmark data not shipped — feature just no-ops
  }
  return LME_QUESTIONS
}

export function createVizRouter({ GREYMEMORY_ROOT, memoryModulePath }) {
  const router = express.Router()

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

  // ── Datasets index ─────────────────────────────────────────────────────────
  router.get('/datasets', (_req, res) => {
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
  router.get('/graph', (req, res) => {
    const ctx = resolveContext(req, res); if (!ctx) return
    const asOf = req.query.asOf || null
    const includeChunks = req.query.chunks !== 'false'
    const includeOlder = req.query.older !== 'false'
    res.json(buildGraph(ctx.db, ctx.container, { asOf, includeChunks, includeOlder }))
  })

  // ── Stats ──────────────────────────────────────────────────────────────────
  router.get('/stats', (req, res) => {
    const ctx = resolveContext(req, res); if (!ctx) return
    const asOf = req.query.asOf || null
    res.json(buildStats(ctx.db, ctx.container, asOf))
  })

  // ── Memory detail ──────────────────────────────────────────────────────────
  router.get('/memory/:id', (req, res) => {
    const datasetId = req.query.dataset
    if (!datasetId) return res.status(400).json({ error: 'dataset query param required' })
    const opened = openDataset(GREYMEMORY_ROOT, datasetId)
    if (!opened) return res.status(404).json({ error: `dataset '${datasetId}' not found` })

    const detail = getMemoryDetail(opened.db, Number(req.params.id))
    if (!detail) return res.status(404).json({ error: 'not found' })
    res.json(detail)
  })

  // ── Live retrieval ─────────────────────────────────────────────────────────
  router.post('/search', async (req, res) => {
    const ctx = resolveContext(req, res); if (!ctx) return

    if (!liveSearchAvailable) {
      return res.status(503).json({
        error: 'live search disabled',
        hint: 'Set OPENAI_API_KEY in greymemory-console/server/.env (or repo .env) and ensure memory.js is reachable',
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
      console.error('[viz/search]', err)
      res.status(500).json({ error: err.message })
    }
  })

  // ── LongMemEval question for a container ────────────────────────────────────
  // In benchmark DBs the container is the LongMemEval question_id, so this
  // returns that container's own gold question + expected answer. Returns
  // { question: null } for scenario containers with no mapping.
  router.get('/question/:container', (req, res) => {
    const q = loadLmeQuestions().get(req.params.container)
    if (!q) return res.json({ container: req.params.container, question: null })
    res.json({ container: req.params.container, ...q })
  })

  // ── Health ─────────────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({ ok: true, root: GREYMEMORY_ROOT, liveSearchAvailable })
  })

  return router
}
