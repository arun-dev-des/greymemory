// Graph.jsx
//
// Wraps react-force-graph-2d. Custom canvas painters draw nodes and links
// using the rules in graphStyle.js. The same simulation persists across
// mode changes — modes only swap the highlight overlay.

import { useRef, useEffect, useMemo, useCallback } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { COLOR, nodeFill, nodeRadius, linkColor, linkWidth, linkKey } from '../lib/graphStyle.js'

export function Graph({ nodes, links, mode, highlights, selected, onSelect, loading }) {
  const fgRef = useRef()
  const containerRef = useRef()

  // Build the highlighted-link set whenever highlights change, so links
  // touching highlighted nodes get the brighter treatment.
  const highlightedLinks = useMemo(() => {
    if (!highlights || highlights.size === 0) return null
    const ids = new Set(highlights.keys())
    const set = new Set()
    for (const l of links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source
      const t = typeof l.target === 'object' ? l.target.id : l.target
      if (ids.has(s) || ids.has(t)) set.add(linkKey(l))
    }
    return set
  }, [highlights, links])

  // Center on the selected node when it changes
  useEffect(() => {
    if (!selected || !fgRef.current) return
    const fg = fgRef.current
    // The node may not have x/y yet on first render — wait one tick
    requestAnimationFrame(() => {
      const n = nodes.find(x => x.id === selected.id)
      if (n && n.x !== undefined && n.y !== undefined) {
        fg.centerAt(n.x, n.y, 600)
        fg.zoom(3, 600)
      }
    })
  }, [selected, nodes])

  // When highlights arrive (debug mode), zoom to fit the highlighted set
  useEffect(() => {
    if (!highlights || highlights.size === 0 || !fgRef.current) return
    const fg = fgRef.current
    const ids = new Set(highlights.keys())
    const targets = nodes.filter(n => ids.has(n.id))
    if (targets.length === 0) return
    requestAnimationFrame(() => {
      // Compute bounding box and fit
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
      for (const t of targets) {
        if (t.x === undefined) continue
        if (t.x < minX) minX = t.x; if (t.x > maxX) maxX = t.x
        if (t.y < minY) minY = t.y; if (t.y > maxY) maxY = t.y
      }
      if (!isFinite(minX)) return
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      fg.centerAt(cx, cy, 600)
      // Heuristic zoom — wider spread → less zoom
      const spread = Math.max(maxX - minX, maxY - minY, 100)
      const zoom = Math.max(0.8, Math.min(3, 400 / spread))
      fg.zoom(zoom, 600)
    })
  }, [highlights, nodes])

  // ── Node painter ─────────────────────────────────────────────────────────
  const paintNode = useCallback((node, ctx, globalScale) => {
    const hi = highlights?.get(node.id)
    const r = nodeRadius(node, hi)
    const fill = nodeFill(node, hi)

    // Glow ring for highlighted nodes
    if (hi) {
      const glowR = r * 2.5
      const grad = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, glowR)
      grad.addColorStop(0, fill + 'aa')
      grad.addColorStop(1, fill + '00')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2)
      ctx.fill()
    }

    // Selection ring
    if (selected?.id === node.id) {
      ctx.strokeStyle = COLOR.seed
      ctx.lineWidth = 1.5 / globalScale
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2)
      ctx.stroke()
    }

    // The node itself
    ctx.fillStyle = fill
    if (node.type === 'chunk') {
      // Chunks render as small squares to differentiate from facts
      ctx.fillRect(node.x - r, node.y - r, r * 2, r * 2)
    } else {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fill()
    }

    // Forgotten / expired marker — strike through
    if (node.is_expired) {
      ctx.strokeStyle = COLOR.forgotten
      ctx.lineWidth = 1.2 / globalScale
      ctx.beginPath()
      ctx.moveTo(node.x - r, node.y - r)
      ctx.lineTo(node.x + r, node.y + r)
      ctx.moveTo(node.x + r, node.y - r)
      ctx.lineTo(node.x - r, node.y + r)
      ctx.stroke()
    }

    // Show label only when zoomed in enough
    if (globalScale > 2.5 && node.type === 'memory') {
      ctx.font = `${10 / globalScale}px JetBrains Mono`
      ctx.fillStyle = 'rgba(235, 240, 245, 0.8)'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const label = (node.label || '').slice(0, 24)
      ctx.fillText(label, node.x, node.y + r + 2)
    }
  }, [highlights, selected])

  // ── Link painter ─────────────────────────────────────────────────────────
  const paintLink = useCallback((link, ctx, globalScale) => {
    const color = linkColor(link, highlightedLinks)
    const width = linkWidth(link, highlightedLinks)

    const sx = link.source.x, sy = link.source.y
    const tx = link.target.x, ty = link.target.y
    if (sx === undefined || tx === undefined) return

    ctx.strokeStyle = color
    ctx.lineWidth = width / globalScale

    // UPDATES gets a subtle dashed pattern + arrowhead to show direction
    if (link.relation === 'UPDATES') {
      ctx.setLineDash([3 / globalScale, 2 / globalScale])
    } else {
      ctx.setLineDash([])
    }

    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(tx, ty)
    ctx.stroke()
    ctx.setLineDash([])

    // Arrowhead for UPDATES and DERIVES (directional relations)
    if (link.relation === 'UPDATES' || link.relation === 'DERIVES') {
      const angle = Math.atan2(ty - sy, tx - sx)
      const headLen = 6 / globalScale
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.moveTo(tx, ty)
      ctx.lineTo(tx - headLen * Math.cos(angle - Math.PI / 6), ty - headLen * Math.sin(angle - Math.PI / 6))
      ctx.lineTo(tx - headLen * Math.cos(angle + Math.PI / 6), ty - headLen * Math.sin(angle + Math.PI / 6))
      ctx.closePath()
      ctx.fill()
    }
  }, [highlightedLinks])

  // Disable interactivity in showcase mode for a cleaner aesthetic
  const interactive = mode !== 'showcase'

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
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          // Fatter hit area than the visible node
          ctx.fillStyle = color
          ctx.beginPath()
          ctx.arc(node.x, node.y, 8, 0, Math.PI * 2)
          ctx.fill()
        }}
        linkCanvasObject={paintLink}
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
      />

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
      `}</style>
    </div>
  )
}
