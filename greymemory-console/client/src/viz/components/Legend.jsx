// Legend.jsx
//
// Bottom-right reference panel. Mirrors the supermemory layout: statistics
// at the top, then nodes, status, connections, relations, similarity legend.
// Numbers come from /api/stats so they reflect the current asOf state.

import { COLOR } from '../lib/graphStyle.js'

export function Legend({ stats, mode }) {
  return (
    <div className="legend">
      <div className="legend-head">
        <span className="serif">legend</span>
      </div>

      <Section title="statistics">
        {stats ? (
          <>
            <Row icon={<Dot color={COLOR.fact} />} text={`${stats.totalMemories} memories`} />
            <Row icon={<DocIcon />} text={`${stats.totalDocuments} documents`} />
            <Row icon={<Dot color={COLOR.UPDATES} />} text={`${stats.totalConnections} connections`} />
          </>
        ) : <span className="faint">—</span>}
      </Section>

      <Section title="nodes">
        <Row icon={<Dot color={COLOR.fact} />}       text="fact" />
        <Row icon={<Dot color={COLOR.preference} />} text="preference" />
        <Row icon={<Dot color={COLOR.episode} />}    text="episode" />
        <Row icon={<Square color={COLOR.chunk} />}   text="chunk (raw source)" />
      </Section>

      <Section title="status">
        <Row icon={<Cross />}                          text="forgotten / expired" />
        <Row icon={<Dot color={COLOR.dimmed} faint />} text="superseded (older)" />
        <Row icon={<Dot color={COLOR.fact} />}         text="latest" />
      </Section>

      <Section title="relations">
        <Row icon={<Line color={COLOR.UPDATES} dashed />} text="updates" />
        <Row icon={<Line color={COLOR.EXTENDS} />}        text="extends" />
        <Row icon={<Line color={COLOR.DERIVES} />}        text="derives" />
        <Row icon={<Line color={COLOR.SOURCE} />}         text="source chunk" />
      </Section>

      {mode === 'debug' && (
        <Section title="retrieval">
          <Row icon={<Dot color={COLOR.seed} />}     text="seed (top match)" />
          <Row icon={<Dot color={COLOR.expanded} />} text="extends expansion" />
          <Row icon={<Dot color={COLOR.history} />}  text="version history" />
        </Section>
      )}

      <style>{`
        .legend {
          position: absolute;
          right: 16px;
          bottom: 16px;
          width: 240px;
          max-height: calc(100vh - 32px);
          overflow-y: auto;
          padding: 14px 16px;
          background: var(--bg-panel);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          z-index: 9;
        }
        .legend-head {
          font-size: 16px;
          margin-bottom: 12px;
          padding-bottom: 10px;
          border-bottom: 1px solid var(--border-soft);
        }
        .legend-section + .legend-section { margin-top: 14px; }
        .legend-section-title {
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--text-faint);
          margin-bottom: 6px;
        }
        .legend-row {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 11px;
          color: var(--text-dim);
          padding: 2px 0;
        }
      `}</style>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="legend-section">
      <div className="legend-section-title">{title}</div>
      {children}
    </div>
  )
}

function Row({ icon, text }) {
  return <div className="legend-row">{icon}<span>{text}</span></div>
}

function Dot({ color, faint }) {
  return <span style={{
    width: 8, height: 8, borderRadius: '50%',
    background: color, display: 'inline-block',
    opacity: faint ? 0.4 : 1,
  }} />
}

function Square({ color }) {
  return <span style={{
    width: 8, height: 8, background: color, display: 'inline-block',
  }} />
}

function Line({ color, dashed }) {
  return (
    <span style={{
      width: 18, height: 0,
      borderTop: `1.5px ${dashed ? 'dashed' : 'solid'} ${color}`,
      display: 'inline-block',
    }} />
  )
}

function Cross() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <path d="M1,1 L9,9 M9,1 L1,9" stroke="#ff6b8a" strokeWidth="1.4" />
    </svg>
  )
}

function DocIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <rect x="1.5" y="0.5" width="6" height="9" stroke="rgba(235,240,245,0.55)" fill="none" />
    </svg>
  )
}
