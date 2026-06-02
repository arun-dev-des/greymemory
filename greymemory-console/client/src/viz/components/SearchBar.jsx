// SearchBar.jsx
//
// Always visible. Typing here runs the real `memory.search()` against the
// real database. The graph lights up with the result. This is the core
// Bret Victor moment of the tool — immediate connection between intent
// (the query) and effect (what retrieval surfaces).

import { useState, useRef, useEffect } from 'react'

export function SearchBar({ onSearch, disabled, active }) {
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

  const submit = async () => {
    if (!value.trim() || disabled) return
    setSubmitting(true)
    try {
      await onSearch(value)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={`search-bar ${active ? 'active' : ''}`}>
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

      <style>{`
        .search-bar {
          position: absolute;
          top: 70px;
          left: 16px;
          width: 420px;
          max-width: calc(100vw - 32px);
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 12px 4px 14px;
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          backdrop-filter: blur(8px);
          z-index: 10;
          transition: border-color 200ms;
        }
        .search-bar.active {
          border-color: var(--accent);
          box-shadow: 0 0 0 1px var(--accent-glow), 0 6px 24px rgba(95, 209, 224, 0.08);
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
      `}</style>
    </div>
  )
}
