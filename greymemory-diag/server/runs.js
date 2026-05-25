// runs.js — discover and read benchmark/results/run-*.json files.
//
// One run file becomes one navigable entry in the UI. The JSONL classifier
// log paired with each run (relationship-decisions-<timestamp>.jsonl) is
// resolved lazily by question_id, not eagerly — files can be 100k+ lines.

import fs   from 'fs'
import path from 'path'
import readline from 'readline'

export function listRunFiles(resultsDir) {
  if (!fs.existsSync(resultsDir)) return []
  return fs.readdirSync(resultsDir)
    .filter(f => /^run-.*\.json$/.test(f))
    .map(f => {
      const abs = path.join(resultsDir, f)
      const stat = fs.statSync(abs)
      return { id: f.replace(/^run-(.+)\.json$/, '$1'), filename: f, absPath: abs, size: stat.size, mtime: stat.mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
}

export function readRunSummary(file) {
  const json = JSON.parse(fs.readFileSync(file.absPath, 'utf8'))
  const total = json.questions?.length ?? json.summary?.total ?? 0
  const correct = json.questions?.filter(q => q.correct).length ?? json.summary?.correct ?? 0
  const acc = total > 0 ? correct / total : null
  const categories = Array.from(new Set((json.questions ?? []).map(q => q.question_type)))
  return {
    id:         file.id,
    filename:   file.filename,
    timestamp:  json.meta?.timestamp ?? file.id,
    total,
    correct,
    accuracy:   acc,
    cost_usd:   json.summary?.cost?.total_usd ?? json.summary?.cost?.total_haiku_usd ?? null,
    categories,
    mtime:      file.mtime,
  }
}

export function readRunFull(file) {
  return JSON.parse(fs.readFileSync(file.absPath, 'utf8'))
}

/**
 * Stream the JSONL log paired with a run, returning entries that match
 * questionId. The pairing convention is identical timestamp suffix:
 *   run-2026-05-25T17-18-51.json
 *   relationship-decisions-2026-05-25T17-18-51.jsonl
 *
 * Returns [] if the JSONL doesn't exist (pre-Task-5.1 runs).
 */
export async function readRelationshipLog(resultsDir, runId, questionId) {
  const jsonlPath = path.join(resultsDir, `relationship-decisions-${runId}.jsonl`)
  if (!fs.existsSync(jsonlPath)) return []

  const rl = readline.createInterface({
    input: fs.createReadStream(jsonlPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })

  const entries = []
  for await (const line of rl) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line)
      if (questionId == null || entry.question_id === questionId) entries.push(entry)
    } catch { /* ignore malformed lines */ }
  }
  return entries
}
