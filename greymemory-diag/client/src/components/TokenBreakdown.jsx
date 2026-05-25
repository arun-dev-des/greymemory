import React from 'react'

// The run JSON shape for tokens varies a little across older runs. Be
// defensive — extract whatever's there into a uniform table.
export default function TokenBreakdown({ question }) {
  const tokens = question?.tokens ?? {}
  const rows = []

  const ext = tokens.extractor ?? {}
  for (const [phase, vals] of Object.entries(ext)) {
    if (phase === 'total') continue
    if (typeof vals === 'object' && vals !== null) {
      rows.push({ stage: `haiku — ${phase}`, calls: vals.calls, input: vals.input ?? vals.in, output: vals.output ?? vals.out })
    }
  }

  const emb = tokens.embedder ?? {}
  for (const [phase, vals] of Object.entries(emb)) {
    if (phase === 'total') continue
    const calls = typeof vals === 'object' ? vals.calls : vals
    rows.push({ stage: `embedder — ${phase}`, calls, input: '—', output: '—' })
  }

  if (tokens.gpt4o_input != null || tokens.gpt4o_output != null) {
    rows.push({ stage: 'gpt-4o (answer+judge)', calls: '—', input: tokens.gpt4o_input, output: tokens.gpt4o_output })
  }

  if (rows.length === 0) {
    return <div style={{ padding: 16, color: 'var(--muted)' }}>No token data on this question entry.</div>
  }

  return (
    <table>
      <thead>
        <tr>
          <th>stage</th>
          <th style={{ textAlign: 'right' }}>calls</th>
          <th style={{ textAlign: 'right' }}>in tokens</th>
          <th style={{ textAlign: 'right' }}>out tokens</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td><code>{r.stage}</code></td>
            <td style={{ textAlign: 'right' }}>{fmt(r.calls)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(r.input)}</td>
            <td style={{ textAlign: 'right' }}>{fmt(r.output)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function fmt(v) {
  if (v == null) return '—'
  if (typeof v === 'number') return v.toLocaleString()
  return v
}
