// EmbeddedGraph3D.jsx — a sized-container 3D force graph (Three.js/WebGL)
// for the hero: slow auto-orbit, drag-to-rotate, hover tooltips, and the same
// palette + highlight grammar as the 2D embeds (via graphStyle's accessors).
//
// Deliberately hero-only: exhibits stay 2D where the painter detail (dashes,
// arrows, strikes) carries meaning. Import lazily — this pulls in three.js.

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { nodeFill, linkColor as linkColorOf, linkKey, COLOR } from '../viz/lib/graphStyle.js'
import { buildHighlightedLinkSet } from '../viz/lib/graphPaint.js'

export function EmbeddedGraph3D({
  nodes,
  links,
  height = 400,
  highlights = null,       // Map<nodeId, {kind:'seed'|'expanded'|'history'}>
  rotateSpeed = 0.55,      // OrbitControls autoRotateSpeed (degrees-ish/frame)
  paused = false,
  showTooltip = true,
  fitPadding = 30,
  onNodeClick = null,
  onBackgroundClick = null,
}) {
  const wrapRef = useRef(null)
  const fgRef = useRef(null)
  const fittedRef = useRef(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [inView, setInView] = useState(false)

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

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { rootMargin: '120px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Pause the whole render loop (and the orbit) when offscreen.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    if (paused || !inView) fg.pauseAnimation()
    else fg.resumeAnimation()
  }, [paused, inView, size.w])

  // Wheel zoom / pan off so the page keeps scrolling; rotation stays on the
  // controls for drag-to-orbit.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || size.w === 0) return
    const controls = fg.controls()
    if (!controls) return
    controls.enableZoom = false
    controls.enablePan = false
  }, [size.w])

  // Ambient orbit: OrbitControls.autoRotate doesn't reliably tick inside
  // force-graph's loop, so we rotate the camera ourselves — incrementally
  // around the Y axis from wherever it currently is. Because each tick is a
  // delta on the CURRENT position, a user drag just changes the starting
  // point and the orbit continues seamlessly; we also hold while the pointer
  // is down. Starts only after the initial zoomToFit has settled.
  const [orbitReady, setOrbitReady] = useState(false)
  const pointerDownRef = useRef(false)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const down = () => { pointerDownRef.current = true }
    const up = () => { pointerDownRef.current = false }
    // Three's controls listen for wheel on the canvas (with preventDefault)
    // even when zoom is disabled. Intercept in the capture phase so the event
    // never reaches them — the page then scrolls natively.
    const stopWheel = (e) => e.stopPropagation()
    el.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    el.addEventListener('wheel', stopWheel, { capture: true, passive: true })
    return () => {
      el.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      el.removeEventListener('wheel', stopWheel, { capture: true })
    }
  }, [])

  useEffect(() => {
    if (!orbitReady || paused || !inView) return
    const step = (rotateSpeed * Math.PI) / 180 / 33  // ≈ rotateSpeed °/s at 30fps
    const t = setInterval(() => {
      const fg = fgRef.current
      if (!fg || pointerDownRef.current) return
      const { x, y, z } = fg.cameraPosition()
      const cos = Math.cos(step)
      const sin = Math.sin(step)
      fg.cameraPosition({ x: x * cos + z * sin, y, z: -x * sin + z * cos })
    }, 30)
    return () => clearInterval(t)
  }, [orbitReady, paused, inView, rotateSpeed])

  const highlightedLinks = useMemo(
    () => buildHighlightedLinkSet(links, highlights),
    [links, highlights]
  )

  const nodeColor = useCallback(
    (n) => nodeFill(n, highlights?.get(n.id) ?? null),
    [highlights]
  )
  const nodeVal = useCallback((n) => {
    const kind = highlights?.get(n.id)?.kind
    if (kind === 'seed') return 10
    if (kind === 'expanded') return 6.5
    if (kind === 'history') return 5
    if (n.type === 'chunk') return 1.6
    if (n.is_latest === false) return 1.2
    return 2.6
  }, [highlights])

  const linkColor = useCallback((l) => {
    if (!highlightedLinks) return COLOR[l.relation] ?? linkColorOf(l, null)
    return highlightedLinks.has(linkKey(l))
      ? (COLOR[l.relation] ?? '#9fb2c0')
      : 'rgba(80,90,100,0.08)'
  }, [highlightedLinks])

  const linkWidth = useCallback(
    (l) => (highlightedLinks && highlightedLinks.has(linkKey(l)) ? 2.2 : 1),
    [highlightedLinks]
  )

  const handleEngineStop = useCallback(() => {
    if (fittedRef.current) return
    fittedRef.current = true
    fgRef.current?.zoomToFit(600, fitPadding)
    // zoomToFit frames the full bounding sphere, which reads small — pull the
    // camera in afterwards (outer nodes may kiss the edges while orbiting,
    // which is the immersive look we want), then hand over to the orbit.
    setTimeout(() => {
      const fg = fgRef.current
      if (fg) {
        const { x, y, z } = fg.cameraPosition()
        fg.cameraPosition({ x: x * 0.7, y: y * 0.7, z: z * 0.7 }, undefined, 600)
      }
      setTimeout(() => setOrbitReady(true), 700)
    }, 900)
  }, [fitPadding])

  const graphData = useMemo(() => ({ nodes, links }), [nodes, links])

  return (
    <div
      ref={wrapRef}
      className="embedded-graph embedded-graph-3d"
      style={{ position: 'relative', width: '100%', height, overflow: 'hidden', touchAction: 'pan-y' }}
    >
      {size.w > 0 && size.h > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={size.w}
          height={size.h}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          showNavInfo={false}
          nodeLabel={showTooltip ? (n => n.value || n.label || '') : (() => '')}
          nodeColor={nodeColor}
          nodeVal={nodeVal}
          nodeOpacity={0.92}
          nodeResolution={12}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkOpacity={0.7}
          enableNodeDrag={false}
          onNodeClick={onNodeClick ?? undefined}
          onBackgroundClick={onBackgroundClick ?? undefined}
          warmupTicks={40}
          cooldownTicks={140}
          d3AlphaDecay={0.025}
          d3VelocityDecay={0.4}
          onEngineStop={handleEngineStop}
        />
      )}
    </div>
  )
}
