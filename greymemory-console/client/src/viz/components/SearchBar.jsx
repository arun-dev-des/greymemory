// SearchBar.jsx
//
// Always visible. Typing here runs the real `memory.search()` against the
// real database. The graph lights up with the result. This is the core
// Bret Victor moment of the tool — immediate connection between intent
// (the query) and effect (what retrieval surfaces).

import { useState, useRef, useEffect } from 'react'

// `suggestions` is supplied by the parent (VizSurface), filtered to questions
// that actually exist in the loaded dataset. Each entry may carry its own
// `container` — clicking a chip then jumps to that container before searching,
// via `onPick`. A chip whose question lives in another user's container would
// otherwise return nothing, which is the trap this avoids.
export function SearchBar({ onSearch, onPick, disabled, active, suggestions = [] }) {
  const [value, setValue] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef()

  // Cmd-K / Ctrl-K to focus
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        inputRef.current?.blur()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const run = async (text) => {
    if (!text.trim() || disabled) return
    setSubmitting(true)
    try {
      await onSearch(text)
    } finally {
      setSubmitting(false)
    }
  }

  const submit = () => run(value)

  const pick = (s) => {
    setValue(s.query)
    // If the chip knows its container, let the parent switch context and run
    // the search there. Otherwise fall back to a plain search in the current one.
    if (onPick) onPick(s)
    else run(s.query)
  }

  const showSuggestions = !disabled && !submitting && !value.trim() && suggestions.length > 0

  return (
    <div className={`search-bar ${active ? 'active' : ''}`}>
      <div className="search-row">
        <span className="search-prompt">→</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder={disabled
            ? 'live search disabled — see README for setup'
            : 'ask the graph anything…'}
          disabled={disabled || submitting}
        />
        <span className="kbd">⌘K</span>
      </div>

      {showSuggestions && (
        <div className="suggestions">
          <span className="suggest-label">try</span>
          {suggestions.map((s) => (
            <button
              key={s.query}
              type="button"
              className="chip"
              title={s.query}
              onClick={() => pick(s)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <style>{`
        .search-bar {
          position: absolute;
          top: 70px;
          left: 16px;
          width: 420px;
          max-width: calc(100vw - 32px);
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 4px 12px 4px 14px;
          /* elevated panel — reads as a raised card off the graph void,
             instead of blending into it */
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          box-shadow: 0 10px 34px rgba(0, 0, 0, 0.5);
          z-index: 10;
          transition: border-color 200ms, box-shadow 200ms;
        }
        .search-bar.active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-glow), 0 10px 34px rgba(0, 0, 0, 0.5), 0 6px 24px rgba(95, 209, 224, 0.08);
        }
        .search-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .search-prompt {
          color: var(--accent);
          font-size: 13px;
        }
        .search-bar input {
          flex: 1;
          background: transparent;
          border: none;
          padding: 8px 0;
          letter-spacing: 0.01em;
        }
        .search-bar input:focus {
          box-shadow: none;
        }
        .suggestions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          padding: 0 0 8px 22px;
        }
        .suggest-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: var(--fg-faint, #6b7280);
          margin-right: 2px;
        }
        .chip {
          font-size: 11px;
          line-height: 1.3;
          text-align: left;
          padding: 4px 9px;
          background: transparent;
          color: var(--fg-muted, #9ca3af);
          border: 1px solid var(--border);
          border-radius: 999px;
          cursor: pointer;
          transition: border-color 160ms, color 160ms, background 160ms;
        }
        .chip:hover {
          border-color: var(--accent);
          color: var(--accent);
          background: var(--accent-glow, rgba(95, 209, 224, 0.06));
        }
      `}</style>
    </div>
  )
}
