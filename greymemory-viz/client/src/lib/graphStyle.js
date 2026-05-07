// graphStyle.js
//
// Central styling rules for graph nodes and links. Everything that paints to
// the canvas reads from here. The legend in the UI reads the SAME constants
// so they can never drift out of sync.

export const COLOR = {
  // Memory types — used for the node fill
  fact:       '#e8eef5',
  preference: '#74e3a3',
  episode:    '#f0b657',

  // Chunk node — neutral, distinct from facts
  chunk:      '#5fd1e0',

  // Relations
  EXTENDS:    '#74e3a3',
  UPDATES:    '#b16cf0',
  DERIVES:    '#f0b657',
  SOURCE:     'rgba(180, 200, 220, 0.18)',

  // States
  dimmed:     'rgba(160, 170, 180, 0.30)',
  forgotten:  '#ff6b8a',

  // Highlight states (debug retrieval mode)
  seed:       '#5fd1e0',
  expanded:   '#74e3a3',
  history:    '#b16cf0',

  bgShadow:   'rgba(0, 0, 0, 0.6)',
}

export function nodeFill(node, highlight) {
  if (highlight) {
    if (highlight.kind === 'seed')     return COLOR.seed
    if (highlight.kind === 'expanded') return COLOR.expanded
    if (highlight.kind === 'history')  return COLOR.history
  }

  if (node.type === 'chunk') return COLOR.chunk

  // Memory node
  if (node.is_expired) return COLOR.forgotten
  if (!node.is_latest) return COLOR.dimmed

  return COLOR[node.memory_type] ?? COLOR.fact
}

export function nodeRadius(node, highlight) {
  if (highlight?.kind === 'seed')     return 6
  if (highlight?.kind === 'expanded') return 4.5
  if (highlight?.kind === 'history')  return 3.5
  if (node.type === 'chunk')          return 3
  if (!node.is_latest)                return 2.5
  return 4
}

export function linkColor(link, highlightedLinks) {
  // When a query is active, dim everything except highlighted links
  if (highlightedLinks && !highlightedLinks.has(linkKey(link))) {
    return 'rgba(80, 90, 100, 0.05)'
  }
  return COLOR[link.relation] ?? COLOR.SOURCE
}

export function linkWidth(link, highlightedLinks) {
  if (highlightedLinks?.has(linkKey(link))) return 1.8
  if (link.relation === 'SOURCE') return 0.4
  return 0.7
}

export function linkKey(link) {
  const s = typeof link.source === 'object' ? link.source.id : link.source
  const t = typeof link.target === 'object' ? link.target.id : link.target
  return `${s}->${t}`
}
