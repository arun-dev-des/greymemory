import React, { useEffect, useMemo, useState } from 'react'
import { ErrorBox } from './RunsPage.jsx'
import FactsTable   from '../components/FactsTable.jsx'
import SearchPanel  from '../components/SearchPanel.jsx'

export default function DBBrowser({ preselect = {} }) {
  const [dbs, setDbs]             = useState(null)
  const [err, setErr]             = useState(null)
  const [dbId, setDbId]           = useState(preselect.dbId ?? '')
  const [container, setContainer] = useState(preselect.container ?? '')
  const [facts, setFacts]         = useState(null)
  const [factsErr, setFactsErr]   = useState(null)

  useEffect(() => {
    fetch('/api/dbs').then(r => r.json()).then(setDbs).catch(e => setErr(e.message))
  }, [])

  const containers = useMemo(() => {
    if (!dbs || !dbId) return []
    const db = dbs.find(d => d.id === dbId)
    return db?.containers ?? []
  }, [dbs, dbId])

  // load facts whenever dbId+container changes
  useEffect(() => {
    if (!dbId || !container) { setFacts(null); return }
    setFacts(null)
    setFactsErr(null)
    fetch(`/api/dbs/${encodeURIComponent(dbId)}/containers/${encodeURIComponent(container)}/facts`)
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(new Error(j.error))))
      .then(setFacts)
      .catch(e => setFactsErr(e.message))
  }, [dbId, container])

  async function loadHistory(factId) {
    const r = await fetch(`/api/dbs/${encodeURIComponent(dbId)}/containers/${encodeURIComponent(container)}/facts/${factId}/history`)
    if (!r.ok) throw new Error((await r.json()).error ?? `${r.status}`)
    return r.json()
  }

  if (err)  return <ErrorBox msg={err} />
  if (!dbs) return <p>Loading databases…</p>

  return (
    <div>
      <div className="panel">
        <div className="panel-header"><h2>Database picker</h2></div>
        <div className="panel-body" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <label>DB:</label>
          <select value={dbId} onChange={e => { setDbId(e.target.value); setContainer('') }} style={{ minWidth: 320 }}>
            <option value="">— select —</option>
            {dbs.map(d => (
              <option key={d.id} value={d.id}>{d.id} ({d.containers?.length ?? 0} containers)</option>
            ))}
          </select>
          <label>Container:</label>
          <select value={container} onChange={e => setContainer(e.target.value)} style={{ minWidth: 240 }} disabled={!dbId}>
            <option value="">— select —</option>
            {containers.map(c => (
              <option key={c.container} value={c.container}>{c.container} ({c.fact_count} facts)</option>
            ))}
          </select>
        </div>
      </div>

      {dbId && container && (
        <>
          <div className="panel">
            <div className="panel-header">
              <h2>Live search</h2>
              <span className="count">hybrid BM25 + vector via Memory.search</span>
            </div>
            <div className="panel-body">
              <SearchPanel dbId={dbId} container={container} />
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Facts (is_latest=1)</h2>
              <span className="count">{facts?.length ?? '…'}</span>
            </div>
            <div className="panel-body compact">
              {factsErr && <ErrorBox msg={factsErr} />}
              {facts == null && !factsErr && <p style={{ padding: 16 }}>Loading…</p>}
              {facts && <FactsTable facts={facts} onLoadHistory={loadHistory} />}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
