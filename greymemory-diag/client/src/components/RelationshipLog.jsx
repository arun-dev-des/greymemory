import React, { useMemo, useState } from 'react'

export default function RelationshipLog({ entries = [] }) {
  const [filterType, setFilterType] = useState('')
  const [filterReason, setFilterReason] = useState('')
  const [expanded, setExpanded] = useState(new Set())

  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (filterType   && e.decision?.type !== filterType) return false
      if (filterReason && e.reason !== filterReason) return false
      return true
    })
  }, [entries, filterType, filterReason])

  if (entries.length === 0) {
    return <div style={{ padding: 16, color: 'var(--muted)' }}>No relationship-classifier log for this question (pre-Task-5.1 run, or no decisions made during ingestion).</div>
  }

  const counts = entries.reduce((acc, e) => {
    acc[e.decision?.type] = (acc[e.decision?.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div>
      <div style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>
          {Object.entries(counts).map(([t, n]) => (
            <span key={t} style={{ marginRight: 8 }}>
              <strong style={{ color: 'var(--text)' }}>{t}</strong>: {n}
            </span>
          ))}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}>
            <option value="">all types</option>
            <option value="UPDATES">UPDATES</option>
            <option value="EXTENDS">EXTENDS</option>
            <option value="NEW">NEW</option>
          </select>
          <select value={filterReason} onChange={e => setFilterReason(e.target.value)}>
            <option value="">all reasons</option>
            <option value="llm">llm</option>
            <option value="no_candidates">no_candidates</option>
            <option value="llm_failed">llm_failed</option>
          </select>
        </div>
      </div>

      <div>
        {filtered.map((e, i) => {
          const open = expanded.has(i)
          return (
            <div key={i} className="rl-row" onClick={() => {
              const n = new Set(expanded)
              open ? n.delete(i) : n.add(i)
              setExpanded(n)
            }}>
              <div className="summary">
                <span className={`badge ${badgeFor(e.decision?.type)}`}>{e.decision?.type}</span>
                <span style={{ color: 'var(--text)' }}>
                  <code style={{ color: 'var(--muted)' }}>{e.new_fact?.key}</code>{' = '}
                  "{(e.new_fact?.value ?? '').slice(0, 90)}{(e.new_fact?.value ?? '').length > 90 ? '…' : ''}"
                </span>
                <span style={{ color: 'var(--muted)', fontSize: 11, textAlign: 'right' }}>
                  {e.candidate_count} cand · {e.reason}
                </span>
              </div>
              {open && (
                <div className="detail">
                  <div><span className="label">new_fact:</span><pre>{JSON.stringify(e.new_fact, null, 2)}</pre></div>
                  <div><span className="label">decision:</span> {JSON.stringify(e.decision)} (relatedTo {e.decision?.relatedTo == null ? <strong style={{ color: 'var(--bad)' }}>null</strong> : e.decision.relatedTo})</div>
                  <div><span className="label">top_candidate:</span><pre>{JSON.stringify(e.top_candidate, null, 2)}</pre></div>
                  <div><span className="label">candidates ({e.candidate_count}):</span>
                    {e.candidates?.length > 0 ? (
                      <ol style={{ margin: '4px 0', paddingLeft: 24, fontSize: 12 }}>
                        {e.candidates.map(c => (
                          <li key={c.id}>
                            <code>[id={c.id}]</code> <code style={{ color: 'var(--muted)' }}>{c.key}</code>{': '}
                            "{(c.value ?? '').slice(0, 100)}{(c.value ?? '').length > 100 ? '…' : ''}"
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}> ({c.memory_type}, dd={c.document_date ?? '—'})</span>
                          </li>
                        ))}
                      </ol>
                    ) : <em style={{ color: 'var(--muted)' }}> (no candidates)</em>}
                  </div>
                  {e.llm_raw && <div><span className="label">llm_raw:</span><pre style={{ whiteSpace: 'pre-wrap' }}>{e.llm_raw}</pre></div>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function badgeFor(type) {
  if (type === 'UPDATES') return 'warn'
  if (type === 'EXTENDS') return 'good'
  if (type === 'NEW')     return 'neutral'
  return 'neutral'
}
