import React, { useState } from 'react'

// Tiny markdown renderer for the analysis output. Claude returns markdown
// with **bold**, **section headers**, bullets, and inline `code`. We render
// just those — pulling in a full markdown lib would be overkill.
function renderMd(text) {
  if (!text) return null
  const lines = text.split('\n')
  const out = []
  let inList = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*[-*]\s/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${formatInline(line.replace(/^\s*[-*]\s/, ''))}</li>`)
    } else {
      if (inList) { out.push('</ul>'); inList = false }
      if (line.trim() === '') out.push('<br/>')
      else out.push(`<p>${formatInline(line)}</p>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('')
}

function formatInline(s) {
  // escape HTML, then re-apply formatting
  const esc = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return esc
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

export default function AnalysisPanel({ runId, qid }) {
  const [result,  setResult]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [err,     setErr]     = useState(null)

  async function run(refresh = false) {
    setLoading(true)
    setErr(null)
    try {
      const r = await fetch(`/api/diag/runs/${runId}/questions/${qid}/analyze${refresh ? '?refresh=1' : ''}`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `${r.status}`)
      setResult(j)
    } catch (e) {
      setErr(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {!result && !loading && (
        <div style={{ padding: 16, textAlign: 'center' }}>
          <button onClick={() => run(false)} className="primary" style={{ fontSize: 14, padding: '10px 24px' }}>
            🔍  AI Analysis
          </button>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
            Sends question + retrieved items + classifier log to Claude (Sonnet 4.6 by default) for a focused diagnosis. ~$0.01–0.03/click. Cached per question.
          </p>
        </div>
      )}

      {loading && (
        <div style={{ padding: 16, textAlign: 'center', color: 'var(--muted)' }}>
          ⏳ Calling Claude…
        </div>
      )}

      {err && (
        <div style={{ padding: 16, color: 'var(--bad)' }}>
          Error: {err}
        </div>
      )}

      {result && (
        <div style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, color: 'var(--muted)', fontSize: 11 }}>
            <span><code>{result.model}</code></span>
            {result.usage && <span>{result.usage.input_tokens} in / {result.usage.output_tokens} out tokens</span>}
            <span>{result.elapsed_ms}ms</span>
            <span>prompt: {result.prompt_chars} chars</span>
            {result.cached && <span className="badge neutral">cached</span>}
            <button onClick={() => run(true)} style={{ marginLeft: 'auto', fontSize: 11, padding: '4px 10px' }}>
              ↻ refresh
            </button>
          </div>
          <div
            className="analysis-md"
            style={{ lineHeight: 1.6 }}
            dangerouslySetInnerHTML={{ __html: renderMd(result.analysis) }}
          />
        </div>
      )}
    </div>
  )
}
