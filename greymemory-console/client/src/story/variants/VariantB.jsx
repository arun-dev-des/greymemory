// VariantB — "The Memory Issue": an editorial design-magazine feature.
// Serif-led (Fraunces), museum-plate exhibits with numbered figure captions,
// hairline rules, one vermillion accent. Copy is cut to captions + pull-stats;
// the live graphs carry the story.
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { EmbeddedGraph } from '../EmbeddedGraph.jsx'
import { useGraphReveal, useInView } from '../useGraphReveal.js'
import { makeUpdatesGraph } from '../data/taxonomy-updates.js'
import { makeExtendsGraph } from '../data/taxonomy-extends.js'
import { makeDerivesGraph } from '../data/taxonomy-derives.js'
import { makeTimeTravelGraph } from '../data/time-travel.js'
import { makeRetrievalGraph, HIGHLIGHT_STAGES } from '../data/retrieval.js'
import { makePipelineGraph, PIPELINE_PATCHES } from '../data/pipeline.js'
import heroGraphJson from '../data/hero-graph.json'
import './variant-b.css'

/* ── shared editorial furniture ──────────────────────────────────────────── */

function scrollToLive(e) {
  e.preventDefault()
  // Jump straight to the graph itself, not the §07 intro copy above it.
  const el = document.getElementById('live-graph') ?? document.getElementById('live')
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Figure({ num, title, note, height = 320, children, toolbar = null }) {
  return (
    <figure className="vb-figure">
      <div className="vb-fig-head">
        <span className="vb-fig-no">fig. {num}</span>
        <span className="vb-fig-title">{title}</span>
        {toolbar && <span className="vb-fig-tools">{toolbar}</span>}
      </div>
      <div className="vb-plate" style={{ minHeight: height }}>{children}</div>
      {note && <figcaption className="vb-fig-note">{note}</figcaption>}
    </figure>
  )
}

function Section({ no, kicker, title, children }) {
  return (
    <section className="vb-section">
      <div className="vb-col vb-sec-head">
        <div className="vb-kicker"><span className="vb-secno">§ {no}</span>{kicker}</div>
        {title && <h2 className="vb-h2">{title}</h2>}
      </div>
      {children}
    </section>
  )
}

/* ── hero ────────────────────────────────────────────────────────────────── */

// Cohesive monoline marks — a designed set, not brand-logo reproductions.
function AgentMark({ kind }) {
  const p = {
    width: '1em', height: '1em', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  if (kind === 'claude')
    return <svg {...p} fill="currentColor" stroke="none"><path d="M12 2.2c.45 5 3.05 7.6 8 8-4.95.45-7.55 3.05-8 8-.45-4.95-3.05-7.55-8-8 4.95-.4 7.55-3 8-8Z" /></svg>
  if (kind === 'claw')
    return <svg {...p}><path d="M9.5 3C5.5 6 5.5 18 9.5 21" /><path d="M14.5 3c4 3 4 15 0 18" /></svg>
  if (kind === 'hermes')
    return <svg {...p}><path d="M4 15.5c6-5 12-5.2 16-3.3" /><path d="M7 18.4c4-3 8-3.3 12-1.6" /></svg>
  return <svg {...p}><polyline points="6 8 11 12 6 16" /><line x1="13" y1="16.4" x2="18" y2="16.4" /></svg>
}

const AGENTS = [
  { name: 'Claude', mark: 'claude' },
  { name: 'Openclaw', mark: 'claw' },
  { name: 'Hermes', mark: 'hermes' },
  { name: 'Opencode', mark: 'code' },
]

function RotatingAgent() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(x => (x + 1) % AGENTS.length), 2200)
    return () => clearInterval(t)
  }, [])
  const a = AGENTS[i]
  return (
    <span className="vb-agent-line" aria-live="polite">
      {/* key remounts the span each tick so the enter animation re-fires */}
      <span className="vb-agent" key={i}>
        <span className="vb-agent-mark"><AgentMark kind={a.mark} /></span>
        {a.name}
      </span>
    </span>
  )
}

function Hero() {
  return (
    <>
      <header className="vb-masthead">
        <span>greymemory</span>
        <span className="vb-mast-mid">a field study in machine memory</span>
        <span>no. 001</span>
      </header>

      <div className="vb-hero-center">
        <h1 className="vb-hero-h1">
          Self-hosted context engine<br />for AI agents like
        </h1>
        <RotatingAgent />
        <p className="vb-dek vb-hero-dek">
          A self-hosted memory layer: atomic memories extracted from conversation,
          contradictions detected, history kept — served from one SQLite file, with any LLM you bring.
        </p>
        <div className="vb-hero-ctas">
          <a className="vb-cta-fill" href="#live" onClick={scrollToLive}>Try the live graph <span className="vb-arrow-i">↓</span></a>
        </div>
      </div>

      <div className="vb-statband">
        <div className="vb-stat"><span className="n">80.0%</span><span className="l">LongMemEval overall</span></div>
        <div className="vb-stat"><span className="n">115k</span><span className="l">tokens per haystack</span></div>
        <div className="vb-stat"><span className="n">25,000+</span><span className="l">memories in the live demo</span></div>
        <div className="vb-stat"><span className="n">1 file</span><span className="l">SQLite — no cloud deps</span></div>
      </div>
    </>
  )
}

/* ── § 01 · the problem: pull-stat + ability index ───────────────────────── */

const ABILITIES = [
  { n: '01', abbr: 'IE', name: 'Information Extraction',
    q: '“Where did I initially keep my old sneakers?”', mech: 'hybrid BM25 + vector search' },
  { n: '02', abbr: 'MR', name: 'Multi-Session Reasoning',
    q: '“How many Korean restaurants have I tried in my city?”', mech: 'graph expansion via EXTENDS' },
  { n: '03', abbr: 'KU', name: 'Knowledge Updates',
    q: '“How many engineers do I lead now?”', mech: 'UPDATES supersession' },
  { n: '04', abbr: 'TR', name: 'Temporal Reasoning',
    q: '“How many days passed between my two fishing trips?”', mech: 'event dates + time-aware queries' },
  { n: '05', abbr: 'ABS', name: 'Abstention',
    q: '“How many autographed footballs do I own?” — they collect baseballs', mech: 'the hard one — resist confabulating; greymemory handles it only partially' },
]

function AbilityIndex() {
  const [open, setOpen] = useState('KU')
  return (
    <div className="vb-abilities">
      {ABILITIES.map(a => {
        const isOpen = open === a.abbr
        return (
          <div key={a.abbr} className={`vb-ab-row ${isOpen ? 'open' : ''}`}>
            <button className="vb-ab-head" onClick={() => setOpen(isOpen ? null : a.abbr)}>
              <span className="vb-ab-num">{a.n}</span>
              <span className="vb-ab-name">{a.name}</span>
              <span className="vb-ab-abbr">{a.abbr}</span>
              <span className="vb-ab-plus">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && (
              <div className="vb-ab-body">
                <span className="vb-ab-q">{a.q}</span>
                <span className="vb-ab-mech">→ {a.mech}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// The paper's central difficulty (§3.2): the user LLM is instructed to reveal
// facts INDIRECTLY. Toggle the same fact between how a benchmark declares it and
// how a real person buries it — extraction, not retrieval, is the hard part.
const EVIDENCE = {
  direct: [
    { who: 'user', text: 'I bought a new car last month.' },
    { who: 'assistant', text: 'Congrats! What kind did you get?' },
    { who: 'user', text: 'A Honda Civic.' },
  ],
  indirect: [
    { who: 'user', text: 'Can you explain the difference between collision and comprehensive coverage? I’m looking at insurance options for my Honda.' },
    { who: 'assistant', text: 'Sure — collision covers damage to your own car from accidents; comprehensive covers theft, weather, and the rest…' },
    { who: 'user', text: 'Got it. I just bought it last month, so I’m trying to get the right policy.' },
  ],
}

function IndirectEvidence() {
  const [mode, setMode] = useState('indirect')
  return (
    <div className="vb-evidence">
      <div className="vb-ev-head">
        <span className="vb-ev-label">the same fact, two ways</span>
        <span className="vb-ev-toggle">
          {['direct', 'indirect'].map(k => (
            <button key={k}
              className={`vb-step ${mode === k ? 'active' : ''}`}
              onClick={() => setMode(k)}>{k}</button>
          ))}
        </span>
      </div>
      <div className="vb-ev-convo">
        {EVIDENCE[mode].map((m, i) => (
          <p key={i} className={`vb-ev-line ${m.who}`}>
            <span className="vb-ev-who">{m.who}</span>{m.text}
          </p>
        ))}
      </div>
      <p className="vb-ev-note">
        Both convey <em>“user has a Honda, bought last month.”</em> LongMemEval instructs its
        simulator to reveal facts the <b>indirect</b> way, because that’s how people actually talk.
        A system that only extracts explicit “I bought X” statements never records the fact — so
        retrieval can’t recover it. greymemory’s extractor carries a STATE CHANGE RULE:
        catch it <em>even when stated casually mid-sentence as an aside.</em>
      </p>
    </div>
  )
}

function ProblemSection() {
  return (
    <Section no="01" kicker="the problem, measured · LongMemEval — arXiv 2410.10813">
      <div className="vb-pull-wrap">
        <div className="vb-pull">
          <div className="vb-pull-big">57.7<span className="vb-pull-pct">%</span></div>
          <div className="vb-pull-cap">ChatGPT long-term memory, scored on LongMemEval.</div>
        </div>
        <div className="vb-pull-side">
          <div className="vb-side-stat">
            <span className="n">91.8%</span>
            <span className="l">GPT-4o with the full transcript in context — offline</span>
          </div>
          <div className="vb-side-stat">
            <span className="n">33.0%</span>
            <span className="l">Coze long-term memory, same questions</span>
          </div>
          <p className="vb-side-note">Same questions. The gap is not the model — it is the memory.</p>
        </div>
      </div>

      <div className="vb-col">
        <p className="vb-body">
          It isn’t only proprietary memory that fails. Hand GPT-4o the whole transcript in its
          context window — the answer <em>is right there</em> — and it still loses a third of its
          accuracy to the surrounding noise: <b>87.0% → 60.6%</b>. Bigger context windows make this
          worse, not better (<em>lost in the middle</em>). Having the information isn’t using it.
        </p>
        <IndirectEvidence />
        <p className="vb-body">The paper distills what a memory must actually <em>do</em> into five abilities.</p>
        <AbilityIndex />
      </div>
    </Section>
  )
}

/* ── index-showcase layout: numbered list left, big exhibit right ────────── */
// Reference format: headline + lede + numbered index in the left column;
// the selected item's plate on the right with kicker · title · description.

function IndexShowcase({ no, kicker, title, lede, extra, items, active, onSelect, meta, accent = 'var(--vermillion)', children }) {
  return (
    <section className="vb-section vb-showcase-sec">
      <div className="vb-showcase">
        <div className="vb-sc-left">
          <div className="vb-kicker"><span className="vb-secno">§ {no}</span>{kicker}</div>
          <h2 className="vb-h2">{title}</h2>
          {lede && <p className="vb-sc-lede">{lede}</p>}
          {extra}
          <div className="vb-sc-index">
            {items.map((it) => {
              const isActive = it.key === active
              const color = it.color ?? accent
              return (
                <button key={it.key}
                  className={`vb-sc-row ${isActive ? 'active' : ''}`}
                  style={isActive ? { color } : undefined}
                  onClick={() => onSelect(it.key)}>
                  <span className="vb-sc-num">{it.num}</span>
                  <span className="vb-sc-name">{it.label}</span>
                  <span className="vb-sc-mark" style={isActive ? { background: color } : undefined} />
                </button>
              )
            })}
          </div>
        </div>

        <div className="vb-sc-right">
          <div className="vb-sc-plate">{children}</div>
          <div className="vb-sc-body">
            <div className="vb-sc-kicker" style={{ color: meta.color ?? accent }}>{meta.kicker}</div>
            <h3 className="vb-sc-title">{meta.title}</h3>
            <p className="vb-sc-desc">{meta.desc}</p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ── § 02 · mechanism: pipeline + CP table ───────────────────────────────── */

const PIPE_STEPS = [
  { key: 'chunks', label: 'persist chunks' },
  { key: 'extract', label: 'extract' },
  { key: 'dedup', label: 'dedup' },
  { key: 'classify', label: 'classify' },
  { key: 'graph', label: 'graph' },
]

const PIPE_TITLES = {
  chunks: 'Persist raw chunks',
  extract: 'Extract atomic memories',
  dedup: 'Embed & dedup',
  classify: 'Classify relationships',
  graph: 'The versioned graph',
}

const PIPE_CAP = {
  chunks: 'Raw chunks persist before any LLM runs — a failed extraction never loses data. CP1: round-level indexing.',
  extract: 'An LLM extracts atomic, typed memories (fact · preference · episode); facts also augment the chunk’s search keys — CP2.',
  dedup: 'Near-duplicates within the batch merge at cosine > 0.92: “Senior Software Engineer” ×2 → one memory.',
  classify: '“Leads 5 engineers” UPDATES “leads 4” — a singular attribute, so the stale fact dims instead of coexisting.',
  graph: 'A versioned graph. The old fact keeps its row: is_latest = 0, plus a superseded_by pointer.',
}

function PipelineFigure() {
  const [step, setStep] = useState(0)
  const k = PIPE_STEPS[step].key

  // Perform once on first scroll into view: assemble through the five steps,
  // then hand control back to the reader's clicks.
  const wrapRef = useRef(null)
  const inView = useInView(wrapRef)
  const autoRef = useRef({ played: false, timer: null })
  useEffect(() => {
    const auto = autoRef.current
    if (!inView || auto.played) return
    auto.played = true
    auto.timer = setInterval(() => {
      setStep(s => {
        if (s >= PIPE_STEPS.length - 1) { clearInterval(auto.timer); return s }
        return s + 1
      })
    }, 1200)
    return () => clearInterval(auto.timer)
  }, [inView])
  const manualStep = (key) => {
    clearInterval(autoRef.current.timer)
    setStep(PIPE_STEPS.findIndex(s => s.key === key))
  }

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
    <div ref={wrapRef}>
      <IndexShowcase
        no="02"
        kicker="mechanism · indexing → retrieval → reading"
        title={<>From conversation to <em>versioned</em> memory.</>}
        lede="Two sessions, two months apart, disagree about the same fact. Watch ingestion resolve it — the graph assembles as the steps land."
        extra={
          <div className="vb-epigraph vb-sc-epi">
            <p><span className="vb-epi-date">may 2023</span>“I just started my new role — I lead a team of 4 engineers.”</p>
            <p><span className="vb-epi-date">july 2023</span>“Quick update — we hired another engineer, so I now lead a team of 5.”</p>
          </div>
        }
        items={PIPE_STEPS.map((s, i) => ({ key: s.key, num: `0${i + 1}`, label: s.label }))}
        active={k}
        onSelect={manualStep}
        meta={{
          kicker: `0${step + 1} · ${PIPE_STEPS[step].label}`,
          title: PIPE_TITLES[k],
          desc: PIPE_CAP[k],
        }}
      >
        <EmbeddedGraph nodes={nodes} links={links} height="100%" nodeOverrides={overrides} labelZoom={1.1} />
      </IndexShowcase>

      <div className="vb-col">
        <p className="vb-body">
          The paper frames every memory system as four choices across three stages. Here’s
          greymemory next to ChatGPT’s memory and the paper’s own recommended design — greymemory
          matches the recommendation at every control point, and adds hybrid retrieval it doesn’t have.
        </p>
        <div className="vb-cp-scroll">
          <table className="vb-cp-table">
            <thead>
              <tr>
                <th>control point</th>
                <th>ChatGPT memory</th>
                <th>paper · “Our Design”</th>
                <th className="us">greymemory</th>
                <th className="gain">paper’s lift</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="cp">CP1 · value <span className="stage">indexing</span></td>
                <td>short snippets</td><td>round</td>
                <td className="us">round chunks + facts</td><td className="gain">sharper units</td>
              </tr>
              <tr>
                <td className="cp">CP2 · key <span className="stage">indexing</span></td>
                <td>K = V</td><td>K = V + fact</td>
                <td className="us">K = V + fact</td><td className="gain">+9.4% recall</td>
              </tr>
              <tr>
                <td className="cp">CP3 · query <span className="stage">retrieval</span></td>
                <td>question, no time</td><td>question + time</td>
                <td className="us">question + auto-extracted time</td><td className="gain">+6.8–11.3%</td>
              </tr>
              <tr>
                <td className="cp">CP4 · reading <span className="stage">reading</span></td>
                <td>prepend to prompt</td><td>Chain-of-Note + JSON</td>
                <td className="us">Chain-of-Note + JSON</td><td className="gain">up to +10pt</td>
              </tr>
              <tr>
                <td className="cp">retrieval</td>
                <td>opaque</td><td>flat dense</td>
                <td className="us">hybrid BM25 + vector + RRF</td><td className="gain">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/* ── § 03 · taxonomy figure with reveal + replay ─────────────────────────── */

const TAX_FACTORIES = { UPDATES: makeUpdatesGraph, EXTENDS: makeExtendsGraph, DERIVES: makeDerivesGraph }

const TAX_CAP = {
  UPDATES: 'Singular attributes supersede: Google → Stripe → Anthropic. Old facts keep their rows (is_latest = 0) — and preferences are never superseded, only strengthened.',
  EXTENDS: 'Refinement without contradiction: city → neighborhood → block. Walked forward at search time, so one hit pulls in its whole neighborhood.',
  DERIVES: 'runDerivations() infers new memories from combinations of existing ones — an explicit, separate phase, with sources and a confidence score attached.',
}
const TAX_COLOR = { UPDATES: '#b16cf0', EXTENDS: '#74e3a3', DERIVES: '#f0b657' }

const TAX_TITLES = {
  UPDATES: 'Supersession — the current truth wins',
  EXTENDS: 'Refinement — one hit pulls its neighborhood',
  DERIVES: 'Inference — new memories from old ones',
}

function TaxonomyFigure() {
  const [tab, setTab] = useState('UPDATES')
  const [inView, setInView] = useState(false)
  const keys = Object.keys(TAX_FACTORIES)
  return (
    <IndexShowcase
      no="03"
      kicker="knowledge updates"
      title={<>Three edges, three <em>meanings.</em></>}
      lede="Memories don’t just accumulate — they relate. The classifier assigns one of three edge types, each with hard guardrails. Real scenario data; every animation replays."
      items={keys.map((kk, i) => ({ key: kk, num: `0${i + 1}`, label: kk, color: TAX_COLOR[kk] }))}
      active={tab}
      onSelect={setTab}
      meta={{
        kicker: `0${keys.indexOf(tab) + 1} · ${tab}`,
        title: TAX_TITLES[tab],
        desc: TAX_CAP[tab],
        color: TAX_COLOR[tab],
      }}
    >
      <TaxReveal key={tab} tab={tab} inView={inView} onVisible={setInView} />
    </IndexShowcase>
  )
}

function TaxReveal({ tab, inView, onVisible }) {
  const factory = TAX_FACTORIES[tab]
  const { nodes, links, done, replay } = useGraphReveal(factory, { stepMs: 750, active: inView })
  return (
    <div className="vb-tax-plate">
      <EmbeddedGraph nodes={nodes} links={links} height="100%" labelZoom={1.1} onVisible={onVisible} />
      <button className="vb-replay" onClick={replay} disabled={!done}>↻ replay</button>
    </div>
  )
}

/* ── § 04 · time travel ──────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

function TimeFigure() {
  const [m, setM] = useState(9)

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

  const employer = m >= 5 ? 'Stripe' : m >= 1 ? 'DataCorp' : 'unknown yet'
  const employerStale = m < 1
  const gym = m >= 7 ? 'expired (July 31)' : m >= 2 ? 'active' : 'unknown yet'
  const gymExpired = m >= 7

  const ticks = [
    { at: 1, color: '#e8eef5', cap: 'works at DataCorp' },
    { at: 2, color: '#f0b657', cap: 'gym starts' },
    { at: 5, color: '#b16cf0', cap: 'UPDATES: Stripe' },
    { at: 7, color: '#ff6b8a', cap: 'gym expires' },
  ]

  return (
    <Figure
      num="01"
      title="time travel — the same graph, asked as of any month"
      height={280}
      note="No re-ingestion: search(query, { asOf }) is just filters over kept history. The live demo has this as the scrubber mode."
    >
      <EmbeddedGraph nodes={nodes} links={links} nodeOverrides={overrides} height={280} labelZoom={1.1} />
      <div className="vb-time-ui">
        <div className="vb-answers">
          <div className="vb-answer">
            <span className="q">search("where do they work?", {'{'} asOf {'}'})</span>
            <span className={`a ${employerStale ? 'stale' : ''}`}>→ {employer}</span>
          </div>
          <div className="vb-answer">
            <span className="q">search("gym membership?", {'{'} asOf {'}'})</span>
            <span className={`a ${gymExpired ? 'stale' : ''}`}>→ {gym}</span>
          </div>
        </div>
        <input className="vb-slider" type="range" min="0" max="9" value={m}
          onChange={e => setM(Number(e.target.value))} />
        <div className="vb-time-row">
          <span className="vb-asof">as of · {MONTHS[m]} 2023</span>
          <span className="vb-ticks">
            {ticks.map(t => (
              <span key={t.cap} className="vb-tick" style={{ opacity: m >= t.at ? 1 : 0.35 }}>
                <span className="dot" style={{ background: m >= t.at ? t.color : 'transparent', borderColor: t.color }} />
                {t.cap}
              </span>
            ))}
          </span>
        </div>
      </div>
    </Figure>
  )
}

/* ── § 05 · retrieval ────────────────────────────────────────────────────── */

const METHOD = ['FTS5 BM25', 'vector cosine', 'reciprocal-rank fusion', 'graph expansion']

const FUSED = [
  { t: 'Leads a team of 5 engineers', tag: '#1', cls: 'seed' },
  { t: 'Leads a team of 4 engineers', tag: '#2', cls: 'seed' },
  { t: 'Team hired a backend engineer', tag: '#3', cls: 'seed' },
  { t: 'Team outing at City View Rooftop', tag: 'EXTENDS', cls: 'ext', late: true },
  { t: 'leads 4 → 5 — version history', tag: 'HISTORY', cls: 'hist', late: true },
]

function RetrievalFigure() {
  const [stage, setStage] = useState(0)
  const timers = useRef([])
  const [ret] = useState(() => makeRetrievalGraph())

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout)
    setStage(0)
    timers.current = [1, 2, 3, 4].map(s => setTimeout(() => setStage(s), s * 700))
  }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Run the search once, unprompted, when the exhibit scrolls into view.
  const wrapRef = useRef(null)
  const inView = useInView(wrapRef)
  const playedRef = useRef(false)
  useEffect(() => {
    if (inView && !playedRef.current) {
      playedRef.current = true
      play()
    }
  }, [inView, play])

  const highlights = HIGHLIGHT_STAGES[stage] ?? null

  return (
    <div ref={wrapRef}>
    <Figure
      num="02"
      title="one query, retrieved"
      height={280}
      note="Seeds glow cyan as fusion lands; expansion pulls the outing in green (EXTENDS) and flips the stale fact to purple (version history) — the exact visual grammar of the live demo’s debug mode."
      toolbar={<button className="vb-step vb-run" onClick={play}>{stage === 0 ? '▶ run search' : '↻ replay'}</button>}
    >
      <div className="vb-query">“How many engineers do I lead now?”</div>
      <EmbeddedGraph nodes={ret.nodes} links={ret.links} highlights={highlights} height={250} labelZoom={1.1} />
      <div className="vb-method">
        {METHOD.map((mm, i) => (
          <span key={mm} className={`vb-mseg ${stage >= i + 1 ? 'lit' : ''}`}>
            {mm}{i < METHOD.length - 1 && <span className="sep"> → </span>}
          </span>
        ))}
      </div>
      <div className="vb-fused">
        {FUSED.map((it, i) => {
          const show = it.late ? stage >= 4 : stage >= 3
          return (
            <div key={it.t} className={`vb-fitem ${it.cls} ${show ? 'show' : ''}`}
              style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="tag">{it.tag}</span>{it.t}
            </div>
          )
        })}
      </div>
    </Figure>
    </div>
  )
}

/* ── § 06 · benchmark ────────────────────────────────────────────────────── */

// [category, GPT-4o full-history baseline (paper Table 4), greymemory, Supermemory]
const BENCH = [
  ['single-session-user', '81.4', '93.3', '97.1'],
  ['single-session-assistant', '94.6', '93.3', '96.4'],
  ['knowledge-update', '78.2', '80.0', '88.5'],
  ['temporal-reasoning', '45.1', '73.3', '76.7'],
  ['single-session-preference', '20.0', '66.7', '70.0'],
  ['multi-session', '44.3', '66.7', '71.4'],
]

function BenchSection() {
  return (
    <Section no="06" kicker="proof" title={<>Benchmarked, not <em>vibes.</em></>}>
      <div className="vb-col">
        <p className="vb-body">
          The story isn’t “three points behind a funded startup.” It’s the <b>lift over just using
          the context window</b> — greymemory adds <b>+47</b> on preference, <b>+28</b> on temporal,
          <b> +22</b> on multi-session, exactly the abilities a memory engine exists for.
        </p>
        <div className="vb-cp-scroll">
          <table className="vb-bench">
            <thead>
              <tr>
                <th>LongMemEval category</th>
                <th className="num base">context window*</th>
                <th className="num">greymemory</th>
                <th className="num">Supermemory (cloud)</th>
              </tr>
            </thead>
            <tbody>
              {BENCH.map(([cat, base, us, them]) => (
                <tr key={cat}>
                  <td>{cat}</td>
                  <td className="num base">{base}%</td>
                  <td className="num us">{us}%</td>
                  <td className="num them">{them}%</td>
                </tr>
              ))}
              <tr className="total">
                <td>overall</td>
                <td className="num base">60.6%</td>
                <td className="num us">80.0%</td>
                <td className="num them">83.4%</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="vb-footnotes">
          <p>*The paper’s GPT-4o long-context baseline — the whole 115k-token history dumped into one prompt (a separate run, shown for scale). greymemory’s numbers are its 90-question subset; Supermemory’s are its published run.</p>
          <p>Scored with the paper’s official LLM-as-judge; evidence sessions hidden among ~50 unrelated ones per 115k-token haystack.</p>
          <p>96% of a funded cloud memory startup’s accuracy — self-hosted, from SQLite, with any LLM and embedder you bring.</p>
          <p><span className="vb-money">$0.013 / session</span> full ingestion cost, per-phase token attribution built in.</p>
        </div>
      </div>
    </Section>
  )
}

/* ── § 07 · the live graph, embedded as a fold ───────────────────────────── */

function LiveVizFold() {
  // Lazy-mount when the fold nears the viewport, so the landing page's initial
  // load never pays for a second app + graph up front.
  const ref = useRef(null)
  const [load, setLoad] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setLoad(true); io.disconnect() }
    }, { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  // Probe for the console backend. On a static host (e.g. Vercel) there's no
  // Express API + SQLite, so instead of a dead iframe we fall back to a real
  // client-side interactive graph over the exported data.
  const [apiOk, setApiOk] = useState(null) // null=checking, true=live, false=static
  useEffect(() => {
    if (!load) return
    let done = false
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    fetch(`${import.meta.env.BASE_URL}api/viz/datasets`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => { if (!done) setApiOk(Array.isArray(d?.datasets) && d.datasets.length > 0) })
      .catch(() => { if (!done) setApiOk(false) })
      .finally(() => clearTimeout(t))
    return () => { done = true; ctrl.abort(); clearTimeout(t) }
  }, [load])

  const src = `${import.meta.env.BASE_URL}?embed=1#/viz`

  // Client-side fallback graph (real interaction: drag · hover · click-to-light)
  const [fallbackData] = useState(() => ({
    nodes: heroGraphJson.nodes.map(n => ({ ...n })),
    links: heroGraphJson.links.map(l => ({ ...l })),
  }))
  const [adjacency] = useState(() => {
    const adj = new Map()
    for (const l of heroGraphJson.links) {
      if (!adj.has(l.source)) adj.set(l.source, [])
      if (!adj.has(l.target)) adj.set(l.target, [])
      adj.get(l.source).push({ id: l.target, relation: l.relation })
      adj.get(l.target).push({ id: l.source, relation: l.relation })
    }
    return adj
  })
  const [highlights, setHighlights] = useState(null)
  const lightNeighborhood = (node) => {
    const m = new Map([[node.id, { kind: 'seed' }]])
    for (const nb of adjacency.get(node.id) ?? []) {
      m.set(nb.id, { kind: nb.relation === 'UPDATES' ? 'history' : 'expanded' })
    }
    setHighlights(m)
  }

  return (
    <section className="vb-section vb-liveviz" id="live" ref={ref}>
      <div className="vb-col">
        <div className="vb-kicker"><span className="vb-secno">§ 07</span>the door · play with it</div>
        <h2 className="vb-h2">Now read the <em>real</em> graph.</h2>
        <p className="vb-body">
          Not a diagram — a real LongMemEval memory graph. Hover a node to read the memory, click one
          to light its neighborhood, drag to explore. Every color means what it did above.
        </p>
        <div className="vb-legend">
          <span className="vb-key"><span className="sw" style={{ background: '#e8eef5' }} />fact</span>
          <span className="vb-key"><span className="sw" style={{ background: '#74e3a3' }} />preference</span>
          <span className="vb-key"><span className="sw" style={{ background: '#f0b657' }} />episode</span>
          <span className="vb-key"><span className="sw" style={{ background: '#5fd1e0' }} />raw chunk</span>
          <span className="vb-key"><span className="ln" style={{ background: '#b16cf0' }} />UPDATES</span>
          <span className="vb-key"><span className="ln" style={{ background: '#74e3a3' }} />EXTENDS</span>
          <span className="vb-key"><span className="ln" style={{ background: '#f0b657' }} />DERIVES</span>
        </div>
      </div>

      <div className="vb-liveviz-frame" id="live-graph">
        {!load || apiOk === null ? (
          <div className="vb-liveviz-poster">loading the graph…</div>
        ) : apiOk ? (
          <>
            <iframe className="vb-liveviz-iframe" src={src} title="greymemory — live memory graph" loading="lazy" />
            <a className="vb-liveviz-full" href="#/viz" target="_blank" rel="noreferrer">open full screen ↗</a>
          </>
        ) : (
          <div className="vb-liveviz-static">
            <EmbeddedGraph
              nodes={fallbackData.nodes}
              links={fallbackData.links}
              height="100%"
              drift
              fit="always"
              fitPadding={50}
              showTooltip
              highlights={highlights}
              onNodeClick={lightNeighborhood}
              onBackgroundClick={() => setHighlights(null)}
            />
            <div className="vb-liveviz-cap">
              interactive graph · full live LLM search runs against the console backend —{' '}
              <a href="https://github.com/arun-dev-des/greymemory" target="_blank" rel="noreferrer">run it locally ↗</a>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}

/* ── page ────────────────────────────────────────────────────────────────── */

export function VariantB() {
  return (
    <div className="var-b">
      <Hero />
      <ProblemSection />

      <PipelineFigure />
      <TaxonomyFigure />

      <Section no="04" kicker="temporal reasoning" title={<>Ask the past.</>}>
        <TimeFigure />
      </Section>

      <Section no="05" kicker="information extraction · multi-session reasoning" title={<>Retrieval follows the <em>graph.</em></>}>
        <RetrievalFigure />
      </Section>

      <BenchSection />
      <LiveVizFold />

      <footer className="vb-colophon">
        <span>greymemory — ESM · Node 18+ · better-sqlite3 · provider-agnostic by design</span>
        <span>ingestion → extraction → relationships → hybrid search → time travel</span>
      </footer>
    </div>
  )
}
