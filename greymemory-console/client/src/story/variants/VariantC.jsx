// VariantC — "INSTRUMENT" direction.
// The page is a dark scientific instrument: a bordered panel grid, monospace
// readouts, hardware-styled controls, graphs dominant. Copy is cut to terse
// annotations and label:value readouts; the live graphs carry the story.

import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { EmbeddedGraph } from '../EmbeddedGraph.jsx'
import { useGraphReveal } from '../useGraphReveal.js'
import { makeUpdatesGraph } from '../data/taxonomy-updates.js'
import { makeExtendsGraph } from '../data/taxonomy-extends.js'
import { makeDerivesGraph } from '../data/taxonomy-derives.js'
import { makeTimeTravelGraph } from '../data/time-travel.js'
import { makeRetrievalGraph, HIGHLIGHT_STAGES } from '../data/retrieval.js'
import { makePipelineGraph, PIPELINE_PATCHES } from '../data/pipeline.js'
import heroGraphJson from '../data/hero-graph.json'
import './variant-c.css'

const CONTAINER_ID = '031748ae'

/* ── Panel chrome ─────────────────────────────────────────────────────── */

function Panel({ pid, title, note, foot, children, className = '' }) {
  return (
    <section className={`vc-panel ${className}`}>
      <div className="p-head">
        <span className="p-id">{pid}</span>
        <span className="p-title">{title}</span>
        {note && <span className="p-note">{note}</span>}
      </div>
      <div className="p-body">{children}</div>
      {foot && (
        <div className="p-foot">
          {foot.map(([k, v]) => (
            <span key={k} className="fo">
              <span className="fk">{k}</span>
              <span className="fv">{v}</span>
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

/* ── PNL·00 hero ──────────────────────────────────────────────────────── */

const HERO_METERS = [
  ['gpt-4o · full history in context', 91.8],
  ['chatgpt long-term memory', 57.7],
  ['coze', 33.0],
]

const HERO_STATS = [
  ['80.0%', 'longmemeval overall'],
  ['115k', 'tokens / haystack'],
  ['25,000+', 'memories in live demo'],
  ['1 file', 'sqlite · no cloud deps'],
]

function Hero() {
  const [data] = useState(() => ({
    nodes: heroGraphJson.nodes.map(n => ({ ...n })),
    links: heroGraphJson.links.map(l => ({ ...l })),
  }))

  return (
    <section className="vc-hero">
      <div className="hero-canvas">
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
      </div>
      <div className="hero-shade" />

      <div className="hero-console">
        <div className="hero-k">self-hosted memory for ai agents</div>
        <h1>MEMORY THAT KNOWS<br />WHEN FACTS CHANGE<span className="cursor" /></h1>

        <div className="hero-meters">
          <div className="meters-cap">longmemeval accuracy · the gap greymemory closes</div>
          {HERO_METERS.map(([label, v]) => (
            <div key={label} className="meter">
              <span className="m-label">{label}</span>
              <span className="m-track"><span className="m-fill" style={{ width: `${v}%` }} /></span>
              <span className="m-val">{v.toFixed(1)}%</span>
            </div>
          ))}
        </div>

        <div className="hero-stats">
          {HERO_STATS.map(([n, l]) => (
            <div key={l} className="hstat">
              <div className="n">{n}</div>
              <div className="l">{l}</div>
            </div>
          ))}
        </div>

        <div className="hero-cta">
          <a className="vc-btn primary" href="#/viz">OPEN THE LIVE GRAPH →</a>
          <a className="vc-btn" href="#pnl-02">HOW IT WORKS ↓</a>
        </div>
      </div>

      <div className="p-foot hero-foot">
        <span className="fo"><span className="fk">bg</span><span className="fv">real longmemeval memory graph</span></span>
        <span className="fo"><span className="fk">nodes</span><span className="fv">{data.nodes.length}</span></span>
        <span className="fo"><span className="fk">links</span><span className="fv">{data.links.length}</span></span>
        <span className="fo"><span className="fk">interaction</span><span className="fv">drag a node</span></span>
      </div>
    </section>
  )
}

/* ── PNL·01 five abilities ────────────────────────────────────────────── */

const ABIL = [
  { k: 'IE', name: 'information extraction', probe: '“Where did I initially keep my old sneakers?”', mech: 'hybrid BM25 + vector search' },
  { k: 'MR', name: 'multi-session reasoning', probe: '“How many Korean restaurants have I tried in my city?”', mech: 'graph expansion via EXTENDS' },
  { k: 'KU', name: 'knowledge updates', probe: '“How many engineers do I lead now?”', mech: 'UPDATES supersession' },
  { k: 'TR', name: 'temporal reasoning', probe: '“How many days passed between my two fishing trips?”', mech: 'event dates + time-aware queries' },
  { k: 'ABS', name: 'abstention', probe: '“How many autographed footballs do I own?” — they collect baseballs', mech: 'answers “I don’t know”' },
]

function AbilityPanel() {
  const [sel, setSel] = useState('KU')
  const a = ABIL.find(x => x.k === sel)
  return (
    <Panel
      pid="PNL·01"
      title="FIVE ABILITIES A MEMORY MUST HAVE"
      note="longmemeval · arxiv 2410.10813"
      foot={[
        ['selected', a.k],
        ['abilities', '5'],
        ['source', 'benchmark questions, verbatim'],
      ]}
    >
      <div className="abil-switch">
        {ABIL.map(x => (
          <button
            key={x.k}
            className={`sw-key ${sel === x.k ? 'on' : ''}`}
            onClick={() => setSel(x.k)}
          >
            <span className="sw-lamp" />{x.k}
          </button>
        ))}
      </div>
      <div className="abil-readout">
        <div className="ro-line"><span className="ro-k">ability</span><span className="ro-v">{a.name}</span></div>
        <div className="ro-line"><span className="ro-k">probe</span><span className="ro-v probe">{a.probe}</span></div>
        <div className="ro-line"><span className="ro-k">mechanic</span><span className="ro-v sig">{a.mech}</span></div>
      </div>
    </Panel>
  )
}

/* ── PNL·02 ingestion pipeline ────────────────────────────────────────── */

const PIPE_STEPS = [
  { key: 'chunks', label: 'PERSIST' },
  { key: 'extract', label: 'EXTRACT' },
  { key: 'dedup', label: 'DEDUP' },
  { key: 'classify', label: 'CLASSIFY' },
  { key: 'graph', label: 'GRAPH' },
]

const PIPE_NOTES = {
  chunks: 'raw chunks + embeddings saved before any LLM runs — nothing is ever lost',
  extract: 'LLM extracts atomic memories — fact · preference · episode',
  dedup: 'batch near-duplicates merged at cosine > 0.92',
  classify: '“team of 5” UPDATES “team of 4” — singular attribute → supersede',
  graph: 'stale fact keeps its row: is_latest = 0 + superseded_by pointer',
}

const CP_CELLS = [
  ['CP1 · value', 'round-level chunks', 'sharper retrieval units'],
  ['CP2 · key', 'fact-augmented keys', '+9.4% recall'],
  ['CP3 · query', 'time-aware expansion', '+6.8–11.3% recall'],
  ['CP4 · reading', 'chain-of-note', '+10pt accuracy'],
]

function PipelinePanel() {
  const [step, setStep] = useState(0)
  const k = PIPE_STEPS[step].key
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
    <Panel
      pid="PNL·02"
      title="INGESTION PIPELINE"
      note="two sessions, two months apart, disagree"
      className="anchor"
      foot={[
        ['step', `${step + 1}/5`],
        ['nodes', nodes.length],
        ['links', links.length],
        ['container', CONTAINER_ID],
      ]}
    >
      <span id="pnl-02" className="anchor-target" />
      <div className="stepper">
        {PIPE_STEPS.map((s, i) => (
          <button
            key={s.key}
            className={`step-key ${i === step ? 'on' : i < step ? 'done' : ''}`}
            onClick={() => setStep(i)}
          >
            <span className="step-bar" />
            <span className="step-n">{i + 1}</span>{s.label}
          </button>
        ))}
      </div>

      <div className="pipe-grid">
        <div className="pipe-graph">
          <EmbeddedGraph nodes={nodes} links={links} height={320} nodeOverrides={overrides} labelZoom={1.1} fitPadding={44} />
        </div>
        <div className="pipe-side">
          <div className="side-cap">input feed</div>
          <div className={`feed-msg ${k === 'chunks' ? 'hl' : ''} ${step >= 3 ? 'dim' : ''}`}>
            <span className="f-meta">may 2023 · user</span>
            I just started as Senior Software Engineer — I lead a team of 4.
          </div>
          <div className={`feed-msg ${k === 'chunks' ? 'hl' : ''} ${step >= 3 ? 'dim' : ''}`}>
            <span className="f-meta">jul 2023 · user</span>
            We hired another engineer, so I now lead a team of 5.
          </div>
          {step >= 2 && (
            <div className="dedup-ro">
              <span className="ro-k">dedup</span>
              “Senior Software Engineer” ×2 → merged (cosine 0.97)
            </div>
          )}
          <div className="pipe-note">
            <span className="ro-k">note</span>{PIPE_NOTES[k]}
          </div>
        </div>
      </div>

      <div className="cp-row">
        {CP_CELLS.map(([cp, what, gain]) => (
          <div key={cp} className="cp-cell">
            <div className="cp-id">{cp}</div>
            <div className="cp-what">{what}</div>
            <div className="cp-gain">{gain}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ── PNL·03 relationship taxonomy ─────────────────────────────────────── */

const TAX_FACTORIES = { UPDATES: makeUpdatesGraph, EXTENDS: makeExtendsGraph, DERIVES: makeDerivesGraph }

const TAX_META = {
  UPDATES: {
    cls: 't-upd',
    line: 'singular attribute changed → old fact superseded, history kept',
    guard: 'guard: preferences are never superseded — repeats strengthen confidence',
  },
  EXTENDS: {
    cls: 't-ext',
    line: 'refinement, not contradiction — walked forward at search time',
    guard: 'effect: one strong hit pulls in its whole neighborhood',
  },
  DERIVES: {
    cls: 't-der',
    line: 'runDerivations() infers new memories from parents, with sources + confidence',
    guard: 'guard: explicit phase — said vs. inferred never blurs',
  },
}

function TaxonomyPanel() {
  const [tab, setTab] = useState('UPDATES')
  const [inView, setInView] = useState(false)
  return (
    <Panel
      pid="PNL·03"
      title="RELATIONSHIP TAXONOMY"
      note="three edges, three meanings"
      foot={[
        ['relation', tab],
        ['data', 'real scenario DBs'],
        ['interaction', 'drag · replay'],
      ]}
    >
      <TaxGraph key={tab} tab={tab} inView={inView} onVisible={setInView} setTab={setTab} />
    </Panel>
  )
}

function TaxGraph({ tab, inView, onVisible, setTab }) {
  const factory = TAX_FACTORIES[tab]
  const { nodes, links, done, replay } = useGraphReveal(factory, { stepMs: 750, active: inView })
  const meta = TAX_META[tab]
  return (
    <>
      <div className="tax-switch">
        {Object.keys(TAX_META).map(x => (
          <button key={x} className={`sw-key ${TAX_META[x].cls} ${tab === x ? 'on' : ''}`} onClick={() => setTab(x)}>
            <span className="sw-lamp" />{x}
          </button>
        ))}
        <button className="vc-btn mini" onClick={replay} disabled={!done}>↻ REPLAY</button>
      </div>
      <div className="tax-graph">
        <EmbeddedGraph nodes={nodes} links={links} height={310} labelZoom={1.1} fitPadding={44} onVisible={onVisible} />
      </div>
      <div className="tax-lines">
        <div className="ro-line"><span className="ro-k">rule</span><span className="ro-v">{meta.line}</span></div>
        <div className="ro-line"><span className="ro-k">&nbsp;</span><span className="ro-v dim">{meta.guard}</span></div>
      </div>
    </>
  )
}

/* ── PNL·04 time travel ───────────────────────────────────────────────── */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT']

function TimePanel() {
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
  const gym = m >= 7 ? 'expired (jul 31)' : m >= 2 ? 'active' : '— unknown yet —'
  const gymExpired = m >= 7

  const ticks = [
    { at: 1, color: 'var(--c-fact)', cap: 'fact: DataCorp' },
    { at: 2, color: 'var(--c-epi)', cap: 'gym starts' },
    { at: 5, color: 'var(--c-updates)', cap: 'UPDATES: Stripe' },
    { at: 7, color: 'var(--c-stale)', cap: 'gym expires' },
  ]

  const supersededCount = overrides ? [...overrides.values()].filter(v => v.is_latest === false).length : 0

  return (
    <Panel
      pid="PNL·04"
      title="TIME TRAVEL"
      note="search(query, { asOf }) — filters, not re-ingestion"
      foot={[
        ['asOf', `${MONTHS[m]} 2023`],
        ['visible', `${nodes.length} nodes`],
        ['superseded', supersededCount],
        ['container', CONTAINER_ID],
      ]}
    >
      <div className="time-graph">
        <EmbeddedGraph nodes={nodes} links={links} nodeOverrides={overrides} height={280} labelZoom={1.1} fitPadding={44} />
      </div>

      <div className="time-answers">
        <div className="ans-ro">
          <div className="ro-k">search(&quot;where do they work?&quot;)</div>
          <div className={`ans-v ${employerStale ? 'err' : ''}`}>{employer}</div>
        </div>
        <div className="ans-ro">
          <div className="ro-k">search(&quot;gym membership?&quot;)</div>
          <div className={`ans-v ${gymExpired ? 'err' : ''}`}>{gym}</div>
        </div>
      </div>

      <div className="scrub">
        <span className="scrub-cap">scrub</span>
        <input className="scrub-slider" type="range" min="0" max="9" value={m}
          onChange={e => setM(Number(e.target.value))} />
        <span className="scrub-read">{MONTHS[m]} 2023</span>
      </div>
      <div className="scrub-track">
        {ticks.map(t => (
          <div key={t.cap} className="scrub-tick" style={{ left: `${(t.at / 9) * 100}%` }}>
            <span className="dot" style={{
              background: m >= t.at ? t.color : 'transparent',
              border: `1.5px solid ${t.color}`,
              opacity: m >= t.at ? 1 : 0.3,
            }} />
            <span className="cap" style={{ opacity: m >= t.at ? 0.9 : 0.35 }}>{t.cap}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ── PNL·05 retrieval ─────────────────────────────────────────────────── */

const STAGE_LAMPS = ['BM25', 'VECTOR', 'FUSE', 'EXPAND']

const FUSED_ITEMS = [
  { t: 'leads a team of 5 engineers', cls: '', st: 3 },
  { t: 'leads a team of 4 engineers', cls: '', st: 3 },
  { t: 'team hired a backend engineer', cls: '', st: 3 },
  { t: '+ team outing at City View Rooftop', cls: 'ext', tag: 'EXTENDS', st: 4 },
  { t: '+ leads 4 → 5 (version history)', cls: 'hist', tag: 'HISTORY', st: 4 },
]

function RetrievalPanel() {
  const [stage, setStage] = useState(0)
  const timers = useRef([])
  const playedRef = useRef(false)
  const [ret] = useState(() => makeRetrievalGraph())

  const play = useCallback(() => {
    playedRef.current = true
    timers.current.forEach(clearTimeout)
    setStage(0)
    timers.current = [1, 2, 3, 4].map(s => setTimeout(() => setStage(s), s * 700))
  }, [])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // Attract mode: run once, automatically, the first time the panel scrolls
  // into view — the replay key stays for reruns.
  const onVisible = useCallback((vis) => {
    if (vis && !playedRef.current) play()
  }, [play])

  const highlights = HIGHLIGHT_STAGES[stage] ?? null

  return (
    <Panel
      pid="PNL·05"
      title="HYBRID RETRIEVAL + GRAPH EXPANSION"
      note="one real knowledge-update query"
      foot={[
        ['engine', 'sqlite fts5 + vector cosine → RRF'],
        ['expansion', 'EXTENDS forward · supersession history'],
        ['stage', `${stage}/4`],
      ]}
    >
      <div className="ret-rail">
        <span className="ret-query">&quot;How many engineers do I lead now?&quot;</span>
        <button className="vc-btn run" onClick={play}>{stage === 0 ? '▶ RUN SEARCH' : '↻ REPLAY'}</button>
        <span className="lamps">
          {STAGE_LAMPS.map((l, i) => (
            <span key={l} className={`lamp ${stage >= i + 1 ? 'lit' : ''}`}>
              <span className="lamp-dot" />{l}
            </span>
          ))}
        </span>
      </div>

      <div className="ret-graph">
        <EmbeddedGraph nodes={ret.nodes} links={ret.links} highlights={highlights} height={280} labelZoom={1.1} fitPadding={44} onVisible={onVisible} />
      </div>

      <div className="ret-out">
        <div className="side-cap">fused output · seeds → expansion</div>
        {FUSED_ITEMS.map((it, i) => (
          <div key={it.t}
            className={`ret-item ${it.cls} ${stage >= it.st ? 'show' : ''}`}
            style={{ transitionDelay: `${i * 90}ms` }}>
            <span className="rk">{it.tag ?? `#${i + 1}`}</span>{it.t}
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ── PNL·06 benchmark ─────────────────────────────────────────────────── */

const BENCH = [
  ['single-session-user', 93.3, 97.1],
  ['single-session-assistant', 93.3, 96.4],
  ['knowledge-update', 80.0, 88.5],
  ['temporal-reasoning', 73.3, 76.7],
  ['single-session-preference', 66.7, 70.0],
  ['multi-session', 66.7, 71.4],
]

function BenchPanel() {
  return (
    <Panel
      pid="PNL·06"
      title="BENCHMARKED, NOT VIBES"
      note="paper's official LLM-as-judge · 115k-token haystacks"
      foot={[
        ['questions', '90'],
        ['cost', '$0.013 / session ingestion'],
        ['setup', 'self-hosted sqlite vs funded cloud service'],
      ]}
    >
      <table className="bench">
        <thead>
          <tr><th>longmemeval category</th><th>greymemory</th><th>supermemory (cloud)</th></tr>
        </thead>
        <tbody>
          {BENCH.map(([cat, us, them]) => (
            <tr key={cat}>
              <td>{cat}</td>
              <td className="us">
                <span className="b-val">{us.toFixed(1)}%</span>
                <span className="b-track"><span className="b-fill us" style={{ width: `${us}%` }} /></span>
              </td>
              <td>
                <span className="b-val">{them.toFixed(1)}%</span>
                <span className="b-track"><span className="b-fill" style={{ width: `${them}%` }} /></span>
              </td>
            </tr>
          ))}
          <tr className="total">
            <td>overall</td>
            <td className="us"><span className="b-val">80.0%</span></td>
            <td><span className="b-val">83.4%</span></td>
          </tr>
        </tbody>
      </table>
    </Panel>
  )
}

/* ── PNL·07 legend + exit ─────────────────────────────────────────────── */

const LEGEND = [
  ['fact', 'var(--c-fact)', 'dot'],
  ['preference', 'var(--c-pref)', 'dot'],
  ['episode', 'var(--c-epi)', 'dot'],
  ['raw chunk', 'var(--c-chunk)', 'dot'],
  ['UPDATES', 'var(--c-updates)', 'line'],
  ['EXTENDS', 'var(--c-pref)', 'line'],
  ['DERIVES', 'var(--c-epi)', 'line'],
]

function ExitPanel() {
  return (
    <Panel
      pid="PNL·07"
      title="NOW READ THE REAL GRAPH"
      note="25,000+ memories · 86 users · one real ingestion"
      foot={[
        ['opens on', 'the engineers user'],
        ['grammar', 'same colors, same meanings'],
      ]}
    >
      <div className="legend">
        {LEGEND.map(([label, color, kind]) => (
          <span key={label} className="lg-chip">
            <span className={kind === 'dot' ? 'lg-dot' : 'lg-line'} style={{ background: color }} />
            {label}
          </span>
        ))}
      </div>
      <div className="exit-cta">
        <a className="vc-btn primary big" href="#/viz">OPEN THE LIVE GRAPH →</a>
      </div>
    </Panel>
  )
}

/* ── Page ─────────────────────────────────────────────────────────────── */

export function VariantC() {
  return (
    <div className="var-c">
      <div className="vc-topbar">
        <span className="tb-left">
          <span className="led" />
          <span className="tb-brand">greymemory</span>
          <span className="tb-sep">│</span>
          <span>v15</span>
          <span className="tb-sep">│</span>
          <span>dataset longmemeval_s</span>
          <span className="tb-sep">│</span>
          <span>25,545 memories</span>
          <span className="tb-sep">│</span>
          <span>container {CONTAINER_ID}</span>
        </span>
        <a className="tb-link" href="#/viz">#/viz →</a>
      </div>

      <div className="vc-frame">
        <Hero />
        <AbilityPanel />
        <PipelinePanel />
        <TaxonomyPanel />
        <TimePanel />
        <RetrievalPanel />
        <BenchPanel />
        <ExitPanel />

        <div className="vc-endbar">
          <span>ESM · node 18+ · better-sqlite3 · provider-agnostic</span>
          <span>ingest → extract → relate → search → time-travel</span>
        </div>
      </div>
    </div>
  )
}
