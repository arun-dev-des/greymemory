import React, { useEffect, useState } from 'react'

export default function RunsPage() {
  const [runs, setRuns] = useState(null)
  const [err, setErr]   = useState(null)

  useEffect(() => {
    fetch('/api/runs')
      .then(r => r.json())
      .then(setRuns)
      .catch(e => setErr(e.message))
  }, [])

  if (err) return <ErrorBox msg={err} />
  if (!runs) return <p>Loading…</p>
  if (runs.length === 0) return <p>No runs found in <code>benchmark/results/</code>.</p>

  return (
    <div>
      <h2>Benchmark runs ({runs.length})</h2>
      <p style={{ color: 'var(--muted)' }}>One row per <code>run-*.json</code>. Newest first.</p>
      <table>
        <thead>
          <tr>
            <th>Timestamp</th>
            <th>Questions</th>
            <th>Accuracy</th>
            <th>Cost</th>
            <th>Categories</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className="clickable" onClick={() => window.location.hash = `#/runs/${r.id}`}>
              <td><code>{r.timestamp}</code></td>
              <td>{r.total ?? '—'}</td>
              <td>{formatAcc(r.accuracy)}</td>
              <td>{r.cost_usd != null ? `$${r.cost_usd.toFixed(4)}` : '—'}</td>
              <td style={{ color: 'var(--muted)', fontSize: 12 }}>{(r.categories ?? []).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatAcc(a) {
  if (a == null) return '—'
  const pct = (a * 100).toFixed(0)
  const cls = a >= 0.8 ? 'good' : a >= 0.5 ? 'warn' : 'bad'
  return <span className={`badge ${cls}`}>{pct}%</span>
}

export function ErrorBox({ msg }) {
  return <div style={{ background: 'rgba(224,108,112,0.1)', border: '1px solid var(--bad)', padding: 12, borderRadius: 4, color: 'var(--bad)' }}><strong>Error:</strong> {msg}</div>
}
