import React, { useEffect, useState } from 'react'
import { ErrorBox }       from './RunsPage.jsx'
import { badgeForFail, formatRatio } from './RunDetail.jsx'
import RetrievalList      from '../components/RetrievalList.jsx'
import RelationshipLog    from '../components/RelationshipLog.jsx'
import TokenBreakdown     from '../components/TokenBreakdown.jsx'
import AnalysisPanel      from '../components/AnalysisPanel.jsx'

export default function QuestionDetail({ runId, qid }) {
  const [data, setData] = useState(null)
  const [err, setErr]   = useState(null)

  useEffect(() => {
    fetch(`/api/diag/runs/${runId}/questions/${qid}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.error))))
      .then(setData)
      .catch(e => setErr(e.message))
  }, [runId, qid])

  if (err)  return <ErrorBox msg={err} />
  if (!data) return <p>Loading…</p>

  const q = data.question
  const gold = q.gold_sessions ?? q.answer_session_ids ?? []

  return (
    <div>
      {/* header */}
      <div className="panel">
        <div className="panel-header"><h2>Question {qid}</h2><span className="count">{q.question_type}</span></div>
        <div className="panel-body">
          <p style={{ marginTop: 0 }}><strong>Q:</strong> {q.question}</p>
          <p><strong>Expected:</strong> <code>{q.expected}</code></p>
          <p>
            <strong>Got:</strong> <code style={{ whiteSpace: 'pre-wrap' }}>{q.answer}</code>
          </p>
          <p>
            <strong>Verdict:</strong> {q.correct ? <span className="badge good">correct ✓</span> : <span className="badge bad">wrong ✗</span>}
            {' '}
            {q.failure_reason && <span className={`badge ${badgeForFail(q.failure_reason)}`}>{q.failure_reason}</span>}
            {' '}
            {q.is_abstention && <span className="badge neutral">abstention question</span>}
          </p>
        </div>
      </div>

      {/* AI analysis */}
      <div className="panel">
        <div className="panel-header"><h2>AI analysis</h2><span className="count">Claude diagnoses this question end-to-end</span></div>
        <div className="panel-body compact">
          <AnalysisPanel runId={runId} qid={qid} />
        </div>
      </div>

      {/* retrieval */}
      <div className="panel">
        <div className="panel-header">
          <h2>Retrieval</h2>
          <span className="count">{(q.retrieved ?? []).length} results · {gold.length} gold</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 12 }}>
            <Metric small label="R@5"  value={formatRatio(q.recall_at_5)} />
            <Metric small label="R@10" value={formatRatio(q.recall_at_10)} />
            <Metric small label="N@5"  value={formatRatio(q.ndcg_at_5)} />
            <Metric small label="N@10" value={formatRatio(q.ndcg_at_10)} />
          </div>
        </div>
        <div className="panel-body compact">
          <RetrievalList retrieved={q.retrieved ?? []} goldSessions={gold} />
        </div>
      </div>

      {/* relationship log */}
      <div className="panel">
        <div className="panel-header">
          <h2>Relationship log</h2>
          <span className="count">{(data.relationship_log ?? []).length} decisions</span>
        </div>
        <div className="panel-body compact">
          <RelationshipLog entries={data.relationship_log ?? []} />
        </div>
      </div>

      {/* tokens */}
      <div className="panel">
        <div className="panel-header"><h2>Tokens &amp; cost</h2></div>
        <div className="panel-body compact">
          <TokenBreakdown question={q} />
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <span className="badge neutral" style={{ fontFamily: 'var(--mono)' }}>
      {label}: {value}
    </span>
  )
}
