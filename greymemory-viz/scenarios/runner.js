// runner.js
//
// Shared harness for scenario scripts. Each scenario calls runScenario()
// with a name and an async function that takes a fresh `memory` instance.
// The harness handles:
//   • locating the user's memory.js (same logic as the server)
//   • building a real extractor + embedder backed by the configured providers
//   • creating a fresh DB for the scenario (deletes any prior one)
//   • giving the scenario an isolated Memory instance
//   • pretty-printing what happened so you can read the run in the terminal
//
// After a scenario runs, the resulting DB is at:
//   <GREYMEMORY_SCENARIOS_DIR>/<id>-greymemory.db
//
// Point your viz server's GREYMEMORY_ROOT at GREYMEMORY_SCENARIOS_DIR to
// see the scenarios in the dataset dropdown.

import fs from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import dotenv from 'dotenv'
import Database from 'better-sqlite3'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Paths ─────────────────────────────────────────────────────────────────
const SCENARIOS_DIR = path.resolve(
  __dirname,
  process.env.GREYMEMORY_SCENARIOS_DIR ?? './.greymemory-scenarios'
)

if (!fs.existsSync(SCENARIOS_DIR)) {
  fs.mkdirSync(SCENARIOS_DIR, { recursive: true })
}

// ── Memory module discovery ────────────────────────────────────────────────
function findMemoryModule() {
  const candidates = [
    // Most likely: greymemory-viz/scenarios → ../../greymemory/src/memory.js
    path.resolve(__dirname, '..', '..', 'greymemory', 'src', 'memory.js'),
    path.resolve(__dirname, '..', '..', 'greymemory', 'memory.js'),
    // Fallbacks for non-standard layouts
    path.resolve(__dirname, '..', '..', 'src', 'memory.js'),
    path.resolve(__dirname, '..', '..', 'memory.js'),
  ]
  if (process.env.GREYMEMORY_MODULE) {
    candidates.unshift(path.resolve(process.env.GREYMEMORY_MODULE))
  }
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return null
}

const memoryModulePath = findMemoryModule()
if (!memoryModulePath) {
  console.error('[scenarios] could not locate memory.js')
  console.error('[scenarios] tried:')
  console.error(`              ../../greymemory/src/memory.js`)
  console.error(`              ../../greymemory/memory.js`)
  console.error('[scenarios] set GREYMEMORY_MODULE in .env to override')
  process.exit(1)
}

const { Memory } = await import(pathToFileURL(memoryModulePath).href)
if (!Memory) {
  console.error(`[scenarios] memory.js found at ${memoryModulePath} but no Memory export`)
  process.exit(1)
}

// ── Extractor + embedder ───────────────────────────────────────────────────
//
// Both go through HTTP directly to keep zero npm dependencies on provider SDKs.
// If you want to swap providers, edit these two functions.

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const OPENAI_KEY    = process.env.OPENAI_API_KEY
const EXTRACTOR_MODEL = process.env.EXTRACTOR_MODEL ?? 'claude-haiku-4-5-20251001'
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small'

if (!ANTHROPIC_KEY) {
  console.error('[scenarios] ANTHROPIC_API_KEY required for extraction')
  process.exit(1)
}
if (!OPENAI_KEY) {
  console.error('[scenarios] OPENAI_API_KEY required for embeddings')
  process.exit(1)
}

async function extractor(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: EXTRACTOR_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!resp.ok) {
    throw new Error(`anthropic api ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  }
  const data = await resp.json()
  // Concatenate any text blocks; ignore tool_use, etc.
  return data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
}

async function embedder(text) {
  const resp = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text }),
  })
  if (!resp.ok) {
    throw new Error(`openai api ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
  }
  const data = await resp.json()
  return data.data[0].embedding
}

// ── Pretty logging ─────────────────────────────────────────────────────────
const c = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  magenta:'\x1b[35m',
  red:    '\x1b[31m',
}

function log(prefix, color, msg) {
  console.log(`${color}${prefix}${c.reset} ${msg}`)
}

// ── Public API ─────────────────────────────────────────────────────────────
/**
 * Run a scenario in an isolated DB.
 *
 * @param {object}   spec
 * @param {string}   spec.id        — used in the DB filename, e.g. "01-updates"
 * @param {string}   spec.title     — human-readable, printed in logs
 * @param {string}   spec.intent    — what this scenario is meant to demonstrate
 * @param {function} spec.run       — async (memory, helpers) => void
 */
export async function runScenario(spec) {
  const dbFile = path.join(SCENARIOS_DIR, `${spec.id}-greymemory.db`)

  console.log()
  console.log(c.bold + '━'.repeat(70) + c.reset)
  console.log(`${c.bold}${spec.id}${c.reset}  ${c.cyan}${spec.title}${c.reset}`)
  console.log(c.dim + spec.intent + c.reset)
  console.log(c.bold + '━'.repeat(70) + c.reset)

  // Wipe any prior run of this scenario for a clean slate
  if (fs.existsSync(dbFile)) {
    fs.unlinkSync(dbFile)
    log('[reset]', c.dim, `removed ${path.basename(dbFile)}`)
  }
  // Also wipe any -wal / -shm sidecars
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext)
  }

  // Open the DB directly and pass it to Memory — this avoids the default
  // Storage path of `<dir>/greymemory.db` and lets each scenario have its
  // own DB file in a shared scenarios directory.
  const db = new Database(dbFile)
  db.pragma('journal_mode = WAL')

  const memory = new Memory({
    extractor,
    embedder,
    container: 'default',
    db,
  })

  const helpers = {
    add: async (input, opts = {}) => {
      const messageCount = Array.isArray(input) ? input.length : 1
      const result = await memory.add(input, opts)
      log('[add]', c.green,
        `${messageCount} message${messageCount > 1 ? 's' : ''} on ${opts.date ?? 'today'} → ${result.factsStored} facts, ${result.chunksStored} chunks`)
      return result
    },

    forget: async (query) => {
      const value = await memory.forget(query)
      if (value) log('[forget]', c.yellow, `"${query}" → forgot: ${value}`)
      else        log('[forget]', c.dim,   `"${query}" → nothing matched`)
      return value
    },

    derive: async (opts) => {
      const derived = await memory.runDerivations(opts)
      if (derived.length === 0) log('[derive]', c.dim, 'no inferences drawn')
      else for (const d of derived) log('[derive]', c.magenta, `inferred: ${d.value}`)
      return derived
    },

    search: async (query, opts) => {
      const results = await memory.search(query, opts)
      log('[search]', c.cyan, `"${query}" → ${results.length} results`)
      results.forEach((r, i) => {
        const tag = r._expansion?.via ?? 'seed'
        const text = (r.memory ?? r.chunk ?? '').slice(0, 80)
        console.log(`         ${c.dim}${i + 1}. [${tag}]${c.reset} ${text}`)
      })
      return results
    },

    note: (msg) => log('[note]', c.dim, msg),
  }

  let succeeded = false
  try {
    await spec.run(memory, helpers)
    succeeded = true
  } catch (err) {
    log('[error]', c.red, err.message)
    console.error(err.stack)
  } finally {
    memory.storage.db.close()
  }

  console.log()
  if (succeeded) {
    log('[done]', c.bold + c.green, `wrote ${dbFile}`)
    console.log(`       ${c.dim}view by setting GREYMEMORY_ROOT=${SCENARIOS_DIR}${c.reset}`)
  } else {
    log('[failed]', c.bold + c.red, `${spec.id} did not complete — DB at ${dbFile} is incomplete`)
    process.exit(1)
  }
  console.log()
}