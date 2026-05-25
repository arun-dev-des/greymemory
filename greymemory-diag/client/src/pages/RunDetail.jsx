import React, { useEffect, useMemo, useState } from 'react'
import { ErrorBox } from './RunsPage.jsx'

export default function RunDetail({ runId }) {
  const [run, setRun] = useState(null)
  const [err, setErr] = useState(null)
  const [filterCat,   setFilterCat]   = useState('')
  const [filterCorr,  setFilterCorr]  = useState('')   // '', 'correct', 'wrong'
  const [filterFail,  setFilterFail]  = useState('')

  useEffect(() => {
    fetch(`/api/runs/${runId}`)
      .then(r => r.json())
      .then(setRun)
      .catch(e => setErr(e.message))
  }, [runId])

  const stats = useMemo(() => {
    if (!run?.questions) return null
    const qs = run.questions
    const total = qs.length
    const correct = qs.filter(q => q.correct).length
    const byCat = {}
    const byFail = {}
    for (const q of qs) {
      const c = q.question_type
      byCat[c] = byCat[c] ?? { total: 0, correct: 0 }
      byCat[c].total += 1
      if (q.correct) byCat[c].correct += 1
      if (!q.correct && q.failure_reason) {
        byFail[q.failure_reason] = (byFail[q.failure_reason] ?? 0) + 1
      }
    }
    return { total, correct, byCat, byFail }
  }, [run])

  const filtered = useMemo(() => {
    if (!run?.questions) return []
    return run.questions.filter(q => {
      if (filterCat  && q.question_type !== filterCat) return false
      if (filterCorr === 'correct' && !q.correct) return false
      if (filterCorr === 'wrong'   &&  q.correct) return false
      if (filterFail && q.failure_reason !== filterFail) return false
      return true
    })
  }, [run, filterCat, filterCorr, filterFail])

  if (err) return <ErrorBox msg={err} />
  if (!run) return <p>Loading…</p>

  return (
    <div>
      <h2>Run {runId}</h2>

      {stats && (
        <div className="metrics-bar">
          <Metric label="Questions" value={stats.total} />
          <Metric label="Correct"   value={`${stats.correct} (${((stats.correct/stats.total)*100).toFixed(0)}%)`} />
          {Object.entries(stats.byCat).map(([cat, s]) => (
            <Metric key={cat} label={cat} value={`${s.correct}/${s.total}`} />
          ))}
        </div>
      )}

      {stats && Object.keys(stats.byFail).length > 0 && (
        <div className="panel">
          <div className="panel-header"><h2>Failure reasons</h2></div>
          <div className="panel-body">
            {Object.entries(stats.byFail).map(([reason, n]) => (
              <span key={reason} className={`badge ${badgeForFail(reason)}`} style={{ marginRight: 8 }}>
                {reason}: {n}
              </span>
            ))}
            <p style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
              <strong>retrieval</strong>: no gold session reached top-N. <strong>answering</strong>: gold retrieved but model answered wrong. <strong>extraction</strong>: expected literal not in any chunk. <strong>unknown</strong>: gold retrieved, derived answer — can't disambiguate.
            </p>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-header">
          <h2>Questions</h2>
          <span className="count">{filtered.length} / {run.questions?.length}</span>
          <div className="filters">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)}>
              <option value="">all categories</option>
              {[...new Set((run.questions ?? []).map(q => q.question_type))].map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select value={filterCorr} onChange={e => setFilterCorr(e.target.value)}>
              <option value="">all</option>
              <option value="correct">correct</option>
              <option value="wrong">wrong</option>
            </select>
            <select value={filterFail} onChange={e => setFilterFail(e.target.value)}>
              <option value="">all failure reasons</option>
              {[...new Set((run.questions ?? []).map(q => q.failure_reason).filter(Boolean))].map(f => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="panel-body compact">
          <table>
            <thead>
              <tr>
                <th>id</th>
                <th>category</th>
                <th>question</th>
                <th>verdict</th>
                <th>R@10</th>
                <th>failure</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(q => (
                <tr key={q.question_id} className="clickable" onClick={() => window.location.hash = `#/runs/${runId}/q/${q.question_id}`}>
                  <td><code style={{ fontSize: 11 }}>{q.question_id}</code></td>
                  <td style={{ fontSize: 12 }}>{q.question_type}</td>
                  <td style={{ fontSize: 13 }}>{q.question?.slice(0, 80)}{q.question?.length > 80 ? '…' : ''}</td>
                  <td>{q.correct ? <span className="badge good">✓</span> : <span className="badge bad">✗</span>}</td>
                  <td>{formatRatio(q.recall_at_10)}</td>
                  <td>{q.failure_reason ? <span className={`badge ${badgeForFail(q.failure_reason)}`}>{q.failure_reason}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  )
}

export function formatRatio(r) {
  if (r == null) return '—'
  return `${(r*100).toFixed(0)}%`
}

export function badgeForFail(reason) {
  if (reason === 'answering' || reason === 'extraction') return 'warn'
  if (reason === 'retrieval')   return 'bad'
  return 'neutral'
}
