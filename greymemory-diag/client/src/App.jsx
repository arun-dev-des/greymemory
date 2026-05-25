import React, { useEffect, useState } from 'react'
import RunsPage       from './pages/RunsPage.jsx'
import RunDetail      from './pages/RunDetail.jsx'
import QuestionDetail from './pages/QuestionDetail.jsx'
import DBBrowser      from './pages/DBBrowser.jsx'

// Hash-based router so we don't need react-router. Routes:
//   #/                          → RunsPage (default)
//   #/runs/:runId               → RunDetail
//   #/runs/:runId/q/:qid        → QuestionDetail
//   #/dbs                       → DBBrowser
//   #/dbs/:dbId/c/:container    → DBBrowser (preselected)

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const h = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return hash
}

function parseRoute(hash) {
  const path = hash.replace(/^#/, '')
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0)                                          return { name: 'runs' }
  if (parts[0] === 'runs' && parts.length === 2)                   return { name: 'runDetail', runId: parts[1] }
  if (parts[0] === 'runs' && parts[2] === 'q' && parts.length === 4) return { name: 'questionDetail', runId: parts[1], qid: parts[3] }
  if (parts[0] === 'dbs' && parts.length === 1)                    return { name: 'dbs' }
  if (parts[0] === 'dbs' && parts[2] === 'c' && parts.length === 4) return { name: 'dbs', dbId: parts[1], container: parts[3] }
  return { name: 'runs' }
}

export default function App() {
  const hash = useRoute()
  const route = parseRoute(hash)

  const onRunsTab = ['runs', 'runDetail', 'questionDetail'].includes(route.name)
  const onDbsTab  = route.name === 'dbs'

  return (
    <div className="app">
      <header className="header">
        <h1>greymemory-diag</h1>
        <div className="tabs">
          <a href="#/"    className={`tab ${onRunsTab ? 'active' : ''}`}>Runs</a>
          <a href="#/dbs" className={`tab ${onDbsTab  ? 'active' : ''}`}>DB Browser</a>
        </div>
        <Breadcrumbs route={route} />
      </header>
      <div className="body">
        {route.name === 'runs'           && <RunsPage />}
        {route.name === 'runDetail'      && <RunDetail runId={route.runId} />}
        {route.name === 'questionDetail' && <QuestionDetail runId={route.runId} qid={route.qid} />}
        {route.name === 'dbs'            && <DBBrowser preselect={{ dbId: route.dbId, container: route.container }} />}
      </div>
    </div>
  )
}

function Breadcrumbs({ route }) {
  const crumbs = []
  if (route.name === 'runDetail' || route.name === 'questionDetail') {
    crumbs.push(<a key="r" href="#/">runs</a>)
    crumbs.push(<span key="r-sep"> / </span>)
    if (route.name === 'questionDetail') {
      crumbs.push(<a key="d" href={`#/runs/${route.runId}`}>{route.runId}</a>)
      crumbs.push(<span key="d-sep"> / </span>)
      crumbs.push(<span key="q">{route.qid}</span>)
    } else {
      crumbs.push(<span key="d">{route.runId}</span>)
    }
  }
  return <div className="crumbs">{crumbs}</div>
}
