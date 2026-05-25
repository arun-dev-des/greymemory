import React, { useState } from 'react'

export default function SearchPanel({ dbId, container }) {
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState(null)
  const [err, setErr]         = useState(null)
  const [busy, setBusy]       = useState(false)

  async function run() {
    if (!query.trim()) return
    setBusy(true)
    setErr(null)
    setResults(null)
    try {
      const r = await fetch(`/api/dbs/${encodeURIComponent(dbId)}/containers/${encodeURIComponent(container)}/search`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ query, topN: 10 }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `${r.status}`)
      setResults(j.results)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          type="text"
          placeholder="Search query (uses live Memory.search — needs VOYAGE_API_KEY)"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          style={{ flex: 1 }}
        />
        <button onClick={run} disabled={busy || !query.trim()} className="primary">
          {busy ? 'Searching…' : 'Search'}
        </button>
      </div>

      {err && <div style={{ color: 'var(--bad)', padding: 8 }}>Error: {err}</div>}

      {results && (
        <div>
          <p style={{ color: 'var(--muted)', fontSize: 12 }}>{results.length} results</p>
          {results.map((r, i) => (
            <div key={i} style={{ padding: 8, borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--muted)' }}>[{i + 1}]</span>
                <span>{r.memory || <em style={{ color: 'var(--muted)' }}>(no atomic memory)</em>}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 11 }}>
                  {r.memory_type} · dd={r.document_date ?? '—'} · {r.session_id ?? 'no session'}
                </span>
              </div>
              {r.chunk && r.chunk !== r.memory && (
                <details>
                  <summary style={{ color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>chunk ▾</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{r.chunk}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
