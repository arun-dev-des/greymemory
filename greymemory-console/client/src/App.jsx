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

import { useEffect, useState, lazy, Suspense } from 'react'
import { VizSurface }  from './viz/VizSurface.jsx'
import { DiagSurface } from './diag/DiagSurface.jsx'
import { StoryPage }   from './story/StoryPage.jsx'
import './viz/styles.css'
import './diag/styles.css'
import './shell.css'

// The chosen design (B · Editorial) is the landing page. The other design
// iterations stay reachable for reference: #/a (product), #/c (instrument),
// #/old (the pre-iteration page). Lazy so an in-progress variant can never
// take down the main routes.
import { VariantB } from './story/variants/VariantB.jsx'
const VariantA = lazy(() => import('./story/variants/VariantA.jsx').then(m => ({ default: m.VariantA })))
const VariantC = lazy(() => import('./story/variants/VariantC.jsx').then(m => ({ default: m.VariantC })))
const VARIANTS = { a: VariantA, b: VariantB, c: VariantC, old: StoryPage }

function useRoute() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const h = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  return hash
}

export default function App() {
  const hash = useRoute()
  const top = hash.replace(/^#\//, '').split('/')[0] || ''
  const onViz   = top === 'viz'
  const onDiag  = top === 'diag'
  const Variant = VARIANTS[top] ?? null
  const onStory = !onViz && !onDiag && !Variant   // '#/' and anything unknown → the explainer

  // The Visualizer is the public demo — it renders chrome-free (no sidebar).
  // Diagnostics stays reachable at #/diag for internal use; it keeps a minimal
  // nav so you can switch back without hand-editing the URL.
  return (
    <div className="console-root">
      {onDiag && (
        <nav className="console-sidebar">
          <div className="console-brand">greymemory</div>
          <a href="#/viz"  className={`console-nav-item ${onViz  ? 'active' : ''}`}>Visualizer</a>
          <a href="#/diag" className={`console-nav-item ${onDiag ? 'active' : ''}`}>Diagnostics</a>
          <div className="console-sidebar-foot">console</div>
        </nav>
      )}
      <main className="console-main">
        {onStory && <div className="surface-story"><VariantB /></div>}
        {Variant && (
          <div className="surface-story">
            <Suspense fallback={null}><Variant /></Suspense>
          </div>
        )}
        {onViz   && <div className="surface-viz"><VizSurface /></div>}
        {onDiag  && <div className="surface-diag"><DiagSurface hash={hash} /></div>}
      </main>
    </div>
  )
}
