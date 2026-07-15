// StoryPage.jsx — the explainer/landing surface.
//
// A reviewer landing here should, in ~3 minutes, understand what greymemory
// is, why long-term memory is unsolved (the LongMemEval paper's findings),
// the core logic (extraction → relationships → supersession → hybrid
// retrieval → time travel), see honest benchmark numbers, and then step into
// the live graph (#/viz) already knowing what every color and edge means.
//
// Nothing here is a static picture: the hero and every demo section render
// real force-directed graphs (EmbeddedGraph) sharing the exact painters and
// palette of the live viz, fed by canned datasets under ./data/ (zero API
// calls at runtime). Storyline facts cite LongMemEval (arxiv 2410.10813).

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { EmbeddedGraph } from './EmbeddedGraph.jsx'
import { useGraphReveal } from './useGraphReveal.js'
import { makeUpdatesGraph } from './data/taxonomy-updates.js'
import { makeExtendsGraph } from './data/taxonomy-extends.js'
import { makeDerivesGraph } from './data/taxonomy-derives.js'
import { makeTimeTravelGraph } from './data/time-travel.js'
import { makeRetrievalGraph, HIGHLIGHT_STAGES } from './data/retrieval.js'
import { makePipelineGraph, PIPELINE_PATCHES } from './data/pipeline.js'
import heroGraphJson from './data/hero-graph.json'
import './story.css'

/* ── Hero: a real memory graph from the benchmark, drifting behind text ── */

function HeroSection() {
  // Clone the JSON singleton once per mount — force-graph mutates its data.
  const [data] = useState(() => ({
    nodes: heroGraphJson.nodes.map(n => ({ ...n })),
    links: heroGraphJson.links.map(l => ({ ...l })),
  }))

  return (
    <header className="story-hero">
      <div className="hero-graph-layer">
        <EmbeddedGraph
          nodes={data.nodes}
          links={data.links}
          height="100%"
          drift
          fit="always"
          fitPadding={70}
          showTooltip={false}
          labelZoom={Infinity}
          physics={{ d3VelocityDecay: 0.55, d3AlphaDecay: 0.03, cooldownTicks: 200 }}
        />
      </div>
      <div className="hero-overlay" />

      <div className="hero-content">
        <div className="story-kicker">greymemory · self-hosted memory for AI agents</div>
        <h1>Memory that knows<br />when facts <em>change</em>.</h1>
        <p className="story-lede">
          On <strong>LongMemEval</strong>, GPT-4o scores 91.8% when the chat history sits in front
          of it — but ChatGPT's long-term memory scores <strong>57.7%</strong> on the same
          questions, and Coze <strong>33.0%</strong>. Memory is unsolved, because lives change:
          jobs, cities, team sizes. greymemory extracts <strong>atomic memories</strong> from
          conversations, detects <strong>contradictions</strong>, supersedes stale facts while
          keeping their history, and serves the current truth from <strong>SQLite</strong> — with
          any LLM and embedder you bring.
        </p>
        <div className="story-cta-row">
          <a className="story-btn primary" href="#/viz">Open the live graph →</a>
          <a className="story-btn" href="#how">How it works ↓</a>
        </div>
        <div className="story-hero-stats">
          <div className="hero-stat"><div className="n">80.0%</div><div className="l">LongMemEval overall</div></div>
          <div className="hero-stat"><div className="n">115k</div><div className="l">tokens per haystack</div></div>
          <div className="hero-stat"><div className="n">25,000+</div><div className="l">memories in the live demo</div></div>
          <div className="hero-stat"><div className="n">1 file</div><div className="l">SQLite · no cloud deps</div></div>
        </div>
        <div className="hero-hint">
          the background is a real memory graph from a LongMemEval run — grab a node and drag it
        </div>
      </div>
    </header>
  )
}

/* ── The problem, measured: five abilities as flip cards ────────────────── */

const ABILITIES = [
  {
    abbr: 'IE', name: 'Information Extraction',
    desc: 'Recall one specific detail from months of conversation.',
    q: '“Where did I initially keep my old sneakers?”',
    mech: 'hybrid BM25 + vector search',
  },
  {
    abbr: 'MR', name: 'Multi-Session Reasoning',
    desc: 'Synthesize an answer scattered across many sessions.',
    q: '“How many Korean restaurants have I tried in my city?”',
    mech: 'graph expansion via EXTENDS',
  },
  {
    abbr: 'KU', name: 'Knowledge Updates',
    desc: 'Notice that a fact changed, and answer with the new one.',
    q: '“How many engineers do I lead now?”',
    mech: 'UPDATES supersession',
  },
  {
    abbr: 'TR', name: 'Temporal Reasoning',
    desc: 'Reason about when things happened, not just what.',
    q: '“How many days passed between my two fishing trips?”',
    mech: 'event dates + time-aware queries',
  },
  {
    abbr: 'ABS', name: 'Abstention',
    desc: 'Know what it doesn’t know — and say so.',
    q: '“How many autographed footballs do I own?” (they collect baseballs)',
    mech: 'answers “I don’t know”',
  },
]

function AbilityCards() {
  const [flipped, setFlipped] = useState(() => new Set())
  const toggle = (abbr) => {
    setFlipped(prev => {
      const next = new Set(prev)
      next.has(abbr) ? next.delete(abbr) : next.add(abbr)
      return next
    })
  }
  return (
    <div className="ability-grid">
      {ABILITIES.map(a => (
        <div key={a.abbr}
          className={`ability-card ${flipped.has(a.abbr) ? 'flipped' : ''}`}
          onClick={() => toggle(a.abbr)}>
          <div className="ability-inner">
            <div className="ability-face">
              <div className="ability-abbr">{a.abbr}</div>
              <div className="ability-name">{a.name}</div>
              <div className="ability-desc">{a.desc}</div>
              <div className="ability-flip-hint">flip ↻</div>
            </div>
            <div className="ability-face back">
              <div className="q">{a.q}</div>
              <div className="mech">→ {a.mech}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Pipeline (interactive stepper + a graph that assembles itself) ─────── */

const PIPE_STEPS = [
  { key: 'chunks', label: '1 · persist chunks' },
  { key: 'extract', label: '2 · extract memories' },
  { key: 'dedup', label: '3 · embed + dedup' },
  { key: 'classify', label: '4 · classify relationships' },
  { key: 'graph', label: '5 · graph' },
]

const PIPE_NOTES = {
  chunks: <>Every message is saved as a raw chunk (+ its embedding) <b>before</b> any LLM runs — a failed or empty extraction never loses data. This is the paper's <b>indexing</b> stage; greymemory indexes at <b>round granularity (CP1)</b>.</>,
  extract: <>An LLM extracts <b>atomic, self-contained memories</b> — each must pass a self-containment test and gets a type: <code>fact</code>, <code>preference</code>, or <code>episode</code>. Facts also augment the chunk's search keys — the paper's <b>CP2</b>, worth +9.4% recall.</>,
  dedup: <>Each memory is embedded; near-duplicates within the batch (cosine &gt; 0.92) are merged before anything is written.</>,
  classify: <>A classifier compares each new memory against existing ones. "Leads 5 engineers" <b>UPDATES</b> "leads 4 engineers" — team size is a singular attribute, so the old value is superseded, not kept alongside. Watch the stale fact dim below.</>,
  graph: <>The result is a versioned graph. The stale fact isn't deleted — it keeps <code>is_latest = 0</code> and a <code>superseded_by</code> pointer, so history and time-travel queries still work.</>,
}

function PipelineDemo() {
  const [step, setStep] = useState(0)
  const k = PIPE_STEPS[step].key

  // Stable dataset; visible slice grows with the stepper (same object
  // identities each render, so the sim keeps node positions).
  const [pipe] = useState(() => makePipelineGraph())
  const nodes = useMemo(() => pipe.nodes.filter(n => (n.step ?? 0) <= step), [pipe, step])
  const links = useMemo(() => pipe.links.filter(l => (l.step ?? 0) <= step), [pipe, step])
  const overrides = useMemo(() => {
    const m = new Map()
    for (const [atStep, patch] of Object.entries(PIPELINE_PATCHES)) {
      if (step >= Number(atStep)) {
        for (const [id, fields] of Object.entries(patch)) {
          m.set(id, { ...(m.get(id) ?? {}), ...fields })
        }
      }
    }
    return m.size ? m : null
  }, [step])

  return (
    <div className="demo-frame">
      <div className="pipe-steps">
        {PIPE_STEPS.map((s, i) => (
          <button key={s.key}
            className={`pipe-step ${i === step ? 'active' : i < step ? 'done' : ''}`}
            onClick={() => setStep(i)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="pipe-body">
        <div>
          <div className="pipe-col-title">the conversation (two sessions, two months apart)</div>
          <div className={`chat-msg ${k === 'chunks' ? 'hl' : ''} ${k === 'classify' || k === 'graph' ? 'dim' : ''}`}>
            <span className="sess">session · may 2023</span>
            <span className="who">user</span>
            I just started my new role as Senior Software Engineer — I lead a team of 4 engineers.
          </div>
          <div className={`chat-msg ${k === 'chunks' ? 'hl' : ''} ${k === 'classify' || k === 'graph' ? 'dim' : ''}`}>
            <span className="sess">session · july 2023</span>
            <span className="who">user</span>
            Quick update — we hired another engineer, so I now lead a team of 5.
          </div>
          {step >= 2 && (
            <div className="mem-card" style={{ borderLeftColor: 'var(--c-stale)' }}>
              <span className="badge">dedup</span>
              <div className="dedup">"User is a Senior Software Engineer" ×2 → merged (cosine 0.97 &gt; 0.92)</div>
            </div>
          )}
        </div>

        <div>
          <div className="pipe-col-title">the graph, assembling live — drag it</div>
          <EmbeddedGraph nodes={nodes} links={links} height={230} nodeOverrides={overrides} labelZoom={1.1} />
        </div>
      </div>

      <div className="pipe-note">{PIPE_NOTES[k]}</div>
    </div>
  )
}

const CP_STRIP = [
  { cp: 'CP1 · value', what: 'Round-level decomposition', gain: 'sharper retrieval units', stage: 'indexing' },
  { cp: 'CP2 · key', what: 'Fact-augmented key expansion', gain: '+9.4% recall · +5.4% accuracy', stage: 'indexing' },
  { cp: 'CP3 · query', what: 'Time-aware query expansion', gain: '+6.8–11.3% recall (temporal)', stage: 'retrieval' },
  { cp: 'CP4 · reading', what: 'Chain-of-Note + JSON output', gain: 'up to +10pt accuracy', stage: 'reading' },
]

function CpStrip() {
  return (
    <div className="cp-strip">
      {CP_STRIP.map(c => (
        <div key={c.cp} className="cp-chip">
          <div className="cp">{c.cp}</div>
          <div className="what">{c.what}</div>
          <div className="gain">{c.gain}</div>
          <div className="stage">{c.stage}</div>
        </div>
      ))}
    </div>
  )
}

/* ── Relationship taxonomy: live graphs that build themselves ───────────── */

const TAX_FACTORIES = {
  UPDATES: makeUpdatesGraph,
  EXTENDS: makeExtendsGraph,
  DERIVES: makeDerivesGraph,
}

const TAX = {
  UPDATES: {
    cls: 't-updates',
    body: <>When a new memory contradicts an old one on a <b>singular attribute</b> — employer, city, team size — the old fact is superseded. It keeps its row, flips <code style={{ color: '#b16cf0' }}>is_latest = 0</code>, and gains a <code style={{ color: '#b16cf0' }}>superseded_by</code> pointer. Watch the career arc replay: Google → Stripe → Anthropic, each old employer dimming as the purple UPDATES edge lands.</>,
    rule: <><b>Guardrail:</b> UPDATES is deliberately restricted to singular attributes. Additive concepts ("also plays tennis") must use EXTENDS or NEW — and preferences are <b>never</b> superseded; a repeated preference strengthens its confidence score instead.</>,
  },
  EXTENDS: {
    cls: 't-extends',
    body: <>When a new memory <b>refines</b> an existing one without contradicting it, it links via EXTENDS — here a location refines from a city to a neighborhood to a block, each refinement sprouting a green edge. At search time these edges are walked <b>forward</b>, so retrieving the seed pulls in its refinements.</>,
    rule: <><b>Why it matters:</b> one strong retrieval hit expands into its whole neighborhood — the answer often lives in a refinement the query never mentioned.</>,
  },
  DERIVES: {
    cls: 't-derives',
    body: <>Run on demand, <code style={{ color: '#f0b657' }}>runDerivations()</code> asks the LLM to infer <b>new</b> memories from combinations of existing ones — watch two parent facts pause, then their derived conclusion pop in with both amber edges attached. Derived memories carry their sources and a confidence score.</>,
    rule: <><b>Kept honest:</b> derivations are a separate, explicit phase — never mixed silently into ingestion — so you always know which memories were said vs. inferred.</>,
  },
}

function TaxonomyDemo() {
  const [tab, setTab] = useState('UPDATES')
  const [inView, setInView] = useState(false)

  return (
    <div className="demo-frame">
      <div className="tax-tabs">
        {Object.keys(TAX).map(k => (
          <button key={k} className={`tax-tab ${TAX[k].cls} ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {k}
          </button>
        ))}
      </div>
      <div className="tax-body">
        {/* key={tab} remounts: fresh clones + restarted reveal per tab */}
        <TaxonomyGraphWrapper key={tab} tab={tab} onVisible={setInView} inView={inView} />
        <div className="tax-text">
          <p style={{ marginTop: 0 }}>{TAX[tab].body}</p>
          <div className="rule">{TAX[tab].rule}</div>
        </div>
      </div>
    </div>
  )
}

// Bridges EmbeddedGraph's visibility signal into the reveal hook without
// re-rendering the whole demo frame.
function TaxonomyGraphWrapper({ tab, inView, onVisible }) {
  const factory = TAX_FACTORIES[tab]
  const { nodes, links, done, replay } = useGraphReveal(factory, { stepMs: 750, active: inView })
  return (
    <div>
      <EmbeddedGraph nodes={nodes} links={links} height={290} labelZoom={1.1} onVisible={onVisible} />
      <div className="graph-toolbar">
        <span className="hint">real scenario data · drag the nodes</span>
        <button className="replay-btn" onClick={replay} disabled={!done}>↻ replay</button>
      </div>
    </div>
  )
}

/* ── Time travel: the slider drives a live graph ────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

function TimeDemo() {
  const [m, setM] = useState(9) // month index, 0 = Jan 2023

  // Build once; capture link endpoint ids + dates BEFORE force-graph mutates
  // source/target into object refs.
  const [tt] = useState(() => {
    const data = makeTimeTravelGraph()
    const nodeById = new Map(data.nodes.map(n => [n.id, n]))
    const dateOf = (n) => n.document_date ?? (n.created_at ? n.created_at.slice(0, 10) : '2023-01-01')
    const updates = data.links
      .filter(l => l.relation === 'UPDATES')
      .map(l => ({ srcId: l.source, tgtDate: dateOf(nodeById.get(l.target)) }))
    const linkSpecs = data.links.map(l => ({ link: l, srcId: l.source, tgtId: l.target }))
    return { data, updates, linkSpecs, dateOf }
  })

  const asOf = `2023-${String(m + 1).padStart(2, '0')}-28`

  const { nodes, links, overrides } = useMemo(() => {
    const visible = tt.data.nodes.filter(n => tt.dateOf(n) <= asOf)
    const visibleIds = new Set(visible.map(n => n.id))
    const vlinks = tt.linkSpecs
      .filter(s => visibleIds.has(s.srcId) && visibleIds.has(s.tgtId))
      .map(s => s.link)
    const o = new Map()
    for (const u of tt.updates) {
      if (u.tgtDate <= asOf) o.set(u.srcId, { is_latest: false })
    }
    for (const n of tt.data.nodes) {
      if (n.expires_at && n.expires_at <= asOf) {
        o.set(n.id, { ...(o.get(n.id) ?? {}), is_expired: true })
      }
    }
    return { nodes: visible, links: vlinks, overrides: o.size ? o : null }
  }, [tt, asOf])

  const employer = m >= 5 ? 'Stripe' : m >= 1 ? 'DataCorp' : '— unknown yet —'
  const employerStale = m < 1
  const gym = m >= 7 ? 'expired (July 31)' : m >= 2 ? 'active' : '— unknown yet —'
  const gymExpired = m >= 7

  const ticks = [
    { at: 1, color: 'var(--c-fact)', cap: 'fact: works at DataCorp' },
    { at: 2, color: 'var(--c-epi)', cap: 'gym membership starts' },
    { at: 5, color: 'var(--c-updates)', cap: 'UPDATES: works at Stripe' },
    { at: 7, color: 'var(--c-stale)', cap: 'expires_at: gym ends' },
  ]

  return (
    <div className="demo-frame">
      <div className="demo-graph" style={{ marginTop: 0, marginBottom: 18 }}>
        <EmbeddedGraph nodes={nodes} links={links} nodeOverrides={overrides} height={250} labelZoom={1.1} />
      </div>

      <div className="time-grid">
        <div className="answer-card">
          <div className="q">search("where do they work?", {'{'} asOf {'}'})</div>
          <div className={`a ${employerStale ? 'expired' : ''}`}>{employer}</div>
        </div>
        <div className="answer-card">
          <div className="q">search("gym membership?", {'{'} asOf {'}'})</div>
          <div className={`a ${gymExpired ? 'expired' : ''}`}>{gym}</div>
        </div>
      </div>

      <input className="time-slider" type="range" min="0" max="9" value={m}
        onChange={e => setM(Number(e.target.value))} />
      <div className="time-label">as of · {MONTHS[m]} 2023</div>

      <div className="time-track">
        {ticks.map(t => (
          <div key={t.cap} className="time-tick" style={{ left: `${(t.at / 9) * 100}%` }}>
            <div className="dot" style={{
              background: m >= t.at ? t.color : 'transparent',
              border: `1.5px solid ${t.color}`,
              opacity: m >= t.at ? 1 : 0.3,
            }} />
            <div className="cap" style={{ opacity: m >= t.at ? 1 : 0.35 }}>{t.cap}</div>
          </div>
        ))}
      </div>

      <div className="demo-caption">
        Drag the slider: memories appear as their <code>document_date</code> passes, DataCorp dims
        when the June UPDATES lands, and the gym episode earns its red ✕ in August. No
        re-ingestion — <code>search(query, {'{'} asOf {'}'})</code> is just filters over the same
        graph. The live demo has this as the <b>scrubber</b> mode.
      </div>
    </div>
  )
}

/* ── Hybrid retrieval: columns + a graph lighting up in sync ────────────── */

const BM25_ITEMS = ['"…lead a team of 5 engineers…"', '"…outing with 4 engineers + Rachel…"', '"…engineer interview loop…"']
const VEC_ITEMS = ['leads a team of 4 engineers (May)', 'leads a team of 5 engineers', 'team hired a backend engineer']
const FUSED_ITEMS = [
  { t: 'leads a team of 5 engineers', cls: 'fused' },
  { t: 'leads a team of 4 engineers', cls: 'fused' },
  { t: 'team hired a backend engineer', cls: 'fused' },
  { t: '+ team outing at City View Rooftop', cls: 'exp-extends', tag: 'EXTENDS' },
  { t: '+ leads 4 → 5 (version history)', cls: 'exp-history', tag: 'history' },
]

function RetrievalDemo() {
  const [stage, setStage] = useState(0)
  const timers = useRef([])
  const [ret] = useState(() => makeRetrievalGraph())

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout)
    setStage(0)
    timers.current = [1, 2, 3, 4].map(s => setTimeout(() => setStage(s), s * 700))
  }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const highlights = HIGHLIGHT_STAGES[stage] ?? null

  return (
    <div className="demo-frame">
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="ret-query">"How many engineers do I lead now?"</span>
        <button className="story-btn" onClick={play}>{stage === 0 ? '▶ run search' : '↻ replay'}</button>
      </div>

      <div className="demo-graph">
        <EmbeddedGraph nodes={ret.nodes} links={ret.links} highlights={highlights} height={230} labelZoom={1.1} />
      </div>

      <div className="ret-cols">
        <div className={`ret-col ${stage >= 1 ? 'lit' : ''}`}>
          <div className="ret-col-title">keyword · SQLite FTS5 (BM25)</div>
          {BM25_ITEMS.map((t, i) => (
            <div key={t} className={`ret-item ${stage >= 1 ? 'show' : ''}`} style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="rk">#{i + 1}</span>{t}
            </div>
          ))}
        </div>
        <div className={`ret-col ${stage >= 2 ? 'lit' : ''}`}>
          <div className="ret-col-title">semantic · vector cosine</div>
          {VEC_ITEMS.map((t, i) => (
            <div key={t} className={`ret-item ${stage >= 2 ? 'show' : ''}`} style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="rk">#{i + 1}</span>{t}
            </div>
          ))}
        </div>
        <div className={`ret-col ${stage >= 3 ? 'lit' : ''}`}>
          <div className="ret-col-title">reciprocal-rank fusion → graph expansion</div>
          {FUSED_ITEMS.map((it, i) => {
            const visible = it.tag ? stage >= 4 : stage >= 3
            return (
              <div key={it.t} className={`ret-item ${it.cls} ${visible ? 'show' : ''}`} style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="rk">{it.tag ?? `#${i + 1}`}</span>{it.t}
              </div>
            )
          })}
        </div>
      </div>

      <div className="demo-caption">
        Press play: seeds glow <span style={{ color: 'var(--c-chunk)' }}>cyan</span> as fusion
        lands, then expansion pulls the outing in <span style={{ color: 'var(--c-pref)' }}>green</span> (EXTENDS)
        and flips the stale fact to <span style={{ color: 'var(--c-updates)' }}>purple</span> (version
        history) — while every untouched edge dims. This is exactly the visual grammar of the live
        demo's debug mode.
      </div>
    </div>
  )
}

/* ── Benchmark table ─────────────────────────────────────────────────────── */

const BENCH = [
  ['single-session-user', 93.3, 97.1],
  ['single-session-assistant', 93.3, 96.4],
  ['knowledge-update', 80.0, 88.5],
  ['temporal-reasoning', 73.3, 76.7],
  ['single-session-preference', 66.7, 70.0],
  ['multi-session', 66.7, 71.4],
]

function BenchmarkSection() {
  return (
    <div className="demo-frame">
      <table className="bench-table">
        <thead>
          <tr><th>LongMemEval category</th><th>greymemory</th><th>Supermemory (cloud)</th></tr>
        </thead>
        <tbody>
          {BENCH.map(([cat, us, them]) => (
            <tr key={cat}>
              <td>{cat}</td>
              <td className="us">{us.toFixed(1)}%<div className="bench-bar" style={{ width: `${us * 0.9}%` }} /></td>
              <td>{them.toFixed(1)}%<div className="bench-bar them" style={{ width: `${them * 0.9}%` }} /></td>
            </tr>
          ))}
          <tr className="total">
            <td>overall (90 questions)</td>
            <td className="us">80.0%</td>
            <td>83.4%</td>
          </tr>
        </tbody>
      </table>

      <div className="bench-notes">
        <div className="bench-note"><b>The paper's own harness</b>500 curated questions across the five abilities, evidence sessions hidden among ~50 unrelated ones per 115k-token haystack, scored by the paper's official LLM-as-judge — plus session-level Recall@k / NDCG@k against gold sessions.</div>
        <div className="bench-note"><b>Self-hosted vs cloud</b>96% of a funded cloud memory startup's accuracy — from SQLite on your own machine, with your own choice of LLM and embedder.</div>
        <div className="bench-note"><b>$0.013 / session</b>Full ingestion cost per conversation session, with per-phase token attribution built into the benchmark runner.</div>
      </div>
    </div>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function StoryPage() {
  return (
    <>
      <HeroSection />

      <div className="story-wrap">
        <section className="story-section" id="problem">
          <div className="story-kicker">the problem, measured · LongMemEval</div>
          <h2>Five things a memory must <em>do</em></h2>
          <p className="story-lede">
            The <a href="https://arxiv.org/abs/2410.10813" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>LongMemEval paper</a> found
            commercial assistants fail long-term memory in two ways: ChatGPT <strong>overwrote
            crucial information</strong> as chats continued, and Coze <strong>missed information
            given indirectly</strong>. It distills what memory must actually do into five
            abilities — flip each card to see a real benchmark question and the greymemory
            mechanic that answers it.
          </p>
          <AbilityCards />
        </section>

        <section className="story-section" id="how">
          <div className="story-kicker">the paper's framework · indexing → retrieval → reading</div>
          <h2>From conversation to <em>versioned</em> memory</h2>
          <p className="story-lede">
            The paper proposes a unified <strong>indexing → retrieval → reading</strong> design
            with four measured optimizations — greymemory implements all four. Step through what
            happens when two sessions, two months apart, disagree about the same fact, and watch
            the graph assemble itself.
          </p>
          <PipelineDemo />
          <CpStrip />
        </section>

        <section className="story-section">
          <div className="story-kicker">ability · knowledge updates</div>
          <h2>Three edges, three <em>meanings</em></h2>
          <p className="story-lede">
            Memories don't just accumulate — they relate. The classifier assigns one of three
            relation types, each with hard guardrails so the graph stays trustworthy. These are
            live graphs of real scenario data: watch each story build, then drag it around.
          </p>
          <TaxonomyDemo />
        </section>

        <section className="story-section">
          <div className="story-kicker">ability · temporal reasoning</div>
          <h2>Ask the past: <em>time travel</em></h2>
          <p className="story-lede">
            Because superseded facts keep their rows and their dates, any query can be answered
            <i> as of</i> any moment. Drag the slider and watch the graph live through 2023.
          </p>
          <TimeDemo />
        </section>

        <section className="story-section">
          <div className="story-kicker">abilities · information extraction + multi-session reasoning</div>
          <h2>Retrieval that follows the <em>graph</em></h2>
          <p className="story-lede">
            A question about "now" needs both the current fact and the awareness that it changed.
            Run one real query and watch it travel the full pipeline — in the lists and in the
            graph at once.
          </p>
          <RetrievalDemo />
        </section>

        <section className="story-section">
          <div className="story-kicker">proof</div>
          <h2>Benchmarked, not <em>vibes</em></h2>
          <p className="story-lede">
            Scored on LongMemEval with the paper's official judge, against a funded cloud
            competitor. The hero question of the live demo — "how many engineers do I lead now?" —
            is itself a knowledge-update question from this benchmark.
          </p>
          <BenchmarkSection />
        </section>

        <section className="story-section">
          <div className="story-kicker">try it</div>
          <h2>Now read the <em>real</em> graph</h2>
          <p className="story-lede">
            The live demo is a real LongMemEval ingestion — 25,000+ extracted memories across 86
            users. It opens on the engineers user: click the suggested question, watch retrieval
            light up the seeds, the EXTENDS expansion, and the supersession chain. Every color
            below means exactly what it meant in the graphs you just played with.
          </p>
          <div className="legend-row">
            <span className="legend-chip"><span className="sw" style={{ background: 'var(--c-fact)' }} />fact</span>
            <span className="legend-chip"><span className="sw" style={{ background: 'var(--c-pref)' }} />preference</span>
            <span className="legend-chip"><span className="sw" style={{ background: 'var(--c-epi)' }} />episode</span>
            <span className="legend-chip"><span className="sw" style={{ background: 'var(--c-chunk)' }} />raw chunk</span>
            <span className="legend-chip"><span className="ln" style={{ background: 'var(--c-updates)' }} />UPDATES</span>
            <span className="legend-chip"><span className="ln" style={{ background: 'var(--c-pref)' }} />EXTENDS</span>
            <span className="legend-chip"><span className="ln" style={{ background: 'var(--c-epi)' }} />DERIVES</span>
          </div>
          <div className="story-cta-row">
            <a className="story-btn primary" href="#/viz">Open the live graph →</a>
          </div>
        </section>

        <footer className="story-foot">
          <span>greymemory — ESM · Node 18+ · better-sqlite3 · provider-agnostic by design</span>
          <span>ingestion → extraction → relationships → hybrid search → time travel</span>
        </footer>
      </div>
    </>
  )
}
