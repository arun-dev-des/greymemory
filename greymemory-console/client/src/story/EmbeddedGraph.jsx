// EmbeddedGraph.jsx — a sized-container force graph for the story page.
//
// The full-screen Graph.jsx cannot be embedded (position:fixed wrapper, canvas
// sized to the window), so this wrapper owns the two things an embed needs:
// explicit width/height from a ResizeObserver, and page-friendly interaction
// (no zoom/pan capture — wheel scrolls the page; node drag only on fine
// pointers). Painting is shared with the live viz via viz/lib/graphPaint.js,
// so every color/radius/glow here means the same thing at #/viz.
//
// Data warning: force-graph mutates node objects (x/y/vx/vy) and rewrites link
// source/target into object refs. Callers must pass fresh clones per mount
// (dataset factories) — never module-level singletons.

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { forceX, forceY } from 'd3-force-3d'
import {
  paintNode,
  paintLink,
  paintNodePointerArea,
  buildHighlightedLinkSet,
} from '../viz/lib/graphPaint.js'

const COARSE_POINTER =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(pointer: coarse)').matches

export function EmbeddedGraph({
  nodes,
  links,
  height = 240,
  highlights = null,      // Map<nodeId, {kind:'seed'|'expanded'|'history'}>
  nodeOverrides = null,   // Map<nodeId, partial node fields> — repaint w/o sim reset
  interactive = true,
  paused = false,
  drift = false,          // hero mode: periodic gentle reheat while visible
  labelZoom = 1.4,        // paint labels above this zoom; Infinity = never
  showTooltip = true,
  fit = 'always',         // 'once' | 'always' | 'none'
  fitPadding = 24,
  physics = {},
  onVisible = null,
  onNodeClick = null,
  onBackgroundClick = null,
}) {
  const wrapRef = useRef(null)
  const fgRef = useRef(null)
  const fittedRef = useRef(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [inView, setInView] = useState(false)

  // ── Measure the container; never render the canvas at window size ────────
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Visibility: pause offscreen sims entirely ─────────────────────────────
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting)
        onVisible?.(entry.isIntersecting)
      },
      { rootMargin: '120px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [onVisible])

  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    if (paused || !inView) fg.pauseAnimation()
    else fg.resumeAnimation()
  }, [paused, inView, size.w])

  // ── Shape the layout to the frame ─────────────────────────────────────────
  // A force layout settles roughly circular, which leaves a wide frame mostly
  // empty (zoomToFit is height-bound). For wide frames, replace the isotropic
  // center force with anisotropic x/y pulls: weak horizontally, strong
  // vertically, so the layout spreads into the available width.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || size.w === 0 || size.h === 0) return
    const aspect = size.w / size.h
    if (aspect <= 1.5) return
    fg.d3Force('center', null)
    fg.d3Force('x', forceX(0).strength(0.02))
    fg.d3Force('y', forceY(0).strength(Math.min(0.3, 0.02 * aspect * aspect)))
    fg.d3ReheatSimulation()
  }, [size.w, size.h])

  // ── Hero drift: a damped "breath" every few seconds while visible ────────
  // Reheat sets alpha back to 1, which is violent under normal physics — so
  // drift mode also forces heavy velocity damping (below) and a long interval,
  // turning each pulse into a slow swell instead of a lurch.
  useEffect(() => {
    if (!drift || !inView || paused) return
    const t = setInterval(() => fgRef.current?.d3ReheatSimulation(), 12000)
    return () => clearInterval(t)
  }, [drift, inView, paused])

  // ── Painting (shared with #/viz) ──────────────────────────────────────────
  const highlightedLinks = useMemo(
    () => buildHighlightedLinkSet(links, highlights),
    [links, highlights]
  )

  const drawNode = useCallback((node, ctx, gs) => {
    const o = nodeOverrides?.get(node.id)
    paintNode(o ? { ...node, ...o } : node, ctx, gs, { highlights, labelZoom })
  }, [highlights, nodeOverrides, labelZoom])

  const drawLink = useCallback((link, ctx, gs) => {
    paintLink(link, ctx, gs, { highlightedLinks })
  }, [highlightedLinks])

  // Camera policy: never chase, only rescue. A timer-driven zoomToFit makes
  // the viewport rubber-band while the sim runs; instead, on a throttle we
  // check whether the layout actually escaped the frame (or collapsed into a
  // small corner of it) and refit only then. Otherwise the camera holds still.
  const lastFitRef = useRef(0)
  const nodeCountRef = useRef(0)
  nodeCountRef.current = nodes.length
  const nodesRef = useRef(nodes)
  nodesRef.current = nodes
  const sizeRef = useRef(size)
  sizeRef.current = size

  const handleEngineTick = useCallback(() => {
    if (fit === 'none' || nodeCountRef.current === 0) return
    if (fit === 'once' && fittedRef.current) return
    const now = performance.now()
    if (now - lastFitRef.current < 700) return
    const fg = fgRef.current
    if (!fg) return

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodesRef.current) {
      if (typeof n.x !== 'number') continue
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    }
    if (minX === Infinity) return

    const tl = fg.graph2ScreenCoords(minX, minY)
    const br = fg.graph2ScreenCoords(maxX, maxY)
    const { w, h } = sizeRef.current
    const m = 10
    const escaped = tl.x < m || tl.y < m || br.x > w - m || br.y > h - m
    // Rescue also when the layout has contracted into a fraction of the frame
    // (post-fit charge settling shrinks it); wide hysteresis vs the ~90% span
    // a fresh zoomToFit produces, so this never oscillates.
    const tooSmall = (br.x - tl.x) < w * 0.55 && (br.y - tl.y) < h * 0.55
    if (escaped || tooSmall) {
      lastFitRef.current = now
      fg.zoomToFit(500, fitPadding)
    }
  }, [fit, fitPadding])

  const handleEngineStop = useCallback(() => {
    if (fit === 'none' || nodeCountRef.current === 0) return
    if (fit === 'once' && fittedRef.current) return
    fittedRef.current = true
    fgRef.current?.zoomToFit(500, fitPadding)
  }, [fit, fitPadding])

  // Seed unpositioned nodes at a linked neighbor (+ small jitter): a node
  // added by a reveal step or stepper grows out of its parent instead of
  // flying in from a random corner of the simulation.
  const graphData = useMemo(() => {
    const byId = new Map(nodes.map(n => [n.id, n]))
    for (const n of nodes) {
      if (typeof n.x === 'number') continue
      for (const l of links) {
        const s = typeof l.source === 'object' ? l.source.id : l.source
        const t = typeof l.target === 'object' ? l.target.id : l.target
        const other = s === n.id ? byId.get(t) : t === n.id ? byId.get(s) : null
        if (other && typeof other.x === 'number') {
          n.x = other.x + (Math.random() - 0.5) * 36
          n.y = other.y + (Math.random() - 0.5) * 36
          break
        }
      }
    }
    return { nodes, links }
  }, [nodes, links])

  // Drift mode forces heavy damping so reheat pulses swell rather than lurch;
  // an explicit physics prop still wins.
  const effectivePhysics = drift
    ? { d3AlphaDecay: 0.03, d3VelocityDecay: 0.75, ...physics }
    : physics

  return (
    <div
      ref={wrapRef}
      className="embedded-graph"
      style={{
        position: 'relative',
        width: '100%',
        height,
        overflow: 'hidden',
        touchAction: 'pan-y',
      }}
    >
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={4}
          maxZoom={5}
          nodeLabel={showTooltip ? (n => n.value || n.label || '') : (() => '')}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintNodePointerArea}
          linkCanvasObject={drawLink}
          linkCanvasObjectMode={() => 'replace'}
          enableNodeDrag={interactive && !COARSE_POINTER}
          enableZoomInteraction={false}
          enablePanInteraction={false}
          onNodeClick={onNodeClick ?? undefined}
          onBackgroundClick={onBackgroundClick ?? undefined}
          warmupTicks={5}
          cooldownTicks={100}
          d3AlphaDecay={0.028}
          d3VelocityDecay={0.45}
          onEngineTick={handleEngineTick}
          onEngineStop={handleEngineStop}
          {...effectivePhysics}
        />
      )}
    </div>
  )
}
