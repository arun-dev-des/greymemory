// TimeScrubber.jsx
//
// Bottom-center slider for replaying the graph over time.
//
// The slider position maps to a date in the [earliest, latest] range. When
// the user drags, we update parent state which triggers a graph refetch with
// asOf=that date. The same asOf is used by GreyMemory's `search()` time
// travel — what you see in the scrubber is what retrieval would have seen
// at that point.
//
// Throttled to avoid hammering the server during a fast drag.

import { useState, useEffect, useRef } from 'react'

export function TimeScrubber({ earliest, latest, value, onChange }) {
  const [localValue, setLocalValue] = useState(value ?? latest)
  const throttleRef = useRef(null)

  // Convert dates to timestamps for the slider math
  const minTs = earliest ? new Date(earliest).getTime() : 0
  const maxTs = latest ? new Date(latest).getTime() : 0
  const valTs = localValue ? new Date(localValue).getTime() : maxTs

  useEffect(() => {
    setLocalValue(value ?? latest)
  }, [value, latest])

  const handleSlide = (e) => {
    const ts = Number(e.target.value)
    const date = new Date(ts).toISOString().slice(0, 10)
    setLocalValue(date)

    // Throttle: only refetch 200ms after the user stops moving
    clearTimeout(throttleRef.current)
    throttleRef.current = setTimeout(() => onChange(date), 200)
  }

  if (!earliest || !latest) {
    return (
      <div className="scrubber">
        <span className="faint">no temporal range available</span>
      </div>
    )
  }

  return (
    <div className="scrubber">
      <div className="scrubber-head">
        <span className="muted">replay</span>
        <span className="scrubber-date serif">{localValue}</span>
        <button className="reset" onClick={() => onChange(null)}>now</button>
      </div>
      <input
        type="range"
        min={minTs}
        max={maxTs}
        value={valTs}
        step={86400000}
        onChange={handleSlide}
      />
      <div className="scrubber-axis">
        <span className="faint mono">{earliest}</span>
        <span className="faint mono">{latest}</span>
      </div>

      <style>{`
        .scrubber {
          position: fixed;
          left: 50%;
          bottom: 24px;
          transform: translateX(-50%);
          width: 480px;
          max-width: calc(100vw - 320px);
          padding: 12px 18px 10px;
          background: var(--bg-panel);
          backdrop-filter: blur(10px);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          z-index: 9;
        }
        .scrubber-head {
          display: flex;
          align-items: baseline;
          gap: 12px;
          margin-bottom: 8px;
        }
        .scrubber-head .muted {
          font-size: 9px;
          letter-spacing: 0.18em;
          text-transform: uppercase;
        }
        .scrubber-date {
          font-size: 18px;
          letter-spacing: 0.02em;
          flex: 1;
        }
        .reset {
          font-size: 10px;
          letter-spacing: 0.1em;
          padding: 3px 8px;
        }
        .scrubber-axis {
          display: flex;
          justify-content: space-between;
          margin-top: 4px;
          font-size: 9px;
          letter-spacing: 0.06em;
        }
      `}</style>
    </div>
  )
}
