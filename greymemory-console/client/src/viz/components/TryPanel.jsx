// TryPanel.jsx
//
// The public demo's single search affordance: the loaded container's own
// LongMemEval question, presented as one large, obviously-clickable card.
// Replaces the free-text SearchBar on the viz surface — a curated query is
// guaranteed to land in this container, and there's nothing to type.

import { useState } from 'react'

export function TryPanel({ question, onRun, disabled, active }) {
  const [running, setRunning] = useState(false)
  const [ran, setRan] = useState(false)

  if (disabled || !question) return null

  const run = async () => {
    if (running) return
    setRunning(true)
    try {
      await onRun(question)
      setRan(true)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={`try-panel ${active ? 'active' : ''}`}>
      <div className="try-label">try it · live search over this graph</div>
      <button
        type="button"
        className={`try-q ${running ? 'running' : ''} ${ran || running ? '' : 'pulse'}`}
        onClick={run}
        disabled={running}
      >
        <span className="try-arrow">{running ? '◌' : ran ? '↻' : '▶'}</span>
        <span className="try-text">{question}</span>
      </button>
      <div className="try-hint">
        {running
          ? 'running memory.search() on the live database…'
          : ran
            ? 'seeds cyan · expansion green · history purple — click to run again'
            : 'click the question — the graph lights up with what retrieval finds'}
      </div>

      <style>{`
        .try-panel {
          position: absolute;
          top: 70px;
          left: 16px;
          width: 420px;
          max-width: calc(100vw - 32px);
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 12px 14px 12px;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
          z-index: 10;
          transition: border-color 200ms, box-shadow 200ms;
        }
        .try-panel.active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-glow), 0 10px 34px rgba(0, 0, 0, 0.5), 0 6px 24px rgba(95, 209, 224, 0.08);
        }
        .try-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.14em;
          color: var(--accent);
        }
        .try-q {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          width: 100%;
          text-align: left;
          padding: 12px 14px;
          background: rgba(95, 209, 224, 0.06);
          border: 1px solid var(--accent);
          border-radius: 9px;
          cursor: pointer;
          transition: background 160ms, box-shadow 160ms, transform 120ms;
        }
        .try-q:hover:not(:disabled) {
          background: rgba(95, 209, 224, 0.13);
          box-shadow: 0 0 0 1px var(--accent-glow), 0 4px 18px rgba(95, 209, 224, 0.18);
          transform: translateY(-1px);
        }
        .try-q:active:not(:disabled) { transform: translateY(0); }
        .try-q:disabled { cursor: progress; }
        .try-q.pulse {
          animation: try-breathe 2.2s ease-in-out infinite;
        }
        @keyframes try-breathe {
          0%, 100% { box-shadow: 0 0 0 0 rgba(95, 209, 224, 0.0); }
          50%      { box-shadow: 0 0 0 4px rgba(95, 209, 224, 0.14), 0 4px 18px rgba(95, 209, 224, 0.16); }
        }
        @media (prefers-reduced-motion: reduce) {
          .try-q.pulse { animation: none; }
        }
        .try-arrow {
          flex: none;
          color: var(--accent);
          font-size: 12px;
          line-height: 1.5;
        }
        .try-q.running .try-arrow { animation: try-spin 0.9s linear infinite; }
        @keyframes try-spin { to { transform: rotate(360deg); } }
        .try-text {
          flex: 1;
          font-size: 14px;
          line-height: 1.45;
          color: var(--fg, #e5e7eb);
        }
        .try-hint {
          font-size: 11px;
          line-height: 1.5;
          color: var(--fg-faint, #6b7280);
        }
      `}</style>
    </div>
  )
}
