// databases.js — discover .greymemory-bench*/*.db files, expose containers,
// expose facts and version chains via raw SQL. Lazy-opens DB handles with WAL.
//
// Read-only — the diag tool never writes to the live DB. Memory-instantiation
// for live search lives in memory-loader.js (separate concern; only loaded
// when the search endpoint is hit).

import fs        from 'fs'
import path      from 'path'
import Database  from 'better-sqlite3'

const dbCache = new Map()

export function listDatabases(rootDir) {
  const benchmarkDir = path.join(rootDir, 'benchmark')
  if (!fs.existsSync(benchmarkDir)) return []

  const out = []
  for (const entry of fs.readdirSync(benchmarkDir)) {
    if (!entry.startsWith('.greymemory-bench')) continue
    const dir = path.join(benchmarkDir, entry)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.db')) continue
      const abs = path.join(dir, file)
      try {
        const containers = listContainers(abs)
        out.push({ id: `${entry}/${file}`, dir: entry, file, absPath: abs, containers })
      } catch (err) {
        out.push({ id: `${entry}/${file}`, dir: entry, file, absPath: abs, containers: [], error: err.message })
      }
    }
  }
  return out
}

function openDb(absPath) {
  if (dbCache.has(absPath)) return dbCache.get(absPath)
  // Open writable — SQLite in WAL mode needs to update the .shm file even
  // for SELECT-only readers. The diag tool issues only SELECTs at the
  // application layer, so the writable handle is purely a WAL bookkeeping
  // concession. Don't set `readonly: true` or the shm update will fail with
  // "attempt to write a readonly database".
  const db = new Database(absPath, { fileMustExist: true })
  dbCache.set(absPath, db)
  return db
}

function tableExists(db, name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name)
}

export function listContainers(absPath) {
  const db = openDb(absPath)
  if (!tableExists(db, 'facts')) return []
  return db.prepare(`SELECT container, COUNT(*) as fact_count FROM facts GROUP BY container ORDER BY container`).all()
}

export function listFacts(absPath, container) {
  const db = openDb(absPath)
  const facts = db.prepare(`
    SELECT id, key, value, memory_type, confidence, document_date, event_date,
           is_latest, superseded_by, superseded_from, relation_type, related_to,
           chunk_id, source_role, created_at
    FROM facts
    WHERE container = ? AND is_latest = 1
    ORDER BY created_at DESC
  `).all(container)

  // Annotate each fact with version-chain length (cheap follow-up query).
  const chainCount = db.prepare(`
    SELECT COUNT(*) as n FROM facts WHERE container = ? AND
      (id = ? OR superseded_by = ? OR superseded_from = ?)
  `)
  return facts.map(f => ({
    ...f,
    chain_length: chainCount.get(container, f.id, f.id, f.id).n,
  }))
}

export function getFactHistory(absPath, container, factId) {
  const db = openDb(absPath)
  // Walk superseded_from edges backward from the requested id (or its latest).
  // Returns newest-first chain.
  const latestRow = db.prepare(`
    SELECT id, key, value, memory_type, document_date, event_date, is_latest,
           superseded_by, superseded_from, relation_type
    FROM facts WHERE container = ? AND id = ?
  `).get(container, factId)
  if (!latestRow) return { current: null, chain: [] }

  // If this id was superseded, follow forward to the head.
  let head = latestRow
  const seenForward = new Set()
  while (head.superseded_by && !seenForward.has(head.id)) {
    seenForward.add(head.id)
    const next = db.prepare(`SELECT id, key, value, memory_type, document_date, event_date, is_latest, superseded_by, superseded_from, relation_type FROM facts WHERE container = ? AND id = ?`).get(container, head.superseded_by)
    if (!next) break
    head = next
  }

  // Walk backward to build the chain newest-first.
  const chain = [head]
  const seenBack = new Set([head.id])
  let cur = head
  while (cur.superseded_from && !seenBack.has(cur.superseded_from)) {
    const prev = db.prepare(`SELECT id, key, value, memory_type, document_date, event_date, is_latest, superseded_by, superseded_from, relation_type FROM facts WHERE container = ? AND id = ?`).get(container, cur.superseded_from)
    if (!prev) break
    chain.push(prev)
    seenBack.add(prev.id)
    cur = prev
  }
  return { current: head.value, chain }
}

export function getChunk(absPath, chunkId) {
  const db = openDb(absPath)
  if (!tableExists(db, 'chunks')) return null
  return db.prepare(`SELECT id, content, session_id, created_at FROM chunks WHERE id = ?`).get(chunkId)
}
