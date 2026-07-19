// RetrievalReport.jsx
//
// Bottom-left panel — appears in debug mode after a search. Shows the actual
// shape of what `search()` returned, broken into its three layers (seeds,
// expansions, history), with the values, dates, and any expansion provenance.
//
// Click any result to jump to that node in the graph.

export function RetrievalReport({ retrieval, onJumpTo }) {
  if (retrieval?.error) {
    return (
      <div className="report">
        <div className="report-head">
          <span className="serif">retrieval</span>
          <span className="report-query mono">{retrieval.query}</span>
        </div>
        <div className="error">error: {retrieval.error}</div>
        {style}
      </div>
    )
  }

  const seeds = retrieval.results.filter(r => !r._expansion)
  const expanded = retrieval.results.filter(r => r._expansion?.via === 'EXTENDS')
  const history = retrieval.results.filter(r => r._expansion?.via === 'UPDATES_HISTORY')

  return (
    <div className="report">
      <div className="report-head">
        <span className="serif">retrieval</span>
        <span className="report-query mono">→ {retrieval.query}</span>
      </div>

      {seeds.length > 0 && (
        <Block title="seeds" color="var(--accent)" count={seeds.length}>
          {seeds.map((r, i) => <ResultRow key={i} r={r} onJumpTo={onJumpTo} />)}
        </Block>
      )}

      {expanded.length > 0 && (
        <Block title="extends expansion" color="var(--r-extends)" count={expanded.length}>
          {expanded.map((r, i) => <ResultRow key={i} r={r} onJumpTo={onJumpTo} />)}
        </Block>
      )}

      {history.length > 0 && (
        <Block title="version history" color="var(--r-updates)" count={history.length}>
          {history.map((r, i) => <ResultRow key={i} r={r} onJumpTo={onJumpTo} />)}
        </Block>
      )}

      {style}
    </div>
  )
}

function Block({ title, color, count, children }) {
  return (
    <div className="report-block">
      <div className="report-block-head">
        <span style={{ color }}>{title}</span>
        <span className="faint">·</span>
        <span className="faint">{count}</span>
      </div>
      {children}
    </div>
  )
}

function ResultRow({ r, onJumpTo }) {
  return (
    <div
      className={`result ${r._matchedNodeId ? 'jumpable' : ''}`}
      onClick={() => r._matchedNodeId && onJumpTo(r._matchedNodeId)}
    >
      <div className="result-text">{r.memory ?? r.chunk}</div>
      <div className="result-meta">
        {r.memory_type && <span className={`tag tag-${r.memory_type}`}>{r.memory_type}</span>}
        {r.document_date && <span className="faint mono">{r.document_date}</span>}
        {r._expansion?.depth != null && <span className="faint mono">depth {r._expansion.depth}</span>}
        {r.source_role && <span className="faint mono">{r.source_role}</span>}
      </div>
    </div>
  )
}

const style = (
  <style>{`
    .report {
      position: absolute;
      left: 16px;
      bottom: 16px;
      width: 380px;
      /* stay clear of the TryPanel above (top 70px + ~200px tall) — the panel
         must never cover the report head / "seeds" heading */
      max-height: calc(100vh - 300px);
      overflow-y: auto;
      padding: 14px 16px;
      background: var(--bg-panel);
      backdrop-filter: blur(10px);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      z-index: 9;
    }
    .report-head {
      display: flex;
      align-items: baseline;
      gap: 10px;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid var(--border-soft);
    }
    .report-head .serif { font-size: 16px; }
    .report-query {
      font-size: 11px;
      color: var(--accent);
      letter-spacing: 0.02em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .report-block + .report-block { margin-top: 14px; }
    .report-block-head {
      display: flex;
      align-items: baseline;
      gap: 6px;
      font-size: 10px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      margin-bottom: 6px;
    }
    .result {
      padding: 8px 10px;
      margin-bottom: 4px;
      background: rgba(255,255,255,0.015);
      border: 1px solid var(--border-soft);
      border-radius: var(--radius);
      transition: background 120ms, border-color 120ms;
    }
    .result.jumpable { cursor: pointer; }
    .result.jumpable:hover {
      background: rgba(95, 209, 224, 0.04);
      border-color: rgba(95, 209, 224, 0.2);
    }
    .result-text {
      font-size: 11px;
      line-height: 1.45;
      color: var(--text);
      margin-bottom: 4px;
    }
    .result-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      font-size: 9px;
    }
    .error {
      color: var(--danger);
      font-size: 11px;
      padding: 8px 0;
    }
  `}</style>
)
