// useGraphReveal.js — timed build-up animation over a canned dataset.
//
// A dataset factory returns { nodes, links, timeline } where timeline steps
// are cumulative reveal instructions: { nodes: [id], links: ['src->tgt'],
// patch: { id: { is_latest: false } } }. The hook precomputes one node/link
// array per step from the SAME master objects (stable identities — the sim
// keeps positions and only heats for appended nodes), applies patches by
// in-place mutation as steps land, and advances on an interval while active.
//
// replay() rebuilds from the factory: fresh clones, because force-graph will
// have mutated the previous generation's objects.

import { useState, useRef, useEffect, useCallback } from 'react'

const linkKeyOf = (l) => `${l.source}->${l.target}`

function buildSteps(makeDataset) {
  const { nodes, links, timeline = [] } = makeDataset()
  const nodeById = new Map(nodes.map(n => [n.id, n]))
  const linkByKey = new Map(links.map(l => [linkKeyOf(l), l]))

  const steps = []
  let curNodes = []
  let curLinks = []
  for (const step of timeline) {
    curNodes = curNodes.concat((step.nodes ?? []).map(id => nodeById.get(id)).filter(Boolean))
    curLinks = curLinks.concat((step.links ?? []).map(k => linkByKey.get(k)).filter(Boolean))
    steps.push({ nodes: curNodes, links: curLinks, patch: step.patch ?? null })
  }
  // No timeline → single static step with everything.
  if (steps.length === 0) steps.push({ nodes, links, patch: null })
  return { steps, nodeById }
}

export function useGraphReveal(makeDataset, { stepMs = 700, active = true } = {}) {
  const [gen, setGen] = useState(0)          // bumping regenerates from the factory
  const [stepIndex, setStepIndex] = useState(0)
  const built = useRef(null)

  if (built.current === null || built.current.gen !== gen) {
    built.current = { gen, ...buildSteps(makeDataset) }
  }
  const { steps, nodeById } = built.current

  useEffect(() => {
    if (!active || stepIndex >= steps.length - 1) return
    const t = setInterval(() => {
      setStepIndex(i => {
        const next = Math.min(i + 1, steps.length - 1)
        const patch = steps[next]?.patch
        if (patch) {
          for (const [id, fields] of Object.entries(patch)) {
            const n = nodeById.get(id)
            if (n) Object.assign(n, fields)
          }
        }
        return next
      })
    }, stepMs)
    return () => clearInterval(t)
  }, [active, stepIndex, steps, nodeById, stepMs])

  const replay = useCallback(() => {
    setGen(g => g + 1)
    setStepIndex(0)
  }, [])

  const cur = steps[Math.min(stepIndex, steps.length - 1)]
  return {
    nodes: cur.nodes,
    links: cur.links,
    done: stepIndex >= steps.length - 1,
    step: stepIndex,
    replay,
  }
}

// Small standalone visibility hook for parents that need to gate animations
// on scroll position without owning an EmbeddedGraph.
export function useInView(ref, rootMargin = '120px 0px') {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { rootMargin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, rootMargin])
  return inView
}
