// Graph.jsx
//
// Wraps react-force-graph-2d. Custom canvas painters (graphPaint.js) draw
// nodes and links using the rules in graphStyle.js. The same simulation
// persists across mode changes — modes only swap the highlight overlay.

import { useRef, useEffect, useMemo, useCallback, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { forceX, forceY } from 'd3-force-3d'
import { paintNode, paintLink, paintNodePointerArea, buildHighlightedLinkSet } from '../lib/graphPaint.js'

// The graph fills the viewport, but the search/retrieval panels (left) and the
// legend/inspect panels (right) cover its edges. These helpers measure the
// panels actually on screen and center content in the CLEAR region between
// them, so a selected node or highlighted set never lands behind a panel.
function visibleInsets(container) {
  const W = container.clientWidth
  const H = container.clientHeight
  const doc = container.ownerDocument
  let left = 24, right = 24
  for (const sel of ['.search-bar', '.report']) {
    const el = doc.querySelector(sel)
    if (el) left = Math.max(left, el.getBoundingClientRect().right + 16)
  }
  for (const sel of ['.legend', '.inspect']) {
    const el = doc.querySelector(sel)
    if (el) right = Math.max(right, W - el.getBoundingClientRect().left + 16)
  }
  const top = 84, bottom = 60   // header strip / interaction hint
  return {
    W, H,
    cx: left + (W - left - right) / 2,
    cy: top + (H - top - bottom) / 2,
    cw: Math.max(120, W - left - right),
    ch: Math.max(120, H - top - bottom),
  }
}

// Fit a bounding box within the visible region and center it there.
function fitInView(fg, container, minX, maxX, minY, maxY, ms) {
  const ins = visibleInsets(container)
  const spreadX = Math.max(maxX - minX, 60)
  const spreadY = Math.max(maxY - minY, 60)
  const k = Math.max(0.6, Math.min(3, 0.82 * Math.min(ins.cw / spreadX, ins.ch / spreadY)))
  fg.zoom(k, ms)
  fg.centerAt((minX + maxX) / 2 - (ins.cx - ins.W / 2) / k, (minY + maxY) / 2 - (ins.cy - ins.H / 2) / k, ms)
}

export function Graph({ nodes, links, mode, highlights, selected, onSelect, loading }) {
  const fgRef = useRef()
  const containerRef = useRef()

  // Build the highlighted-link set whenever highlights change, so links
  // touching highlighted nodes get the brighter treatment.
  const highlightedLinks = useMemo(
    () => buildHighlightedLinkSet(links, highlights),
    [highlights, links]
  )

  // Selecting a node fits it TOGETHER WITH its 1-hop neighbors into the clear
  // region between the panels — so you land on a populated neighborhood (and an
  // isolated node still centers with padding, never in an empty void).
  useEffect(() => {
    if (!selected || !fgRef.current || !containerRef.current) return
    const fg = fgRef.current
    const container = containerRef.current
    // rAF lets x/y and the inspect panel settle before measuring.
    requestAnimationFrame(() => {
      const n = nodes.find(x => x.id === selected.id)
      if (!n || n.x === undefined || n.y === undefined) return
      const keep = new Set([n.id])
      for (const l of links) {
        const s = typeof l.source === 'object' ? l.source.id : l.source
        const t = typeof l.target === 'object' ? l.target.id : l.target
        if (s === n.id) keep.add(t)
        else if (t === n.id) keep.add(s)
      }
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const p of nodes) {
        if (!keep.has(p.id) || p.x === undefined) continue
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y
      }
      if (!isFinite(minX)) { minX = maxX = n.x; minY = maxY = n.y }
      const padX = Math.max(90, (maxX - minX) * 0.2)
      const padY = Math.max(90, (maxY - minY) * 0.2)
      fitInView(fg, container, minX - padX, maxX + padX, minY - padY, maxY + padY, 600)
    })
  }, [selected, nodes, links])

  // When highlights arrive (debug mode), fit the highlighted set into the
  // visible region between the panels.
  useEffect(() => {
    if (!highlights || highlights.size === 0 || !fgRef.current || !containerRef.current) return
    const fg = fgRef.current
    const container = containerRef.current
    const ids = new Set(highlights.keys())
    const targets = nodes.filter(n => ids.has(n.id))
    if (targets.length === 0) return
    requestAnimationFrame(() => {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const t of targets) {
        if (t.x === undefined) continue
        if (t.x < minX) minX = t.x; if (t.x > maxX) maxX = t.x
        if (t.y < minY) minY = t.y; if (t.y > maxY) maxY = t.y
      }
      if (!isFinite(minX)) return
      fitInView(fg, container, minX, maxX, minY, maxY, 600)
    })
  }, [highlights, nodes])

  // ── Node painter ─────────────────────────────────────────────────────────
  const drawNode = useCallback((node, ctx, globalScale) => {
    paintNode(node, ctx, globalScale, { highlights, selected })
  }, [highlights, selected])

  // ── Link painter ─────────────────────────────────────────────────────────
  const drawLink = useCallback((link, ctx, globalScale) => {
    paintLink(link, ctx, globalScale, { highlightedLinks })
  }, [highlightedLinks])

  // Disable interactivity in showcase mode for a cleaner aesthetic
  const interactive = mode !== 'showcase'

  // Fit the whole graph once it first settles (and after a dataset/container
  // swap), so the reader opens on the full constellation, centered — not a
  // random zoom. Guarded per nodes-generation so a user's pan/zoom is never
  // yanked back when the sim reheats from a drag.
  const fittedForRef = useRef(null)
  const handleEngineStop = useCallback(() => {
    const fg = fgRef.current
    if (!fg || !nodes.length || fittedForRef.current === nodes) return
    fittedForRef.current = nodes
    fg.zoomToFit(600, 90)
  }, [nodes])

  // Bound the layout. Disconnected nodes (common in these graphs) otherwise
  // drift to ±thousands under charge repulsion — the default center force only
  // re-centers the centroid, it doesn't stop the spread — which leaves the sim
  // never settling and makes zoom-to-fit / click-to-center land on empty space.
  // A gentle pull toward the origin keeps every container compact and settled.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !nodes.length) return
    fg.d3Force('x', forceX(0).strength(0.06))
    fg.d3Force('y', forceY(0).strength(0.06))
    fittedForRef.current = null       // re-fit once the bounded layout settles
    fg.d3ReheatSimulation?.()
  }, [nodes])

  // Interaction hint: an animated mouse-scroll nudge at the bottom of the
  // graph. Dismissed on the first wheel/drag, or after a few seconds.
  const [hint, setHint] = useState(true)
  useEffect(() => {
    if (!interactive) { setHint(false); return }
    setHint(true)
    const el = containerRef.current
    if (!el) return
    const hide = () => setHint(false)
    el.addEventListener('wheel', hide, { once: true, passive: true })
    el.addEventListener('pointerdown', hide, { once: true })
    const t = setTimeout(hide, 9000)
    return () => {
      clearTimeout(t)
      el.removeEventListener('wheel', hide)
      el.removeEventListener('pointerdown', hide)
    }
  }, [interactive, nodes])

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: 0, zIndex: 2 }}>
      {loading && (
        <div className="loading-overlay">
          <span className="pulse mono">loading graph…</span>
        </div>
      )}

      <ForceGraph2D
        ref={fgRef}
        graphData={{ nodes, links }}
        backgroundColor="rgba(0,0,0,0)"
        nodeCanvasObject={drawNode}
        nodePointerAreaPaint={paintNodePointerArea}
        linkCanvasObject={drawLink}
        linkCanvasObjectMode={() => 'replace'}
        cooldownTicks={mode === 'showcase' ? 200 : 100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        warmupTicks={20}
        nodeRelSize={4}
        enableNodeDrag={interactive}
        enableZoomInteraction={interactive}
        enablePanInteraction={interactive}
        onNodeClick={interactive ? onSelect : undefined}
        onBackgroundClick={interactive ? () => onSelect(null) : undefined}
        onEngineStop={handleEngineStop}
      />

      {interactive && (
        <div className={`graph-hint ${hint ? 'show' : ''}`} aria-hidden="true">
          <svg width="18" height="27" viewBox="0 0 18 27" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="1" y="1" width="16" height="25" rx="8" />
            <line className="gh-wheel" x1="9" y1="6" x2="9" y2="10.5" strokeLinecap="round" />
          </svg>
          <span>scroll to zoom · drag to move</span>
        </div>
      )}

      <style>{`
        .loading-overlay {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-dim);
          letter-spacing: 0.1em;
          z-index: 5;
          pointer-events: none;
        }
        .graph-hint {
          position: absolute;
          bottom: 22px;
          left: 50%;
          transform: translateX(-50%) translateY(6px);
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 15px 7px 11px;
          color: var(--text-dim);
          font-size: 11px;
          letter-spacing: 0.08em;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 999px;
          box-shadow: 0 6px 22px rgba(0, 0, 0, 0.4);
          opacity: 0;
          pointer-events: none;
          transition: opacity 400ms, transform 400ms;
          z-index: 6;
        }
        .graph-hint.show { opacity: 1; transform: translateX(-50%) translateY(0); }
        .gh-wheel {
          transform-box: fill-box;
          transform-origin: center;
          animation: gh-nudge 1.5s ease-in-out infinite;
        }
        @keyframes gh-nudge {
          0%, 100% { transform: translateY(0); opacity: 1; }
          50% { transform: translateY(4px); opacity: 0.3; }
        }
        @media (prefers-reduced-motion: reduce) { .gh-wheel { animation: none; } }
      `}</style>
    </div>
  )
}
