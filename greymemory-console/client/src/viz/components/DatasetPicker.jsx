// DatasetPicker.jsx
//
// Two dropdowns in the header bar — pick a dataset (db file), then a
// container (question number). Fact counts show next to each container
// so you can avoid landing on an empty one.
//
// When the dataset changes, container resets to the first available one
// in the new dataset (handled in App.jsx).

export function DatasetPicker({
  datasets,
  selectedDataset,
  selectedContainer,
  onChange,
  loading,
}) {
  const current = datasets.find(d => d.id === selectedDataset)
  const containers = current?.containers ?? []

  return (
    <div className="picker">
      <div className="picker-group">
        <label className="picker-label">dataset</label>
        <select
          value={selectedDataset ?? ''}
          onChange={(e) => onChange({ dataset: e.target.value, container: null })}
          disabled={loading || datasets.length === 0}
        >
          {datasets.length === 0 && <option value="">no datasets found</option>}
          {datasets.map(d => (
            <option key={d.id} value={d.id}>
              {d.id}
            </option>
          ))}
        </select>
      </div>

      <div className="picker-divider" />

      <div className="picker-group">
        <label className="picker-label">container</label>
        <select
          value={selectedContainer ?? ''}
          onChange={(e) => onChange({ dataset: selectedDataset, container: e.target.value })}
          disabled={loading || containers.length === 0}
        >
          {containers.length === 0 && <option value="">—</option>}
          {containers.map(c => (
            <option key={c.id} value={c.id}>
              {c.id} {c.factCount > 0 ? `· ${c.factCount}` : ''}
            </option>
          ))}
        </select>
      </div>

      <style>{`
        .picker {
          display: flex;
          align-items: stretch;
          gap: 0;
          padding: 4px 8px;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          backdrop-filter: blur(8px);
        }
        .picker-group {
          display: flex;
          flex-direction: column;
          justify-content: center;
          padding: 4px 12px;
          min-width: 100px;
        }
        .picker-label {
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--text-faint);
          margin-bottom: 2px;
        }
        .picker select {
          background: transparent;
          border: none;
          color: var(--text);
          font-family: var(--font-mono);
          font-size: 12px;
          padding: 2px 18px 2px 0;
          cursor: pointer;
          outline: none;
          appearance: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(235,240,245,0.5)' d='M0 0l5 6 5-6z'/></svg>");
          background-repeat: no-repeat;
          background-position: right center;
        }
        .picker select:focus {
          color: var(--accent);
        }
        .picker select:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .picker select option {
          background: var(--bg-elevated);
          color: var(--text);
        }
        .picker-divider {
          width: 1px;
          background: var(--border-soft);
        }
      `}</style>
    </div>
  )
}
