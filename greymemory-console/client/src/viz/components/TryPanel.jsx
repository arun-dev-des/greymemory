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
      <div className="try-label"><span className="try-dot" />try it · live search over this graph</div>
      <button
        type="button"
        className={`try-q ${running ? 'running' : ''} ${ran || running ? '' : 'pulse'}`}
        onClick={run}
        disabled={running}
      >
        <span className="try-text">{question}</span>
        <span className="try-run">{running ? '◌ running' : ran ? '↻ run again' : '▶ run'}</span>
      </button>
      {(running || ran) && (
        <div className="try-hint">
          {running
            ? 'running memory.search() on the live database…'
            : 'seeds cyan · expansion green · history purple — click to run again'}
        </div>
      )}

      <style>{`
        .try-panel {
          position: absolute;
          top: 70px;
          left: 16px;
          width: 420px;
          max-width: calc(100vw - 32px);
          display: flex;
          flex-direction: column;
          gap: 9px;
          padding: 12px 14px 12px;
          background: var(--bg-elevated);
          border: 1px solid rgba(95, 209, 224, 0.45);
          border-radius: var(--radius);
          box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5), 0 0 28px rgba(95, 209, 224, 0.10);
          z-index: 10;
          transition: border-color 200ms, box-shadow 200ms;
        }
        .try-panel.active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-glow), 0 10px 34px rgba(0, 0, 0, 0.5), 0 6px 24px rgba(95, 209, 224, 0.08);
        }
        .try-label {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.16em;
          color: var(--accent);
        }
        .try-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--accent);
          animation: try-blink 1.4s ease-in-out infinite;
        }
        @keyframes try-blink {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.25; }
        }
        .try-q {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          text-align: left;
          padding: 12px 12px 12px 14px;
          background: rgba(95, 209, 224, 0.10);
          border: 1.5px solid var(--accent);
          border-radius: 10px;
          cursor: pointer;
          transition: background 160ms, box-shadow 160ms, transform 120ms;
        }
        .try-q:hover:not(:disabled) {
          background: rgba(95, 209, 224, 0.18);
          box-shadow: 0 0 0 1px var(--accent-glow), 0 4px 22px rgba(95, 209, 224, 0.3);
          transform: translateY(-1px);
        }
        .try-q:active:not(:disabled) { transform: translateY(0); }
        .try-q:disabled { cursor: progress; }
        .try-text {
          flex: 1;
          font-size: 14px;
          line-height: 1.45;
          color: #f3f6f9;
        }
        /* the CTA chip — solid accent, dark text, radar ping until clicked */
        .try-run {
          flex: none;
          align-self: center;
          padding: 7px 12px;
          border-radius: 999px;
          background: var(--accent);
          color: #06181c;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .try-q.pulse .try-run {
          animation: try-ping 1.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite;
        }
        @keyframes try-ping {
          0%   { box-shadow: 0 0 0 0 rgba(95, 209, 224, 0.55); }
          70%  { box-shadow: 0 0 0 11px rgba(95, 209, 224, 0); }
          100% { box-shadow: 0 0 0 0 rgba(95, 209, 224, 0); }
        }
        .try-q.running .try-run { animation: try-throb 0.9s ease-in-out infinite; }
        @keyframes try-throb {
          0%, 100% { opacity: 1; }
          50%      { opacity: 0.55; }
        }
        @media (prefers-reduced-motion: reduce) {
          .try-q.pulse .try-run, .try-q.running .try-run, .try-dot { animation: none; }
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
