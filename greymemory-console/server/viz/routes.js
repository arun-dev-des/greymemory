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
import { buildGraph, buildStats, getMemoryDetail } from './graph.js'
import { listDatasets, openDataset, listContainers, getSearchFn } from './datasets.js'

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

  // ── Health ─────────────────────────────────────────────────────────────────
  router.get('/health', (_req, res) => {
    res.json({ ok: true, root: GREYMEMORY_ROOT, liveSearchAvailable })
  })

  return router
}
