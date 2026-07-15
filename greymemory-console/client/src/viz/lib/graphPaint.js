// graphPaint.js
//
// Pure canvas painters for the graph, extracted verbatim from Graph.jsx.
// Closed-over React state (highlights, selected, highlightedLinks) arrives
// as an options argument instead — no behavior change.

import { COLOR, nodeFill, nodeRadius, linkColor, linkWidth, linkKey } from './graphStyle.js'

// ── Node painter ───────────────────────────────────────────────────────────
export function paintNode(node, ctx, globalScale, { highlights = null, selected = null, labelZoom = 2.5 } = {}) {
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
  if (globalScale > labelZoom && node.type === 'memory') {
    ctx.font = `${10 / globalScale}px JetBrains Mono`
    ctx.fillStyle = 'rgba(235, 240, 245, 0.8)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    const label = (node.label || '').slice(0, 24)
    ctx.fillText(label, node.x, node.y + r + 2)
  }
}

// ── Link painter ───────────────────────────────────────────────────────────
export function paintLink(link, ctx, globalScale, { highlightedLinks = null } = {}) {
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
}

// ── Pointer-area painter ───────────────────────────────────────────────────
export function paintNodePointerArea(node, color, ctx) {
  // Fatter hit area than the visible node
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(node.x, node.y, 8, 0, Math.PI * 2)
  ctx.fill()
}

// Build the highlighted-link set for a given highlights map, so links
// touching highlighted nodes get the brighter treatment. Returns null when
// there are no highlights.
export function buildHighlightedLinkSet(links, highlights) {
  if (!highlights || highlights.size === 0) return null
  const ids = new Set(highlights.keys())
  const set = new Set()
  for (const l of links) {
    const s = typeof l.source === 'object' ? l.source.id : l.source
    const t = typeof l.target === 'object' ? l.target.id : l.target
    if (ids.has(s) || ids.has(t)) set.add(linkKey(l))
  }
  return set
}
