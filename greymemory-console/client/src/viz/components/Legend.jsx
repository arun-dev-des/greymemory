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
        {stats && (
          <span className="legend-stats">
            {stats.totalMemories} memories · {stats.totalDocuments} docs · {stats.totalConnections} links
          </span>
        )}
      </div>

      <Section title="nodes">
        <Row icon={<Dot color={COLOR.fact} />}       text="fact" />
        <Row icon={<Dot color={COLOR.preference} />} text="preference" />
        <Row icon={<Dot color={COLOR.episode} />}    text="episode" />
        <Row icon={<Square color={COLOR.chunk} />}   text="raw chunk" />
      </Section>

      <Section title="status">
        <Row icon={<Cross />}                          text="expired" />
        <Row icon={<Dot color={COLOR.dimmed} faint />} text="superseded" />
        <Row icon={<Dot color={COLOR.fact} />}         text="latest" />
      </Section>

      <Section title="relations">
        <Row icon={<Line color={COLOR.UPDATES} dashed />} text="updates" />
        <Row icon={<Line color={COLOR.EXTENDS} />}        text="extends" />
        <Row icon={<Line color={COLOR.DERIVES} />}        text="derives" />
        <Row icon={<Line color={COLOR.SOURCE} />}         text="source" />
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
          top: 70px;
          bottom: auto;
          width: 264px;
          /* compact: two columns of short-labelled swatches keep it tiny */
          max-height: min(40vh, calc(100% - 86px));
          overflow-y: auto;
          padding: 10px 13px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
          z-index: 9;
        }
        .legend-head {
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 13px;
          margin-bottom: 7px;
          padding-bottom: 7px;
          border-bottom: 1px solid var(--border-soft);
        }
        .legend-stats {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 10px;
          letter-spacing: 0.02em;
          color: var(--text-faint);
          white-space: nowrap;
        }
        .legend-section {
          display: grid;
          grid-template-columns: 1fr 1fr;
          grid-auto-rows: 22px;   /* compact, uniform rows without overlap */
          column-gap: 14px;
          row-gap: 0;
          align-content: start;
        }
        .legend-section-title { align-self: end; }
        .legend-section + .legend-section { margin-top: 6px; }
        .legend-section-title {
          grid-column: 1 / -1;
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--text-faint);
          margin-bottom: 2px;
        }
        .legend-row {
          display: flex;
          align-items: center;
          gap: 8px;
          height: 18px;
          font-size: 11px;
          line-height: 1;
          color: var(--text-dim);
          padding: 0;
          white-space: nowrap;
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
