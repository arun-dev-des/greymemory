// api.js — fetch wrapper. Every endpoint takes dataset+container.

async function get(path) {
  const r = await fetch(path)
  if (!r.ok) {
    let msg = `${path} → ${r.status}`
    try { const data = await r.json(); if (data?.error) msg = data.error } catch {}
    throw new Error(msg)
  }
  return r.json()
}

async function post(path, body) {
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? `${path} → ${r.status}`)
  return data
}

function qs(params) {
  return new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')
  ).toString()
}

// All paths are under /api/viz (the console mounts the Visualizer router there).
export const api = {
  // Discovery — no dataset/container needed
  datasets: () => get('/api/viz/datasets'),
  health:   () => get('/api/viz/health'),

  // Per-dataset, per-container reads
  graph:  ({ dataset, container, asOf = null }) =>
    get(`/api/viz/graph?${qs({ dataset, container, asOf })}`),

  stats:  ({ dataset, container, asOf = null }) =>
    get(`/api/viz/stats?${qs({ dataset, container, asOf })}`),

  memory: ({ dataset, id }) =>
    get(`/api/viz/memory/${id}?${qs({ dataset })}`),

  // The LongMemEval question whose id equals this container (benchmark DBs).
  // Returns { question: null } when there's no mapping (e.g. scenario DBs).
  question: (container) =>
    get(`/api/viz/question/${encodeURIComponent(container)}`),

  search: ({ dataset, container, query, topN = 8, expandViaGraph = true }) =>
    post('/api/viz/search', { dataset, container, query, topN, expandViaGraph }),
}