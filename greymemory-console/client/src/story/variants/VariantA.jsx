// VariantA — "PRODUCT" direction: top-tier dev-tool SaaS finish.
// Sticky glass nav · split hero with the live graph as hero image · bento
// card system · one amber glow accent · prose cut to captions, numbers lead.

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
import './variant-a.css'

/* ── helpers ─────────────────────────────────────────────────────────── */

const scrollTo = (id) => (e) => {
  e.preventDefault()
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function Section({ id, eyebrow, title, intro, children }) {
  return (
    <section className="va-section" id={id}>
      <div className="va-eyebrow">{eyebrow}</div>
      <h2 className="va-h2">{title}</h2>
      {intro && <p className="va-intro">{intro}</p>}
      <div className="va-section-body">{children}</div>
    </section>
  )
}

/* ── nav ─────────────────────────────────────────────────────────────── */

const NAV = [
  ['abilities', 'Abilities'],
  ['pipeline', 'Pipeline'],
  ['relations', 'Relations'],
  ['time', 'Time travel'],
  ['retrieval', 'Retrieval'],
  ['benchmark', 'Benchmark'],
]

function Nav() {
  return (
    <nav className="va-nav">
      <div className="va-nav-inner">
        <a className="va-wordmark" href="#top" onClick={scrollTo('top')}>
          <span className="va-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>grey<b>memory</b></span>
        </a>
        <div className="va-nav-links">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={scrollTo(id)}>{label}</a>
          ))}
        </div>
        <a className="va-btn primary sm" href="#/viz">Live graph →</a>
      </div>
    </nav>
  )
}

/* ── hero ────────────────────────────────────────────────────────────── */

const PAPER_BARS = [
  { label: 'GPT-4o · full context', v: 91.8, hot: true },
  { label: 'ChatGPT long-term memory', v: 57.7 },
  { label: 'Coze memory', v: 33.0 },
]

const HERO_STATS = [
  ['80.0%', 'LongMemEval overall'],
  ['115k', 'tokens per haystack'],
  ['25,000+', 'memories in live demo'],
  ['1 file', 'SQLite · no cloud deps'],
]

function Hero() {
  const [data] = useState(() => ({
    nodes: heroGraphJson.nodes.map(n => ({ ...n })),
    links: heroGraphJson.links.map(l => ({ ...l })),
  }))

  return (
    <header className="va-hero" id="top">
      <div className="va-hero-grid">
        <div className="va-hero-copy">
          <div className="va-eyebrow">Self-hosted memory for AI agents</div>
          <h1 className="va-h1">Agents forget.<br />greymemory doesn&rsquo;t.</h1>
          <p className="va-intro hero">
            Atomic memories extracted from conversation, contradictions superseded
            with history kept, hybrid search over one SQLite file — any LLM and
            embedder you bring.
          </p>

          <div className="va-paper">
            <div className="va-paper-title">LongMemEval — memory is the bottleneck</div>
            {PAPER_BARS.map(b => (
              <div key={b.label} className="va-paper-row">
                <span className="l">{b.label}</span>
                <span className="bar"><i className={b.hot ? 'hot' : ''} style={{ width: `${b.v}%` }} /></span>
                <span className="n">{b.v.toFixed(1)}%</span>
              </div>
            ))}
          </div>

          <div className="va-cta-row">
            <a className="va-btn primary" href="#/viz">Open the live graph →</a>
            <a className="va-btn" href="#abilities" onClick={scrollTo('abilities')}>How it works ↓</a>
          </div>
        </div>

        <div className="va-hero-graph">
          <div className="va-hero-frame">
            <EmbeddedGraph
              nodes={data.nodes}
              links={data.links}
              height="100%"
              drift
              fit="always"
              fitPadding={60}
              showTooltip={false}
              labelZoom={Infinity}
              physics={{ d3VelocityDecay: 0.55, d3AlphaDecay: 0.03, cooldownTicks: 200 }}
            />
            <div className="va-hero-chip">real LongMemEval run · drag a node</div>
          </div>
        </div>
      </div>

      <div className="va-stat-row">
        {HERO_STATS.map(([n, l]) => (
          <div key={l} className="va-stat">
            <div className="n">{n}</div>
            <div className="l">{l}</div>
          </div>
        ))}
      </div>
    </header>
  )
}

/* ── abilities ───────────────────────────────────────────────────────── */

const ABILITIES = [
  { abbr: 'IE', name: 'Information Extraction', desc: 'Recall one detail from months of chat.', q: '“Where did I initially keep my old sneakers?”', mech: 'BM25 + vector hybrid' },
  { abbr: 'MR', name: 'Multi-Session Reasoning', desc: 'Synthesize across scattered sessions.', q: '“How many Korean restaurants have I tried in my city?”', mech: 'EXTENDS expansion' },
  { abbr: 'KU', name: 'Knowledge Updates', desc: 'Answer with the new fact, not the old.', q: '“How many engineers do I lead now?”', mech: 'UPDATES supersession' },
  { abbr: 'TR', name: 'Temporal Reasoning', desc: 'Reason about when, not just what.', q: '“How many days passed between my two fishing trips?”', mech: 'event dates + time-aware queries' },
  { abbr: 'ABS', name: 'Abstention', desc: 'Know what it doesn’t know.', q: '“How many autographed footballs do I own?” (they collect baseballs)', mech: 'answers “I don’t know”' },
]

function Abilities() {
  return (
    <div className="va-ability-grid">
      {ABILITIES.map(a => (
        <div key={a.abbr} className="va-card va-ability">
          <div className="abbr">{a.abbr}</div>
          <div className="name">{a.name}</div>
          <div className="desc">{a.desc}</div>
          <div className="mech">{a.mech}</div>
          <div className="q">{a.q}</div>
        </div>
      ))}
    </div>
  )
}

/* ── pipeline ────────────────────────────────────────────────────────── */

const PIPE_STEPS = [
  { key: 'chunks', label: 'persist chunks' },
  { key: 'extract', label: 'extract' },
  { key: 'dedup', label: 'dedup' },
  { key: 'classify', label: 'classify' },
  { key: 'graph', label: 'graph' },
]

const PIPE_NOTES = {
  chunks: <>Raw chunks persist <b>before</b> any LLM runs — a failed extraction never loses data.</>,
  extract: <>The LLM extracts atomic, self-contained memories — typed <code>fact</code> / <code>preference</code> / <code>episode</code>.</>,
  dedup: <>Batch near-duplicates merge at cosine &gt; 0.92 before anything is written.</>,
  classify: <>&ldquo;Leads 5&rdquo; <b>UPDATES</b> &ldquo;leads 4&rdquo; — a singular attribute, so the stale fact dims.</>,
  graph: <>Nothing is deleted: <code>is_latest = 0</code> + <code>superseded_by</code> keep history queryable.</>,
}

function PipelineDemo() {
  const [step, setStep] = useState(0)
  const k = PIPE_STEPS[step].key

  // Auto-advance the stepper once scrolled into view; any click takes over.
  const cardRef = useRef(null)
  const userDrove = useRef(false)
  const inView = useInView(cardRef)
  useEffect(() => {
    if (!inView || userDrove.current) return
    const t = setInterval(() => {
      setStep(s => (s >= PIPE_STEPS.length - 1 ? s : s + 1))
    }, 1700)
    return () => clearInterval(t)
  }, [inView])
  const pick = (i) => { userDrove.current = true; setStep(i) }

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
    <div className="va-card pad" ref={cardRef}>
      <div className="va-pipe-steps">
        {PIPE_STEPS.map((s, i) => (
          <button key={s.key}
            className={`va-pipe-step ${i === step ? 'active' : i < step ? 'done' : ''}`}
            onClick={() => pick(i)}>
            <span className="num">{i + 1}</span>{s.label}
          </button>
        ))}
      </div>

      <div className="va-pipe-body">
        <div className="va-pipe-left">
          <div className="va-mini-label">two sessions · two months apart</div>
          <div className={`va-chat ${k === 'chunks' ? 'hl' : ''} ${k === 'classify' || k === 'graph' ? 'dim' : ''}`}>
            <span className="sess">may 2023</span>
            I just started my new role as Senior Software Engineer — I lead a team of 4 engineers.
          </div>
          <div className={`va-chat ${k === 'chunks' ? 'hl' : ''} ${k === 'classify' || k === 'graph' ? 'dim' : ''}`}>
            <span className="sess">july 2023</span>
            Quick update — we hired another engineer, so I now lead a team of 5.
          </div>
          {step >= 2 && (
            <div className="va-dedup">
              <span className="tag">dedup</span>
              &ldquo;Senior Software Engineer&rdquo; ×2 → merged (cosine 0.97 &gt; 0.92)
            </div>
          )}
          <div className="va-pipe-note">{PIPE_NOTES[k]}</div>
        </div>

        <div className="va-pipe-graph">
          <EmbeddedGraph nodes={nodes} links={links} height={250} nodeOverrides={overrides} labelZoom={1.1} />
        </div>
      </div>
    </div>
  )
}

const CP_STRIP = [
  ['CP1 · value', 'Round-level decomposition', 'sharper retrieval units'],
  ['CP2 · key', 'Fact-augmented keys', '+9.4% recall'],
  ['CP3 · query', 'Time-aware expansion', '+6.8–11.3% recall'],
  ['CP4 · reading', 'Chain-of-Note + JSON', 'up to +10pt accuracy'],
]

function CpStrip() {
  return (
    <div className="va-cp-strip">
      {CP_STRIP.map(([cp, what, gain]) => (
        <div key={cp} className="va-card va-cp">
          <div className="cp">{cp}</div>
          <div className="what">{what}</div>
          <div className="gain">{gain}</div>
        </div>
      ))}
    </div>
  )
}

/* ── taxonomy ────────────────────────────────────────────────────────── */

const TAX_FACTORIES = { UPDATES: makeUpdatesGraph, EXTENDS: makeExtendsGraph, DERIVES: makeDerivesGraph }

const TAX = {
  UPDATES: {
    color: '#b16cf0',
    body: <>A contradiction on a <b>singular attribute</b> — employer, city, team size — supersedes the old fact: <code>is_latest = 0</code>, <code>superseded_by</code> set. Google → Stripe → Anthropic.</>,
    rule: 'Never for preferences. Additive concepts must use EXTENDS or NEW.',
  },
  EXTENDS: {
    color: '#74e3a3',
    body: <>A refinement links to what it refines — city → neighborhood → block. Search walks these edges <b>forward</b>.</>,
    rule: 'One strong hit pulls in its whole neighborhood.',
  },
  DERIVES: {
    color: '#f0b657',
    body: <><code>runDerivations()</code> infers <b>new</b> memories from combinations of existing ones — sources and a confidence score attached.</>,
    rule: 'A separate, explicit phase — said vs. inferred stays auditable.',
  },
}

function TaxonomyDemo() {
  const [tab, setTab] = useState('UPDATES')
  const [inView, setInView] = useState(false)

  return (
    <div className="va-card pad">
      <div className="va-tax-tabs">
        {Object.keys(TAX).map(key => (
          <button key={key}
            className={`va-tax-tab ${tab === key ? 'active' : ''}`}
            style={{ '--tab-c': TAX[key].color }}
            onClick={() => setTab(key)}>
            {key}
          </button>
        ))}
      </div>
      <div className="va-tax-body">
        <TaxGraph key={tab} tab={tab} inView={inView} onVisible={setInView} />
        <div className="va-tax-text">
          <p>{TAX[tab].body}</p>
          <div className="rule"><b>Guardrail</b>{TAX[tab].rule}</div>
        </div>
      </div>
    </div>
  )
}

function TaxGraph({ tab, inView, onVisible }) {
  const factory = TAX_FACTORIES[tab]
  const { nodes, links, done, replay } = useGraphReveal(factory, { stepMs: 750, active: inView })
  return (
    <div className="va-tax-graph">
      <EmbeddedGraph nodes={nodes} links={links} height={280} labelZoom={1.1} onVisible={onVisible} />
      <div className="va-graph-bar">
        <span>real scenario data · drag the nodes</span>
        <button className="va-replay" onClick={replay} disabled={!done}>↻ replay</button>
      </div>
    </div>
  )
}

/* ── time travel ─────────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

function TimeDemo() {
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

  const employer = m >= 5 ? 'Stripe' : m >= 1 ? 'DataCorp' : '— unknown yet —'
  const employerStale = m < 1
  const gym = m >= 7 ? 'expired (July 31)' : m >= 2 ? 'active' : '— unknown yet —'
  const gymExpired = m >= 7

  const ticks = [
    { at: 1, color: '#e8eef5', cap: 'fact: DataCorp' },
    { at: 2, color: '#f0b657', cap: 'gym starts' },
    { at: 5, color: '#b16cf0', cap: 'UPDATES: Stripe' },
    { at: 7, color: '#ff6b8a', cap: 'gym expires' },
  ]

  return (
    <div className="va-card pad">
      <div className="va-time-graph">
        <EmbeddedGraph nodes={nodes} links={links} nodeOverrides={overrides} height={250} labelZoom={1.1} />
      </div>

      <div className="va-time-answers">
        <div className="va-answer">
          <div className="q">search("where do they work?", {'{'} asOf {'}'})</div>
          <div className={`a ${employerStale ? 'stale' : ''}`}>{employer}</div>
        </div>
        <div className="va-answer">
          <div className="q">search("gym membership?", {'{'} asOf {'}'})</div>
          <div className={`a ${gymExpired ? 'stale' : ''}`}>{gym}</div>
        </div>
      </div>

      <input className="va-slider" type="range" min="0" max="9" value={m}
        onChange={e => setM(Number(e.target.value))} />
      <div className="va-time-label">as of · <b>{MONTHS[m]} 2023</b></div>

      <div className="va-time-track">
        {ticks.map(t => (
          <div key={t.cap} className="va-tick" style={{ left: `${(t.at / 9) * 100}%` }}>
            <i style={{
              background: m >= t.at ? t.color : 'transparent',
              borderColor: t.color,
              opacity: m >= t.at ? 1 : 0.3,
            }} />
            <span style={{ opacity: m >= t.at ? 0.9 : 0.35 }}>{t.cap}</span>
          </div>
        ))}
      </div>

      <div className="va-caption">
        <code>search(query, {'{'} asOf {'}'})</code> is just filters over the same graph — no re-ingestion.
      </div>
    </div>
  )
}

/* ── retrieval ───────────────────────────────────────────────────────── */

const BM25_ITEMS = ['"…lead a team of 5 engineers…"', '"…outing with 4 engineers + Rachel…"', '"…engineer interview loop…"']
const VEC_ITEMS = ['leads a team of 4 engineers (May)', 'leads a team of 5 engineers', 'team hired a backend engineer']
const FUSED_ITEMS = [
  { t: 'leads a team of 5 engineers', cls: 'fused' },
  { t: 'leads a team of 4 engineers', cls: 'fused' },
  { t: 'team hired a backend engineer', cls: 'fused' },
  { t: '+ team outing at City View Rooftop', cls: 'exp-e', tag: 'EXTENDS' },
  { t: '+ leads 4 → 5 (version history)', cls: 'exp-h', tag: 'history' },
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

  // Run the search once, automatically, when the demo scrolls into view.
  const cardRef = useRef(null)
  const autoRan = useRef(false)
  const inView = useInView(cardRef)
  useEffect(() => {
    if (inView && !autoRan.current) { autoRan.current = true; play() }
  }, [inView, play])

  const highlights = HIGHLIGHT_STAGES[stage] ?? null

  return (
    <div className="va-card pad" ref={cardRef}>
      <div className="va-ret-head">
        <span className="va-query">&ldquo;How many engineers do I lead now?&rdquo;</span>
        <button className="va-btn primary sm" onClick={play}>{stage === 0 ? '▶ run search' : '↻ replay'}</button>
      </div>

      <div className="va-ret-graph">
        <EmbeddedGraph nodes={ret.nodes} links={ret.links} highlights={highlights} height={240} labelZoom={1.1} />
      </div>

      <div className="va-ret-cols">
        <div className={`va-ret-col ${stage >= 1 ? 'lit' : ''}`}>
          <div className="t">keyword · FTS5 BM25</div>
          {BM25_ITEMS.map((t, i) => (
            <div key={t} className={`item ${stage >= 1 ? 'show' : ''}`} style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="rk">#{i + 1}</span>{t}
            </div>
          ))}
        </div>
        <div className={`va-ret-col ${stage >= 2 ? 'lit' : ''}`}>
          <div className="t">semantic · vector cosine</div>
          {VEC_ITEMS.map((t, i) => (
            <div key={t} className={`item ${stage >= 2 ? 'show' : ''}`} style={{ transitionDelay: `${i * 90}ms` }}>
              <span className="rk">#{i + 1}</span>{t}
            </div>
          ))}
        </div>
        <div className={`va-ret-col ${stage >= 3 ? 'lit' : ''}`}>
          <div className="t">RRF fusion → graph expansion</div>
          {FUSED_ITEMS.map((it, i) => {
            const visible = it.tag ? stage >= 4 : stage >= 3
            return (
              <div key={it.t} className={`item ${it.cls} ${visible ? 'show' : ''}`} style={{ transitionDelay: `${i * 90}ms` }}>
                <span className="rk">{it.tag ?? `#${i + 1}`}</span>{it.t}
              </div>
            )
          })}
        </div>
      </div>

      <div className="va-caption">
        Seeds glow <span style={{ color: '#5fd1e0' }}>cyan</span> · EXTENDS expansion <span style={{ color: '#74e3a3' }}>green</span> · version history <span style={{ color: '#b16cf0' }}>purple</span>.
      </div>
    </div>
  )
}

/* ── benchmark ───────────────────────────────────────────────────────── */

const BENCH = [
  ['single-session-user', 93.3, 97.1],
  ['single-session-assistant', 93.3, 96.4],
  ['knowledge-update', 80.0, 88.5],
  ['temporal-reasoning', 73.3, 76.7],
  ['single-session-preference', 66.7, 70.0],
  ['multi-session', 66.7, 71.4],
]

const BENCH_NOTES = [
  ['Paper’s harness', 'Evidence hidden among ~50 sessions per 115k-token haystack, scored by the official LLM-as-judge.'],
  ['96% of cloud', 'Of a funded cloud memory startup’s accuracy — from SQLite on your machine.'],
  ['$0.013 / session', 'Full ingestion cost, with per-phase token attribution built into the runner.'],
]

function Benchmark() {
  return (
    <>
      <div className="va-card pad">
        <table className="va-bench">
          <thead>
            <tr><th>LongMemEval category</th><th>greymemory</th><th>Supermemory (cloud)</th></tr>
          </thead>
          <tbody>
            {BENCH.map(([cat, us, them]) => (
              <tr key={cat}>
                <td>{cat}</td>
                <td className="us">
                  <span className="n">{us.toFixed(1)}%</span>
                  <span className="bar"><i style={{ width: `${us}%` }} /></span>
                </td>
                <td>
                  <span className="n">{them.toFixed(1)}%</span>
                  <span className="bar them"><i style={{ width: `${them}%` }} /></span>
                </td>
              </tr>
            ))}
            <tr className="total">
              <td>overall (90 questions)</td>
              <td className="us"><span className="n">80.0%</span></td>
              <td><span className="n">83.4%</span></td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="va-bench-notes">
        {BENCH_NOTES.map(([t, d]) => (
          <div key={t} className="va-card va-note">
            <div className="t">{t}</div>
            <div className="d">{d}</div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ── final CTA ───────────────────────────────────────────────────────── */

const LEGEND = [
  ['fact', '#e8eef5', 'dot'],
  ['preference', '#74e3a3', 'dot'],
  ['episode', '#f0b657', 'dot'],
  ['raw chunk', '#5fd1e0', 'dot'],
  ['UPDATES', '#b16cf0', 'line'],
  ['EXTENDS', '#74e3a3', 'line'],
  ['DERIVES', '#f0b657', 'line'],
]

function FinalCta() {
  return (
    <div className="va-final">
      <div className="va-eyebrow">try it</div>
      <h2 className="va-h2">Now read the real graph</h2>
      <p className="va-intro center">
        A live LongMemEval ingestion — 25,000+ memories across 86 users. Every color means what it meant here.
      </p>
      <div className="va-legend">
        {LEGEND.map(([label, c, kind]) => (
          <span key={label} className="chip">
            <i className={kind} style={{ background: c }} />
            {label}
          </span>
        ))}
      </div>
      <a className="va-btn primary lg" href="#/viz">Open the live graph →</a>
    </div>
  )
}

/* ── page ────────────────────────────────────────────────────────────── */

export function VariantA() {
  return (
    <div className="var-a">
      <Nav />
      <Hero />

      <main className="va-wrap">
        <Section id="abilities" eyebrow="the problem, measured" title="Five abilities, one benchmark"
          intro="What LongMemEval says a memory must do — and the greymemory mechanic behind each.">
          <Abilities />
        </Section>

        <Section id="pipeline" eyebrow="indexing → retrieval → reading" title="Conversation in, versioned graph out"
          intro="Two sessions disagree about the same fact. Step through what happens.">
          <PipelineDemo />
          <CpStrip />
        </Section>

        <Section id="relations" eyebrow="knowledge updates" title="Three edges, three meanings"
          intro="The classifier assigns one of three relation types — each with hard guardrails.">
          <TaxonomyDemo />
        </Section>

        <Section id="time" eyebrow="temporal reasoning" title="Query any moment"
          intro="Superseded facts keep their rows and dates — drag the slider through 2023.">
          <TimeDemo />
        </Section>

        <Section id="retrieval" eyebrow="information extraction · multi-session" title="One search, three passes"
          intro="A real benchmark query travels BM25, vectors, fusion, then the graph.">
          <RetrievalDemo />
        </Section>

        <Section id="benchmark" eyebrow="proof" title="Benchmarked, not vibes"
          intro="Scored with the paper's official judge, against a funded cloud competitor.">
          <Benchmark />
        </Section>

        <FinalCta />

        <footer className="va-foot">
          <span>greymemory — ESM · Node 18+ · better-sqlite3 · provider-agnostic</span>
          <span>ingestion → extraction → relationships → hybrid search → time travel</span>
        </footer>
      </main>
    </div>
  )
}
