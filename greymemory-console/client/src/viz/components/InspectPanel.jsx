// InspectPanel.jsx
//
// Slides in from the right when a node is clicked. Shows full detail:
//  • the value (the actual fact text)
//  • metadata: type, dates, source, confidence
//  • the chunk it was extracted from
//  • version history (older versions, newer versions)
//  • outgoing relations (extends / derived)
//
// For chunk nodes, shows the raw content.

export function InspectPanel({ node, detail, onClose }) {
  if (!node) return null

  return (
    <aside className="inspect">
      <button className="inspect-close" onClick={onClose} aria-label="close">×</button>

      {node.type === 'chunk' ? <ChunkView node={node} /> : <MemoryView node={node} detail={detail} />}

      <style>{`
        .inspect {
          position: absolute;
          top: 16px;
          right: 16px;
          bottom: 16px;
          width: 380px;
          max-width: calc(100vw - 32px);
          padding: 18px 20px 20px;
          background: var(--bg-panel);
          backdrop-filter: blur(12px);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          overflow-y: auto;
          z-index: 11;
          animation: slidein 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
        }
        @keyframes slidein {
          from { transform: translateX(20px); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        .inspect-close {
          position: absolute;
          top: 12px;
          right: 14px;
          border: none;
          padding: 0;
          width: 24px;
          height: 24px;
          font-size: 18px;
          color: var(--text-faint);
          background: transparent;
        }
        .inspect-close:hover {
          color: var(--text);
          background: transparent;
        }
        .inspect h2 {
          font-family: var(--font-display);
          font-size: 22px;
          font-weight: 400;
          margin: 0 0 4px;
          padding-right: 24px;
          letter-spacing: 0.005em;
          line-height: 1.2;
        }
        .inspect .key {
          font-size: 10px;
          letter-spacing: 0.16em;
          text-transform: uppercase;
          color: var(--text-faint);
          margin-bottom: 14px;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 80px 1fr;
          gap: 6px 12px;
          font-size: 11px;
          margin: 16px 0;
          padding: 12px 0;
          border-top: 1px solid var(--border-soft);
          border-bottom: 1px solid var(--border-soft);
        }
        .meta-grid .label {
          color: var(--text-faint);
          letter-spacing: 0.1em;
          text-transform: uppercase;
          font-size: 9px;
          padding-top: 1px;
        }
        .meta-grid .value {
          color: var(--text);
        }
        .section-title {
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--text-faint);
          margin: 16px 0 8px;
        }
        .history-item, .relation-item {
          padding: 8px 10px;
          margin-bottom: 6px;
          background: rgba(255,255,255,0.02);
          border: 1px solid var(--border-soft);
          border-radius: var(--radius);
          font-size: 11px;
          line-height: 1.4;
        }
        .history-item .when {
          font-size: 9px;
          letter-spacing: 0.06em;
          color: var(--text-faint);
          margin-bottom: 3px;
        }
        .chunk-content {
          font-size: 11px;
          line-height: 1.5;
          color: var(--text-dim);
          white-space: pre-wrap;
          padding: 10px 12px;
          background: rgba(95, 209, 224, 0.04);
          border: 1px solid rgba(95, 209, 224, 0.15);
          border-radius: var(--radius);
          margin-top: 6px;
          max-height: 200px;
          overflow-y: auto;
        }
      `}</style>
    </aside>
  )
}

function MemoryView({ node, detail }) {
  return (
    <>
      <h2>{node.value}</h2>
      <div className="key">{node.label}</div>

      <div className="meta-grid">
        <span className="label">type</span>
        <span className="value"><span className={`tag tag-${node.memory_type}`}>{node.memory_type}</span></span>

        <span className="label">recorded</span>
        <span className="value">{node.document_date ?? '—'}</span>

        {node.event_date && <>
          <span className="label">event</span>
          <span className="value">{node.event_date}</span>
        </>}

        {node.expires_at && <>
          <span className="label">expires</span>
          <span className="value">{node.expires_at} {node.is_expired && <span style={{ color: 'var(--danger)' }}>(expired)</span>}</span>
        </>}

        <span className="label">source</span>
        <span className="value">{node.source_role ?? '—'}</span>

        <span className="label">confidence</span>
        <span className="value">{node.confidence?.toFixed(2) ?? '—'}</span>

        <span className="label">latest</span>
        <span className="value">{node.is_latest ? 'yes' : 'superseded'}</span>
      </div>

      {detail?.chunk && (
        <>
          <div className="section-title">source chunk</div>
          <div className="chunk-content">{detail.chunk.content}</div>
        </>
      )}

      {detail?.history?.length > 0 && (
        <>
          <div className="section-title">version history ({detail.history.length})</div>
          {detail.history.map(h => (
            <div key={h.id} className="history-item">
              <div className="when">{h.document_date}</div>
              <div>{h.value}</div>
            </div>
          ))}
        </>
      )}

      {detail?.successors?.length > 0 && (
        <>
          <div className="section-title">superseded by</div>
          {detail.successors.map(s => (
            <div key={s.id} className="history-item">
              <div className="when">{s.document_date}</div>
              <div>{s.value}</div>
            </div>
          ))}
        </>
      )}

      {detail?.extendedBy?.length > 0 && (
        <>
          <div className="section-title">extended by ({detail.extendedBy.length})</div>
          {detail.extendedBy.map(e => (
            <div key={e.id} className="relation-item">
              <span className="tag tag-fact" style={{ marginRight: 6 }}>extends</span>
              {e.value}
            </div>
          ))}
        </>
      )}

      {detail?.derivations?.length > 0 && (
        <>
          <div className="section-title">derivations ({detail.derivations.length})</div>
          {detail.derivations.map(d => (
            <div key={d.id} className="relation-item">
              <span className="tag" style={{ color: 'var(--r-derives)', borderColor: 'rgba(240,182,87,0.3)', marginRight: 6 }}>derives</span>
              {d.value}
            </div>
          ))}
        </>
      )}
    </>
  )
}

function ChunkView({ node }) {
  return (
    <>
      <h2 className="serif">raw chunk</h2>
      <div className="key">#{node.chunkId} · {node.source_role ?? 'unknown source'}</div>

      <div className="meta-grid">
        <span className="label">recorded</span>
        <span className="value">{node.created_at?.slice(0, 10) ?? '—'}</span>

        <span className="label">source</span>
        <span className="value">{node.source_role ?? '—'}</span>
      </div>

      <div className="section-title">content</div>
      <div className="chunk-content">{node.value}</div>
    </>
  )
}
