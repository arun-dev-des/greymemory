import React from 'react'

export default function RetrievalList({ retrieved = [], goldSessions = [] }) {
  const gold = new Set(goldSessions)
  return (
    <div>
      {retrieved.map((r, i) => {
        const isGold = r.session_id && gold.has(r.session_id)
        return (
          <div key={i} className={`retrieval-item ${isGold ? 'gold' : ''}`}>
            <div className="rank">[{i + 1}]</div>
            <div className="text">
              <div className={`memory ${!r.memory ? 'empty' : ''}`}>
                {r.memory || '(no atomic memory — chunk-only result)'}
              </div>
              {r.chunk && r.chunk !== r.memory && (
                <details>
                  <summary style={{ color: 'var(--muted)', fontSize: 11, cursor: 'pointer' }}>chunk preview ▾</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{r.chunk}</pre>
                </details>
              )}
            </div>
            <div className="meta">
              {r.session_id && <div>{isGold && '⭐ '}{r.session_id}</div>}
              {r.document_date && <div>dd: {r.document_date}</div>}
              {r.event_date    && <div>ed: {r.event_date}</div>}
              {r.relation_type && <div>{r.relation_type}</div>}
              {r.memory_type   && <div style={{ color: 'var(--accent)' }}>{r.memory_type}</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
