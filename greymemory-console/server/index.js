// index.js — greymemory-console unified HTTP entry.
//
// One Express app on a single port that mounts two route groups:
//   /api/viz/*   — Visualizer (graph + live search over scenario/bench DBs)
//   /api/diag/*  — Diagnostics (benchmark run forensics + DB browser)
//
// All path resolution lives here, anchored once to the repo root, and is
// injected into each router factory. The moved modules (datasets/graph,
// runs/databases/memory-loader/analyze) resolve nothing against __dirname —
// they take roots as arguments — so this is the only file that knows where
// things live on disk.

import express from 'express'
import cors    from 'cors'
import dotenv  from 'dotenv'
import path    from 'path'
import { fileURLToPath } from 'url'

import { createVizRouter }  from './viz/routes.js'
import { createDiagRouter } from './diag/routes.js'
import { findMemoryModule } from './viz/datasets.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// greymemory-console/server → repo root is two levels up.
const REPO_ROOT = path.resolve(__dirname, '..', '..')

// Single .env load from the repo root, where ANTHROPIC/OPENAI/VOYAGE keys live.
dotenv.config({ path: path.join(REPO_ROOT, '.env') })

const PORT = Number(process.env.PORT ?? 4000)

// ── viz data root ────────────────────────────────────────────────────────────
// The old viz server resolved GREYMEMORY_ROOT relative to greymemory-viz/server/
// with default ../scenarios/.greymemory-scenarios. Now we resolve it from the
// repo root, so the default points at the scenarios dir that stayed in place.
const GREYMEMORY_ROOT = path.resolve(
  REPO_ROOT,
  process.env.GREYMEMORY_ROOT ?? 'greymemory-viz/scenarios/.greymemory-scenarios'
)

// memory.js lives at REPO_ROOT/src/memory.js — give findMemoryModule that root
// plus a walk-up fallback from the data dir (covers bench-style layouts).
const memoryModulePath = findMemoryModule([
  REPO_ROOT,
  path.resolve(GREYMEMORY_ROOT, '..'),
  path.resolve(GREYMEMORY_ROOT, '..', '..'),
])

// ── diag roots ───────────────────────────────────────────────────────────────
// The old diag server used repo root (../../ from diag/server). It read it from
// GREYMEMORY_ROOT, which now belongs to viz — so diag gets its own env name to
// avoid the collision. Default is the repo root.
const ROOT_DIR    = process.env.GREYMEMORY_DIAG_ROOT ?? REPO_ROOT
const RESULTS_DIR = path.join(ROOT_DIR, 'benchmark', 'results')

console.log(`[greymemory-console] REPO_ROOT=${REPO_ROOT}`)
console.log(`[greymemory-console] viz dataset root=${GREYMEMORY_ROOT}`)
console.log(`[greymemory-console] memory.js=${memoryModulePath ?? '(not found — viz live search disabled)'}`)
console.log(`[greymemory-console] diag ROOT_DIR=${ROOT_DIR}`)
console.log(`[greymemory-console] diag RESULTS_DIR=${RESULTS_DIR}`)

const app = express()
app.use(cors())
app.use(express.json({ limit: '4mb' }))   // diag's 4mb (superset of viz's 1mb)

app.use('/api/viz',  createVizRouter({ GREYMEMORY_ROOT, memoryModulePath }))
app.use('/api/diag', createDiagRouter({ ROOT_DIR, RESULTS_DIR }))

// Top-level health that doesn't collide with the per-surface ones.
app.get('/api/health', (_req, res) => res.json({ ok: true, repoRoot: REPO_ROOT }))

app.listen(PORT, () => {
  console.log(`[greymemory-console] listening on http://localhost:${PORT}`)
})
