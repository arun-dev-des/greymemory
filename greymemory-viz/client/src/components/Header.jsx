// Header.jsx
//
// Top bar: brand (left) · dataset picker (center) · mode switcher (right).

import { DatasetPicker } from './DatasetPicker.jsx'

const MODES = [
  { key: 'explore',  label: 'explore',  desc: 'pan and inspect' },
  { key: 'debug',    label: 'debug',    desc: 'live retrieval' },
  { key: 'scrubber', label: 'scrubber', desc: 'replay over time' },
  { key: 'showcase', label: 'showcase', desc: 'static render' },
]

export function Header({
  mode,
  onModeChange,
  liveSearchAvailable,
  datasets,
  selectedDataset,
  selectedContainer,
  onContextChange,
  loading,
}) {
  return (
    <div className="header">
      <div className="brand">
        <span className="brand-mark serif">greymemory</span>
        <span className="brand-sub muted">/ graph</span>
      </div>

      <DatasetPicker
        datasets={datasets}
        selectedDataset={selectedDataset}
        selectedContainer={selectedContainer}
        onChange={onContextChange}
        loading={loading}
      />

      <div className="mode-switcher">
        {MODES.map(m => {
          const disabled = m.key === 'debug' && !liveSearchAvailable
          return (
            <button
              key={m.key}
              className={mode === m.key ? 'active' : ''}
              onClick={() => onModeChange(m.key)}
              disabled={disabled}
              title={disabled ? 'live search disabled — set OPENAI_API_KEY in server/.env' : m.desc}
            >
              {m.label}
            </button>
          )
        })}
      </div>

      <style>{`
        .header {
          position: fixed;
          top: 16px;
          left: 16px;
          right: 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 16px;
          z-index: 10;
          pointer-events: none;
        }
        .header > * { pointer-events: auto; }

        .brand {
          display: flex;
          align-items: baseline;
          gap: 8px;
          padding: 6px 12px;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          backdrop-filter: blur(8px);
          flex-shrink: 0;
        }
        .brand-mark { font-size: 18px; letter-spacing: 0.01em; color: var(--text); }
        .brand-sub { font-size: 11px; letter-spacing: 0.06em; }

        .mode-switcher {
          display: flex;
          gap: 4px;
          padding: 4px;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          backdrop-filter: blur(8px);
          flex-shrink: 0;
        }
        .mode-switcher button {
          border: 1px solid transparent;
          padding: 5px 12px;
        }
        .mode-switcher button[disabled] { opacity: 0.35; cursor: not-allowed; }
      `}</style>
    </div>
  )
}
