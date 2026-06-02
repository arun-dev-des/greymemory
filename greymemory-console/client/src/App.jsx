// App.jsx — the console shell.
//
// One hash router for the whole app. The first path segment selects the
// surface; everything after it belongs to that surface:
//   #/viz                          → VizSurface (state-only, no sub-routes)
//   #/diag                         → DiagSurface → RunsPage
//   #/diag/runs/:runId             → RunDetail
//   #/diag/runs/:runId/q/:qid      → QuestionDetail
//   #/diag/dbs                     → DBBrowser
//   #/diag/dbs/:dbId/c/:container  → DBBrowser (preselected)
// Empty / unknown top segment falls back to viz.
//
// Only the active surface is mounted, so viz's force-graph canvas is not
// running while you're on diag (and vice versa). Each surface is wrapped in a
// .surface-viz / .surface-diag div that scopes its stylesheet (see shell.css).

import { useEffect, useState } from 'react'
import { VizSurface }  from './viz/VizSurface.jsx'
import { DiagSurface } from './diag/DiagSurface.jsx'
import './viz/styles.css'
import './diag/styles.css'
import './shell.css'

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/viz')
  useEffect(() => {
    const h = () => setHash(window.location.hash || '#/viz')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return hash
}

export default function App() {
  const hash = useRoute()
  const top = hash.replace(/^#\//, '').split('/')[0] || 'viz'
  const onViz  = top === 'viz' || top === ''
  const onDiag = top === 'diag'

  return (
    <div className="console-root">
      <nav className="console-sidebar">
        <div className="console-brand">greymemory</div>
        <a href="#/viz"  className={`console-nav-item ${onViz  ? 'active' : ''}`}>Visualizer</a>
        <a href="#/diag" className={`console-nav-item ${onDiag ? 'active' : ''}`}>Diagnostics</a>
        <div className="console-sidebar-foot">console</div>
      </nav>
      <main className="console-main">
        {onViz  && <div className="surface-viz"><VizSurface /></div>}
        {onDiag && <div className="surface-diag"><DiagSurface hash={hash} /></div>}
      </main>
    </div>
  )
}
