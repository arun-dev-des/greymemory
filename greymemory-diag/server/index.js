// index.js — greymemory-diag HTTP entry.
//
// Endpoints (all under /api):
//   GET  /runs                                  → list run-*.json summaries
//   GET  /runs/:id                              → full run JSON
//   GET  /runs/:id/questions/:qid               → question + matching JSONL entries
//   GET  /dbs                                   → list .greymemory-bench*/*.db with containers
//   GET  /dbs/:dbId/containers/:c/facts         → current facts for container
//   GET  /dbs/:dbId/containers/:c/facts/:id/history  → version chain
//   POST /dbs/:dbId/containers/:c/search        → live hybrid search { query, topN? }
//
// Port 4001 by default (greymemory-viz uses 4000 — both can run side by side).

import express from 'express'
import cors    from 'cors'
import dotenv  from 'dotenv'
import path    from 'path'
import fs      from 'fs'
import { fileURLToPath } from 'url'

import { listRunFiles, readRunSummary, readRunFull, readRelationshipLog } from './runs.js'
import { listDatabases, listFacts, getFactHistory, getChunk }              from './databases.js'
import { getSearchFn }                                                    from './memory-loader.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// Repo root = two levels up from server/ (../../). User override via env.
const ROOT_DIR    = process.env.GREYMEMORY_ROOT ?? path.resolve(__dirname, '..', '..')
const RESULTS_DIR = path.join(ROOT_DIR, 'benchmark', 'results')

// Load .env from repo root (where the benchmark stores it) so live search
// inherits the same API keys the benchmark uses.
dotenv.config({ path: path.join(ROOT_DIR, '.env') })

const PORT = parseInt(process.env.PORT ?? '4001', 10)

console.log(`[diag] ROOT_DIR=${ROOT_DIR}`)
console.log(`[diag] RESULTS_DIR=${RESULTS_DIR}`)

const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))

// ── runs ────────────────────────────────────────────────────────────────

app.get('/api/runs', (req, res) => {
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

app.get('/api/runs/:id', (req, res) => {
  try {
    const file = listRunFiles(RESULTS_DIR).find(f => f.id === req.params.id)
    if (!file) return res.status(404).json({ error: 'run not found' })
    res.json(readRunFull(file))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/runs/:id/questions/:qid', async (req, res) => {
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

// ── databases ──────────────────────────────────────────────────────────

let dbCache = null  // simple memo of listDatabases result; cleared via /api/dbs?refresh=1
app.get('/api/dbs', (req, res) => {
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

app.get('/api/dbs/:dbId/containers/:c/facts', (req, res) => {
  try {
    const db = resolveDb(req.params.dbId)
    if (!db) return res.status(404).json({ error: 'db not found' })
    res.json(listFacts(db.absPath, req.params.c))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/dbs/:dbId/containers/:c/facts/:fid/history', (req, res) => {
  try {
    const db = resolveDb(req.params.dbId)
    if (!db) return res.status(404).json({ error: 'db not found' })
    res.json(getFactHistory(db.absPath, req.params.c, parseInt(req.params.fid, 10)))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/dbs/:dbId/chunks/:cid', (req, res) => {
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

app.post('/api/dbs/:dbId/containers/:c/search', async (req, res) => {
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

app.get('/api/health', (req, res) => res.json({ ok: true, rootDir: ROOT_DIR, port: PORT }))

app.listen(PORT, () => {
  console.log(`[diag] listening on http://localhost:${PORT}`)
})
