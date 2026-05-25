import React, { useState } from 'react'

export default function FactsTable({ facts = [], onLoadHistory }) {
  const [expanded, setExpanded] = useState({})  // factId → history payload or 'loading'

  async function toggle(fid) {
    if (expanded[fid]) {
      const n = { ...expanded }
      delete n[fid]
      setExpanded(n)
      return
    }
    setExpanded(s => ({ ...s, [fid]: 'loading' }))
    try {
      const h = await onLoadHistory(fid)
      setExpanded(s => ({ ...s, [fid]: h }))
    } catch (err) {
      setExpanded(s => ({ ...s, [fid]: { error: err.message } }))
    }
  }

  if (facts.length === 0) return <div style={{ padding: 16, color: 'var(--muted)' }}>No facts (is_latest=1) in this container.</div>

  return (
    <table>
      <thead>
        <tr>
          <th>id</th>
          <th>key</th>
          <th>value</th>
          <th>type</th>
          <th>relation</th>
          <th>chain</th>
          <th>dd</th>
        </tr>
      </thead>
      <tbody>
        {facts.map(f => (
          <React.Fragment key={f.id}>
            <tr className="clickable" onClick={() => toggle(f.id)}>
              <td><code>{f.id}</code></td>
              <td><code style={{ color: 'var(--muted)' }}>{f.key}</code></td>
              <td style={{ fontSize: 13 }}>{f.value?.slice(0, 100)}{f.value?.length > 100 ? '…' : ''}</td>
              <td style={{ fontSize: 12 }}>{f.memory_type}</td>
              <td style={{ fontSize: 12 }}>{f.relation_type ?? '—'}</td>
              <td>{f.chain_length > 1 ? <span className="badge warn">{f.chain_length}</span> : f.chain_length}</td>
              <td style={{ fontSize: 11, color: 'var(--muted)' }}>{f.document_date ?? '—'}</td>
            </tr>
            {expanded[f.id] && (
              <tr>
                <td colSpan={7} style={{ background: 'var(--bg)' }}>
                  {expanded[f.id] === 'loading' && <em>loading history…</em>}
                  {expanded[f.id]?.error && <span style={{ color: 'var(--bad)' }}>error: {expanded[f.id].error}</span>}
                  {expanded[f.id]?.chain && (
                    <div style={{ padding: 8 }}>
                      <strong>Version chain (newest first):</strong>
                      <ol style={{ paddingLeft: 24, margin: '8px 0' }}>
                        {expanded[f.id].chain.map(c => (
                          <li key={c.id} style={{ marginBottom: 4 }}>
                            <code>[id={c.id}{c.is_latest ? ' • current' : ''}]</code>{' '}
                            "{c.value}"{' '}
                            <span style={{ color: 'var(--muted)', fontSize: 11 }}>
                              ({c.memory_type}, dd={c.document_date ?? '—'}, rel={c.relation_type ?? '—'})
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  )
}
