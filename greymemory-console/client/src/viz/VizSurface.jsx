// App.jsx — the shell.
//
// Holds:
//   • dataset + container (the "what we're looking at" context)
//   • mode (explore | debug | scrubber | showcase)
//   • graph data and stats for the current context
//   • selected node, retrieval results, asOf
//
// When dataset or container changes, all derived state resets and the graph
// reloads from the new context.

import { useEffect, useState, useCallback, useMemo } from 'react'
import { api } from './lib/api.js'
import { Graph } from './components/Graph.jsx'
import { Header } from './components/Header.jsx'
import { Legend } from './components/Legend.jsx'
import { InspectPanel } from './components/InspectPanel.jsx'
import { TimeScrubber } from './components/TimeScrubber.jsx'
import { SearchBar } from './components/SearchBar.jsx'
import { RetrievalReport } from './components/RetrievalReport.jsx'

// When mounted inside the landing page's live-graph fold (via an iframe with
// ?embed=1), a few standalone-only affordances are suppressed.
const isEmbedded =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('embed') === '1'

export function VizSurface() {
  const [mode, setMode] = useState('explore')

  // Context — which dataset + container to view
  const [datasets, setDatasets] = useState([])
  const [selectedDataset, setSelectedDataset] = useState(null)
  const [selectedContainer, setSelectedContainer] = useState(null)
  const [liveSearchAvailable, setLiveSearchAvailable] = useState(false)
  const [datasetError, setDatasetError] = useState(null)

  // Per-context graph data
  const [graph, setGraph] = useState({ nodes: [], links: [] })
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  // Per-context derived state
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [retrieval, setRetrieval] = useState(null)
  const [asOf, setAsOf] = useState(null)

  // ── Load dataset list once at mount ──────────────────────────────────────
  useEffect(() => {
    api.datasets()
      .then(data => {
        setDatasets(data.datasets ?? [])
        setLiveSearchAvailable(!!data.liveSearchAvailable)

        // Auto-select the first dataset and a container so the user lands on a
        // working view. Prefer the FEATURED container (the strong "engineers
        // 4→5" supersession showcase) when present, else the first non-empty.
        const FEATURED_CONTAINER = '031748ae'
        const firstDataset = data.datasets?.[0]
        if (firstDataset) {
          setSelectedDataset(firstDataset.id)
          const firstContainer =
            firstDataset.containers?.find(c => c.id === FEATURED_CONTAINER && c.factCount > 0)
            ?? firstDataset.containers?.find(c => c.factCount > 0)
            ?? firstDataset.containers?.[0]
          if (firstContainer) setSelectedContainer(firstContainer.id)
        }
      })
      .catch(err => {
        console.error('dataset list failed', err)
        setDatasetError(err.message)
      })
  }, [])

  // ── Load graph + stats whenever context changes ──────────────────────────
  const loadGraph = useCallback(async () => {
    if (!selectedDataset || !selectedContainer) {
      setGraph({ nodes: [], links: [] })
      setStats(null)
      return
    }
    setLoading(true)
    try {
      const ctx = { dataset: selectedDataset, container: selectedContainer, asOf }
      const [g, s] = await Promise.all([api.graph(ctx), api.stats(ctx)])
      setGraph(g)
      setStats(s)
    } catch (err) {
      console.error('graph load failed', err)
      setGraph({ nodes: [], links: [] })
    } finally {
      setLoading(false)
    }
  }, [selectedDataset, selectedContainer, asOf])

  useEffect(() => { loadGraph() }, [loadGraph])

  // ── Context change handler ───────────────────────────────────────────────
  // When dataset changes, pick the first non-empty container in the new one.
  // When container changes alone, just update it. Either way, clear all
  // derived state — the user is looking at a different graph now.
  const handleContextChange = useCallback(({ dataset, container }) => {
    setSelected(null)
    setDetail(null)
    setRetrieval(null)
    setAsOf(null)

    if (dataset !== selectedDataset) {
      setSelectedDataset(dataset)
      // Find first non-empty container in the new dataset; fall back to first
      const newDs = datasets.find(d => d.id === dataset)
      const next = newDs?.containers?.find(c => c.factCount > 0) ?? newDs?.containers?.[0]
      setSelectedContainer(next?.id ?? null)
    } else if (container !== selectedContainer) {
      setSelectedContainer(container)
    }
  }, [datasets, selectedDataset, selectedContainer])

  // ── Selected node — fetch full detail ────────────────────────────────────
  useEffect(() => {
    if (!selected || selected.type !== 'memory' || !selectedDataset) {
      setDetail(null)
      return
    }
    let cancelled = false
    api.memory({ dataset: selectedDataset, id: selected.memoryId })
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(err => console.error('detail load failed', err))
    return () => { cancelled = true }
  }, [selected, selectedDataset])

  // ── Highlight set for debug mode ─────────────────────────────────────────
  const highlights = useMemo(() => {
    if (mode !== 'debug' || !retrieval?.results) return null
    const map = new Map()
    for (const r of retrieval.results) {
      if (!r._matchedNodeId) continue
      const kind =
        r._expansion?.via === 'EXTENDS'         ? 'expanded' :
        r._expansion?.via === 'UPDATES_HISTORY' ? 'history'  :
        'seed'
      map.set(r._matchedNodeId, { kind })
    }
    return map
  }, [mode, retrieval])

  // ── Search handler ───────────────────────────────────────────────────────
  // `container` can be passed explicitly (e.g. right after a chip switches
  // context) so we don't depend on the async selectedContainer state update.
  const runSearch = useCallback(async (query, container = selectedContainer) => {
    if (!query?.trim() || !selectedDataset || !container) {
      setRetrieval(null)
      return
    }
    try {
      const data = await api.search({
        dataset: selectedDataset,
        container,
        query,
        topN: 8,
        expandViaGraph: true,
      })

      // Match each search result back to a node id by value text.
      // search() returns { memory, chunk, ... } where memory is the fact value
      // and chunk is the chunk text content. Memory nodes store value=fact,
      // chunk nodes store value=content, so the lookup works for both.
      const valueToId = new Map()
      for (const n of graph.nodes) {
        valueToId.set(n.value, n.id)
      }
      const results = data.results.map(r => ({
        ...r,
        _matchedNodeId: valueToId.get(r.memory ?? r.chunk) ?? null,
      }))

      setRetrieval({ ...data, results })
      setMode('debug')
    } catch (err) {
      console.error('search failed', err)
      setRetrieval({ error: err.message, query })
    }
  }, [selectedDataset, selectedContainer, graph.nodes])

  // ── Suggested question for the current container ──────────────────────────
  // In benchmark DBs the container IS a LongMemEval question_id, so we offer
  // that container's own gold question as a clickable chip — always relevant to
  // what's loaded, and it searches the same container so it always lands.
  // Scenario containers have no mapping, so no chip shows.
  const [containerQuestion, setContainerQuestion] = useState(null)
  useEffect(() => {
    setContainerQuestion(null)
    if (!selectedContainer) return
    let cancelled = false
    api.question(selectedContainer)
      .then(q => { if (!cancelled) setContainerQuestion(q?.question ? q : null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedContainer])

  const suggestions = useMemo(() => {
    if (!containerQuestion?.question) return []
    return [{ label: containerQuestion.question, query: containerQuestion.question }]
  }, [containerQuestion])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <div className="vignette" />

      <Header
        mode={mode}
        onModeChange={setMode}
        liveSearchAvailable={liveSearchAvailable}
        datasets={datasets}
        selectedDataset={selectedDataset}
        selectedContainer={selectedContainer}
        onContextChange={handleContextChange}
        loading={loading}
      />

      <SearchBar
        onSearch={runSearch}
        suggestions={suggestions}
        disabled={!liveSearchAvailable || !selectedDataset || !selectedContainer}
        active={mode === 'debug'}
      />

      <Graph
        nodes={graph.nodes}
        links={graph.links}
        mode={mode}
        highlights={highlights}
        selected={selected}
        onSelect={setSelected}
        loading={loading}
      />

      <Legend stats={stats} mode={mode} />

      {mode === 'scrubber' && stats && (
        <TimeScrubber
          earliest={stats.earliest}
          latest={stats.latest}
          value={asOf}
          onChange={setAsOf}
        />
      )}

      {mode === 'debug' && retrieval && (
        <RetrievalReport
          retrieval={retrieval}
          onJumpTo={(nodeId) => {
            const n = graph.nodes.find(x => x.id === nodeId)
            if (n) setSelected(n)
          }}
        />
      )}

      {selected && (
        <InspectPanel
          node={selected}
          detail={detail}
          onClose={() => setSelected(null)}
        />
      )}

      {/* Hidden when embedded as a fold (?embed=1) so the iframe can't
          navigate itself back to the landing page. */}
      {!isEmbedded && <a href="#/" className="viz-about-link">← what is this?</a>}
      <style>{`
        .viz-about-link {
          position: absolute;
          bottom: 14px;
          left: 16px;
          z-index: 10;
          font-size: 11px;
          letter-spacing: 0.5px;
          color: rgba(200, 210, 220, 0.45);
          text-decoration: none;
          padding: 6px 10px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 7px;
          background: rgba(16, 20, 26, 0.7);
          backdrop-filter: blur(8px);
          transition: color 160ms, border-color 160ms;
        }
        .viz-about-link:hover { color: #5fd1e0; border-color: #5fd1e0; }
      `}</style>

      {datasetError && (
        <div className="dataset-error panel">
          <h3>Could not load datasets</h3>
          <p className="muted">{datasetError}</p>
          <p className="faint">Check that <span className="kbd">GREYMEMORY_ROOT</span> in <span className="kbd">greymemory-console/server/.env</span> points at a directory containing <span className="kbd">*-greymemory.db</span> files, then restart the server.</p>
          <style>{`
            .dataset-error {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              max-width: 420px;
              z-index: 100;
            }
            .dataset-error p { margin: 8px 0; font-size: 12px; line-height: 1.5; }
          `}</style>
        </div>
      )}

      {!datasetError && datasets.length === 0 && !loading && (
        <div className="dataset-error panel">
          <h3>No datasets found</h3>
          <p className="muted">No <span className="kbd">*-greymemory.db</span> files were found in the configured root.</p>
          <p className="faint">Set <span className="kbd">GREYMEMORY_ROOT</span> in <span className="kbd">greymemory-console/server/.env</span> to the directory containing your benchmark databases.</p>
          <style>{`
            .dataset-error {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              max-width: 420px;
              z-index: 100;
            }
            .dataset-error p { margin: 8px 0; font-size: 12px; line-height: 1.5; }
          `}</style>
        </div>
      )}
    </>
  )
}
