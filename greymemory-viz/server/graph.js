// graph.js
//
// Builds the graph payload from a GreyMemory SQLite database.
// Pure read-only SQL — no LLM calls, no embedder, no extractor needed.
// The frontend uses this for the Explore, Showcase, and Time Scrubber modes.
//
// The payload shape is designed for react-force-graph-2d:
//
//   {
//     nodes: [{ id, type, label, memory_type, is_latest, ... }],
//     links: [{ source, target, relation }]
//   }
//
// Two node types: 'memory' (a fact row) and 'chunk' (a chunks row).
// Three relation types between memories: UPDATES, EXTENDS, DERIVES.
// One relation type between memory and chunk: SOURCE.

import Database from 'better-sqlite3'
import path from 'path'

export function openDb(dir) {
  const dbPath = path.resolve(dir, 'greymemory.db')
  // Not readonly: GreyMemory's Storage runs idempotent _migrate() on construction,
  // which needs write access. The viz itself only reads — the writable handle
  // is just so we can hand it to Storage if live search is enabled.
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  return db
}

/**
 * Build the full graph for a container.
 *
 * @param {Database} db
 * @param {string}   container
 * @param {object}   opts
 * @param {string}   [opts.asOf]            ISO date — only include facts up to this date
 * @param {boolean}  [opts.includeChunks]   include chunk nodes (default true)
 * @param {boolean}  [opts.includeOlder]    include is_latest=0 facts (default true — needed for version chains)
 */
export function buildGraph(db, container, opts = {}) {
  const {
    asOf = null,
    includeChunks = true,
    includeOlder = true,
  } = opts

  // Time-travel: when asOf is set, we only include facts whose document_date
  // is <= asOf. For supersession history, we still walk the chain but only
  // surface versions that existed at asOf.
  const dateClause = asOf ? `AND document_date <= ?` : ''
  const dateParams = asOf ? [asOf] : []

  const latestClause = includeOlder ? '' : `AND is_latest = 1`

  const facts = db.prepare(`
    SELECT
      id, key, value, memory_type, document_date, event_date, expires_at,
      is_latest, superseded_by, superseded_from, relation_type, related_to,
      chunk_id, source_role, confidence, created_at
    FROM facts
    WHERE container = ?
      ${latestClause}
      ${dateClause}
    ORDER BY id ASC
  `).all(container, ...dateParams)

  const chunks = includeChunks
    ? db.prepare(`
        SELECT id, content, source_role, session_id, created_at
        FROM chunks
        WHERE container = ?
          ${asOf ? `AND created_at <= ?` : ''}
        ORDER BY id ASC
      `).all(container, ...(asOf ? [asOf] : []))
    : []

  // Determine "expired" relative to asOf or today
  const expiryRef = asOf ? asOf.slice(0, 10) : new Date().toISOString().slice(0, 10)

  const nodes = []
  const factIds = new Set()

  for (const f of facts) {
    factIds.add(f.id)
    nodes.push({
      id: `fact_${f.id}`,
      type: 'memory',
      memoryId: f.id,
      label: f.key,
      value: f.value,
      memory_type: f.memory_type,
      is_latest: f.is_latest === 1,
      is_expired: f.expires_at && f.expires_at <= expiryRef,
      document_date: f.document_date,
      event_date: f.event_date,
      expires_at: f.expires_at,
      source_role: f.source_role,
      confidence: f.confidence,
      chunk_id: f.chunk_id,
      relation_type: f.relation_type,
      created_at: f.created_at,
    })
  }

  if (includeChunks) {
    for (const c of chunks) {
      nodes.push({
        id: `chunk_${c.id}`,
        type: 'chunk',
        chunkId: c.id,
        label: `chunk #${c.id}`,
        value: c.content,
        source_role: c.source_role,
        created_at: c.created_at,
      })
    }
  }

  // Build links
  const links = []

  for (const f of facts) {
    // UPDATES: this fact replaces an older one (superseded_from points back)
    if (f.superseded_from && factIds.has(f.superseded_from)) {
      links.push({
        source: `fact_${f.superseded_from}`,
        target: `fact_${f.id}`,
        relation: 'UPDATES',
      })
    }

    // EXTENDS: this fact refines another (related_to points to the parent)
    if (f.relation_type === 'EXTENDS' && f.related_to && factIds.has(f.related_to)) {
      links.push({
        source: `fact_${f.related_to}`,
        target: `fact_${f.id}`,
        relation: 'EXTENDS',
      })
    }

    // DERIVES: this fact was inferred from one or more others
    // related_to holds the primary source; metadata.fromIds may hold all of them
    if (f.relation_type === 'DERIVES' && f.related_to && factIds.has(f.related_to)) {
      // Try to read the full fromIds list from metadata; fall back to related_to
      const meta = readMetadata(db, f.id)
      const fromIds = Array.isArray(meta?.fromIds) ? meta.fromIds : [f.related_to]
      for (const fromId of fromIds) {
        if (factIds.has(fromId)) {
          links.push({
            source: `fact_${fromId}`,
            target: `fact_${f.id}`,
            relation: 'DERIVES',
          })
        }
      }
    }

    // SOURCE: link fact to the chunk it was extracted from
    if (includeChunks && f.chunk_id) {
      links.push({
        source: `chunk_${f.chunk_id}`,
        target: `fact_${f.id}`,
        relation: 'SOURCE',
      })
    }
  }

  return { nodes, links }
}

function readMetadata(db, factId) {
  const row = db.prepare(`SELECT metadata FROM facts WHERE id = ?`).get(factId)
  if (!row?.metadata) return null
  try { return JSON.parse(row.metadata) } catch { return null }
}

/**
 * Statistics for the legend panel — matches the supermemory layout.
 */
export function buildStats(db, container, asOf = null) {
  const dateClause = asOf ? `AND document_date <= ?` : ''
  const dateParams = asOf ? [asOf] : []

  const totalMemories = db.prepare(`
    SELECT COUNT(*) as n FROM facts
    WHERE container = ? AND is_latest = 1 ${dateClause}
  `).get(container, ...dateParams).n

  const totalConnections = db.prepare(`
    SELECT COUNT(*) as n FROM facts
    WHERE container = ?
      AND (
        (relation_type IN ('EXTENDS', 'DERIVES') AND related_to IS NOT NULL)
        OR superseded_from IS NOT NULL
      )
      ${dateClause}
  `).get(container, ...dateParams).n

  const totalDocuments = db.prepare(`
    SELECT COUNT(DISTINCT document_date) as n FROM facts
    WHERE container = ? ${dateClause}
  `).get(container, ...dateParams).n

  const byType = db.prepare(`
    SELECT memory_type, COUNT(*) as n FROM facts
    WHERE container = ? AND is_latest = 1 ${dateClause}
    GROUP BY memory_type
  `).all(container, ...dateParams)

  // Date range — used by the time scrubber to determine slider bounds
  const range = db.prepare(`
    SELECT
      MIN(document_date) as earliest,
      MAX(document_date) as latest
    FROM facts
    WHERE container = ?
  `).get(container)

  return {
    totalMemories,
    totalConnections,
    totalDocuments,
    byType: Object.fromEntries(byType.map(r => [r.memory_type, r.n])),
    earliest: range?.earliest ?? null,
    latest: range?.latest ?? null,
  }
}

/**
 * Resolve a single memory's full detail — for the inspect panel.
 * Includes the chunk content and the version chain.
 */
export function getMemoryDetail(db, factId) {
  const fact = db.prepare(`SELECT * FROM facts WHERE id = ?`).get(factId)
  if (!fact) return null

  const chunk = fact.chunk_id
    ? db.prepare(`SELECT * FROM chunks WHERE id = ?`).get(fact.chunk_id)
    : null

  // Walk backward via superseded_from to build full version history
  const chain = [fact]
  let node = fact
  let hops = 0
  while (node.superseded_from && hops++ < 20) {
    const prev = db.prepare(`SELECT * FROM facts WHERE id = ?`).get(node.superseded_from)
    if (!prev) break
    chain.push(prev)
    node = prev
  }

  // Walk forward via superseded_by
  const successors = []
  let next = fact
  hops = 0
  while (next.superseded_by && hops++ < 20) {
    const succ = db.prepare(`SELECT * FROM facts WHERE id = ?`).get(next.superseded_by)
    if (!succ) break
    successors.push(succ)
    next = succ
  }

  // Find facts that extend this one or derive from it
  const extendsFrom = db.prepare(`
    SELECT id, key, value, memory_type FROM facts
    WHERE related_to = ? AND relation_type = 'EXTENDS' AND is_latest = 1
  `).all(factId)

  const derivedFrom = db.prepare(`
    SELECT id, key, value, memory_type FROM facts
    WHERE related_to = ? AND relation_type = 'DERIVES' AND is_latest = 1
  `).all(factId)

  return {
    fact,
    chunk: chunk ? { id: chunk.id, content: chunk.content, source_role: chunk.source_role, created_at: chunk.created_at } : null,
    history: chain.slice(1),     // older versions, newest-first
    successors,                  // newer versions if this is a stale node
    extendedBy: extendsFrom,
    derivations: derivedFrom,
  }
}
