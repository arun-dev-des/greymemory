// diag/routes.js — Diagnostics API, mounted at /api/diag by the console entry.
//
// Routes (relative to the /api/diag mount point):
//   GET  /runs                                  → list run-*.json summaries
//   GET  /runs/:id                              → full run JSON
//   GET  /runs/:id/questions/:qid               → question + matching JSONL entries
//   POST /runs/:id/questions/:qid/analyze       → Claude analysis (in-memory cached)
//   GET  /dbs                                   → list .greymemory-bench*/*.db with containers
//   GET  /dbs/:dbId/containers/:c/facts         → current facts for container
//   GET  /dbs/:dbId/containers/:c/facts/:id/history  → version chain
//   GET  /dbs/:dbId/chunks/:cid                 → fetch a chunk by id
//   POST /dbs/:dbId/containers/:c/search        → live hybrid search { query, topN? }
//   GET  /health
//
// ROOT_DIR / RESULTS_DIR are resolved once in the console entry and injected.

import express from 'express'
import { listRunFiles, readRunSummary, readRunFull, readRelationshipLog } from './runs.js'
import { listDatabases, listFacts, getFactHistory, getChunk }              from './databases.js'
import { getSearchFn }                                                    from './memory-loader.js'
import { buildAnalysisPrompt, callClaude }                                from './analyze.js'

export function createDiagRouter({ ROOT_DIR, RESULTS_DIR }) {
  const router = express.Router()

  // ── runs ────────────────────────────────────────────────────────────────

  router.get('/runs', (req, res) => {
    try {
      const files = listRunFiles(RESULTS_DIR)
      const summaries = files.map(f => {
        try { return readRunSummary(f) }
        catch (err) { return { id: f.id, filename: f.filename, error: err.message } }
      })
      res.json(summaries)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/runs/:id', (req, res) => {
    try {
      const file = listRunFiles(RESULTS_DIR).find(f => f.id === req.params.id)
      if (!file) return res.status(404).json({ error: 'run not found' })
      res.json(readRunFull(file))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/runs/:id/questions/:qid', async (req, res) => {
    try {
      const file = listRunFiles(RESULTS_DIR).find(f => f.id === req.params.id)
      if (!file) return res.status(404).json({ error: 'run not found' })
      const run = readRunFull(file)
      const q = (run.questions ?? []).find(q => q.question_id === req.params.qid)
      if (!q) return res.status(404).json({ error: 'question not found in run' })
      const relationshipLog = await readRelationshipLog(RESULTS_DIR, req.params.id, req.params.qid)
      res.json({ meta: run.meta, question: q, relationship_log: relationshipLog })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // AI analysis — calls Claude API with everything we know about this question.
  // In-memory per-(runId, qid) cache so repeated clicks don't re-bill. Restart
  // the server to clear.
  const analysisCache = new Map()
  router.post('/runs/:id/questions/:qid/analyze', async (req, res) => {
    const cacheKey = `${req.params.id}::${req.params.qid}`
    if (analysisCache.has(cacheKey) && !req.query.refresh) {
      return res.json({ ...analysisCache.get(cacheKey), cached: true })
    }
    try {
      const file = listRunFiles(RESULTS_DIR).find(f => f.id === req.params.id)
      if (!file) return res.status(404).json({ error: 'run not found' })
      const run = readRunFull(file)
      const q = (run.questions ?? []).find(q => q.question_id === req.params.qid)
      if (!q) return res.status(404).json({ error: 'question not found in run' })
      const relationshipLog = await readRelationshipLog(RESULTS_DIR, req.params.id, req.params.qid)

      const prompt = buildAnalysisPrompt({ question: q, relationshipLog })
      const t0 = Date.now()
      const result = await callClaude(prompt)
      const payload = { ...result, elapsed_ms: Date.now() - t0, prompt_chars: prompt.length, cached: false }
      analysisCache.set(cacheKey, payload)
      res.json(payload)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── databases ──────────────────────────────────────────────────────────

  let dbCache = null  // simple memo of listDatabases result; cleared via /dbs?refresh=1
  router.get('/dbs', (req, res) => {
    try {
      if (req.query.refresh || !dbCache) dbCache = listDatabases(ROOT_DIR)
      res.json(dbCache)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  function resolveDb(dbId) {
    const dbs = dbCache ?? (dbCache = listDatabases(ROOT_DIR))
    return dbs.find(d => d.id === dbId)
  }

  router.get('/dbs/:dbId/containers/:c/facts', (req, res) => {
    try {
      const db = resolveDb(req.params.dbId)
      if (!db) return res.status(404).json({ error: 'db not found' })
      res.json(listFacts(db.absPath, req.params.c))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/dbs/:dbId/containers/:c/facts/:fid/history', (req, res) => {
    try {
      const db = resolveDb(req.params.dbId)
      if (!db) return res.status(404).json({ error: 'db not found' })
      res.json(getFactHistory(db.absPath, req.params.c, parseInt(req.params.fid, 10)))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.get('/dbs/:dbId/chunks/:cid', (req, res) => {
    try {
      const db = resolveDb(req.params.dbId)
      if (!db) return res.status(404).json({ error: 'db not found' })
      const chunk = getChunk(db.absPath, parseInt(req.params.cid, 10))
      if (!chunk) return res.status(404).json({ error: 'chunk not found' })
      res.json(chunk)
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  router.post('/dbs/:dbId/containers/:c/search', async (req, res) => {
    try {
      const db = resolveDb(req.params.dbId)
      if (!db) return res.status(404).json({ error: 'db not found' })
      const { query, topN } = req.body ?? {}
      if (!query || typeof query !== 'string') return res.status(400).json({ error: 'query (string) required' })
      const search = await getSearchFn({ absPath: db.absPath, container: req.params.c, rootDir: ROOT_DIR })
      if (search.error) return res.status(503).json({ error: search.error })
      const results = await search.fn(query, { topN: topN ?? 10 })
      res.json({ query, topN: topN ?? 10, results })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── health ──────────────────────────────────────────────────────────────

  router.get('/health', (_req, res) => res.json({ ok: true, rootDir: ROOT_DIR }))

  return router
}
