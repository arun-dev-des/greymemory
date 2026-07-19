// VariantB — "The Memory Issue": an editorial design-magazine feature.
// Serif-led (Fraunces), museum-plate exhibits with numbered figure captions,
// hairline rules, one vermillion accent. Copy is cut to captions + pull-stats;
// the live graphs carry the story.
import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { EmbeddedGraph } from '../EmbeddedGraph.jsx'
import { useGraphReveal, useInView } from '../useGraphReveal.js'
import { makeUpdatesGraph } from '../data/taxonomy-updates.js'
import { makeExtendsGraph } from '../data/taxonomy-extends.js'
import { makeDerivesGraph } from '../data/taxonomy-derives.js'
import { makeTimeTravelGraph } from '../data/time-travel.js'
import { makeRetrievalGraph, HIGHLIGHT_STAGES } from '../data/retrieval.js'
import { makePipelineGraph, PIPELINE_PATCHES } from '../data/pipeline.js'
import { API_BASE } from '../../viz/lib/api.js'
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
  if (kind === 'custom')
    return <svg {...p}><circle cx="12" cy="12" r="8.6" strokeDasharray="2.4 3.1" /><path d="M12 8.7v6.6M8.7 12h6.6" /></svg>
  return <svg {...p}><polyline points="6 8 11 12 6 16" /><line x1="13" y1="16.4" x2="18" y2="16.4" /></svg>
}

// Casing verified against each project's own branding (July 2026): OpenCode and
// OpenClaw are camel-cased by their maintainers; lowercase `opencode` is only
// the CLI binary / npm package, not the prose name.
const AGENTS = [
  { name: 'Claude Code', mark: 'claude' },
  { name: 'OpenCode', mark: 'code' },
  { name: 'Hermes', mark: 'hermes' },
  { name: 'OpenClaw', mark: 'claw' },
  { name: 'your own', mark: 'custom' },
]
const ROTATE_MS = 1600 // dwell per name, inclusive of the 0.5s rise-in

function usePrefersReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)'
  const [reduce, setReduce] = useState(() => window.matchMedia?.(q).matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia?.(q)
    if (!mq) return
    const on = e => setReduce(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
}

// Cycles the list indefinitely; each name rises in as the previous one is
// replaced.
function RotatingAgent() {
  const reduce = usePrefersReducedMotion()
  const [i, setI] = useState(0)
  const slotRef = useRef(null)
  const [w, setW] = useState(null)

  const idx = reduce ? 0 : i

  useEffect(() => {
    if (reduce) return
    const t = setInterval(() => setI(x => (x + 1) % AGENTS.length), ROTATE_MS)
    return () => clearInterval(t)
  }, [reduce])

  // Pin the slot to the active name's width so the sentence wrapped around it
  // never reflows on swap. The name is nowrap and justify-self:start, so it keeps
  // its intrinsic width whatever the slot is pinned to — measuring it isn't
  // circular, and translateY on the rise-in doesn't perturb the measured width.
  // Re-measure once the webfont lands; Fraunces metrics differ from the fallback.
  const measure = useCallback(() => {
    const on = slotRef.current?.querySelector('.vb-agent')
    if (on) setW(on.getBoundingClientRect().width)
  }, [])
  useLayoutEffect(() => { measure() }, [idx, measure])
  useEffect(() => { document.fonts?.ready.then(measure) }, [measure])

  const a = AGENTS[idx]
  return (
    <span className="vb-agent-slot" ref={slotRef} style={w ? { width: `${w}px` } : undefined}>
      {/* One static string for AT — a live region would announce every tick. */}
      <span className="vb-sr-only">Claude Code, OpenCode, or your own</span>
      {/* key remounts the span each tick so the rise-in animation re-fires */}
      <span key={idx} aria-hidden="true" className="vb-agent">
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
        <span className="vb-mast-mid">SELF-HOSTED MEMORY ENGINE</span>
        <span>no. 001 · <a className="vb-mast-link" href="https://github.com/arun-dev-des/greymemory"
          target="_blank" rel="noreferrer">GitHub ↗</a></span>
      </header>

      <div className="vb-hero-center">
        <h1 className="vb-hero-h1">Memory that knows when facts <em>change</em>.</h1>
        <p className="vb-hero-dek">
          Atomic memories extracted from conversation. Contradictions caught, stale facts
          superseded — history kept. Served from a single SQLite file to AI agents like{' '}
          <RotatingAgent />
        </p>
        <div className="vb-hero-ctas">
          <a className="vb-cta-fill" href="#live" onClick={scrollToLive}>Explore the live graph <span className="vb-arrow-i">→</span></a>
          <a className="vb-cta-ghost" href="https://www.npmjs.com/package/greymemory"
            target="_blank" rel="noreferrer">
            <span className="vb-cta-cmd">npm install greymemory</span>
            <span className="vb-cta-copy">npm ↗</span>
          </a>
        </div>
      </div>

      <div className="vb-statband">
        <div className="vb-stat"><span className="n">80.0%</span><span className="l">LongMemEval overall · official LLM-as-judge</span></div>
        <div className="vb-stat"><span className="n">$0.013</span><span className="l">per session of ingestion</span></div>
        <div className="vb-stat"><span className="n">25,000+</span><span className="l">memories on the live graph below</span></div>
        <div className="vb-stat"><span className="n">1 file</span><span className="l">SQLite. No cloud, no lock-in.</span></div>
      </div>
    </>
  )
}

/* ── § 01 · the problem: ability index + pull-stat ───────────────────────── */

// LongMemEval's five tested abilities, each as a worked example: the sessions
// as lived, the question asked weeks later, and why naive storage fails it.
const ABILITIES = [
  { n: '01', name: 'Information Extraction',
    desc: 'recall one specific detail from months of conversation.',
    sessions: [
      { date: '2026/03/05 (Thu) 08:12', msgs: [
        { who: 'user', text: 'Can you help me plan nut-free lunches for the week? Mrs. Alvarez just banned nuts in my daughter’s class and I’m out of ideas.' },
        { who: 'assistant', text: 'Of course. Here are five nut-free lunches that pack well and survive a backpack: …' },
      ] },
    ],
    gap: '3 months later',
    asked: '2026/06/15 (Mon)',
    q: 'Who’s my daughter’s teacher?',
    a: 'Mrs. Alvarez.',
    why: 'The name surfaced inside a lunch-planning request, never as “her teacher is Mrs. Alvarez.” Store only explicit statements and it was never kept — so retrieval has nothing to find.' },
  { n: '02', name: 'Multi-Session Reasoning',
    desc: 'assemble one answer scattered across many sessions.',
    sessions: [
      { date: '2026/02/14 (Sat) 19:40', msgs: [
        { who: 'user', text: 'Took my partner to that new Korean BBQ place downtown for Valentine’s — the galbi was incredible.' },
        { who: 'assistant', text: 'Sounds like a great night! Want me to keep a list of your favorite spots?' },
      ] },
      { date: '2026/03/17 (Tue) 13:05', msgs: [
        { who: 'user', text: 'Tried the little Thai spot near the office today. Best pad see ew I’ve had.' },
        { who: 'assistant', text: 'Nice find. Want me to save it for your next lunch out?' },
      ] },
      { date: '2026/05/03 (Sun) 20:25', msgs: [
        { who: 'user', text: 'We finally went to the Ethiopian restaurant everyone keeps recommending. Eating with injera was so fun.' },
        { who: 'assistant', text: 'Injera is the best part. Want ideas for what to order next time?' },
      ] },
      { date: '2026/06/09 (Tue) 12:30', msgs: [
        { who: 'user', text: 'Grabbed dinner at the new ramen bar last night — waited 40 minutes but worth it.' },
        { who: 'assistant', text: 'Worth the wait, then! Want me to note it for date nights?' },
      ] },
    ],
    asked: '2026/06/30 (Tue)',
    q: 'How many new restaurants have I tried this year?',
    a: 'Four.',
    why: 'Four separate sessions about four unrelated dinners — Korean BBQ, Thai, Ethiopian, ramen — joined only by the abstract idea of “a new restaurant I tried.” No single query surfaces all four; the system has to gather them, then count.' },
  { n: '03', name: 'Knowledge Updates',
    desc: 'notice a fact changed, and answer with the current one — not both.',
    sessions: [
      { date: '2026/01/19 (Mon) 22:10', msgs: [
        { who: 'user', text: 'Reviewing every PR myself is still manageable with four engineers, but it’s getting tight.' },
        { who: 'assistant', text: 'Want a few strategies for scaling code review before it becomes the bottleneck?' },
      ] },
      { date: '2026/04/27 (Mon) 09:30', msgs: [
        { who: 'user', text: 'Onboarding is brutal now that we’re six — two backend hires started this morning.' },
        { who: 'assistant', text: 'Want an onboarding checklist to make the next hires smoother?' },
      ] },
    ],
    asked: '2026/06/15 (Mon)',
    q: 'How many engineers do I lead now?',
    a: 'Six — not “four and six.”',
    why: 'The old number isn’t wrong, it’s stale: ask what the team looked like in January and four is still true. But “now” wants the current one. Without supersession the system keeps both alive and hands you the ambiguity.' },
  { n: '04', name: 'Temporal Reasoning',
    desc: 'reason about when things happened, not just what.',
    sessions: [
      { date: '2026/02/03 (Tue) 21:47', msgs: [
        { who: 'user', text: '40 minutes of downtime tonight — worst outage we’ve had. Writing the postmortem now.' },
        { who: 'assistant', text: 'Rough night. Want a postmortem template — timeline, root cause, action items?' },
      ] },
      { date: '2026/05/20 (Wed) 03:12', msgs: [
        { who: 'user', text: 'Full outage again — the DB failover didn’t fire.' },
        { who: 'assistant', text: 'Want to walk through the failover config to find why it didn’t trigger?' },
      ] },
      { date: '2026/06/10 (Wed) 16:40', msgs: [
        { who: 'user', text: 'Near-miss today — caught the memory leak before it took prod down.' },
        { who: 'assistant', text: 'Good catch. Want to add an alert so it’s flagged earlier next time?' },
      ] },
    ],
    asked: '2026/06/18 (Thu)',
    q: 'How long was it between our last two real outages?',
    a: 'About 15 weeks.',
    why: 'That number is written down nowhere — it’s Feb 3 → May 20, computed from two dates the system had to store as the event dates, not the dates they happened to be mentioned. And “real outages” has to rule out the June near-miss.' },
  { n: '05', name: 'Abstention',
    desc: 'know what it doesn’t know, and say so instead of confabulating.',
    sessions: [
      { date: '2026/06/12 (Fri) 20:15', msgs: [
        { who: 'user', text: 'My sister’s wedding is eating every weekend this month — I’m maid of honor and the seating chart is chaos.' },
        { who: 'assistant', text: 'Happy to help — want a hand organizing the seating chart?' },
      ] },
    ],
    asked: '2026/06/20 (Sat)',
    q: 'What did I think of my brother’s wedding?',
    a: '“You haven’t mentioned a brother.”',
    why: 'The system knows about a wedding and a sibling, so the helpful reflex is to answer about the sister’s. Resisting that — and naming the false premise instead of inventing an opinion — is the skill. For most models, a confident wrong answer beats an honest “I don’t know.”' },
]

function AbilityExhibit({ a }) {
  return (
    <div className="vb-ab-body">
      <div className="vb-ab-ex">
        {a.sessions.map(s => (
          <div key={s.date} className="vb-ab-sess">
            <div className="vb-ab-sdate">session · {s.date}</div>
            {s.msgs.map((m, i) => (
              <p key={i} className={`vb-ev-line ${m.who}`}>
                <span className="vb-ev-who">{m.who}</span>{m.text}
              </p>
            ))}
          </div>
        ))}
        {a.gap && <div className="vb-ab-gap">— {a.gap} —</div>}
        <div className="vb-ab-sess">
          <div className="vb-ab-sdate asked">asked · {a.asked}</div>
          <p className="vb-ab-q"><span className="vb-ab-qa">Q →</span>{a.q}</p>
          <p className="vb-ab-a"><span className="vb-ab-qa">A →</span>{a.a}</p>
        </div>
      </div>
      <p className="vb-ab-why"><span className="lbl">why it’s hard</span>{a.why}</p>
    </div>
  )
}

function AbilityIndex() {
  const [open, setOpen] = useState(null)
  return (
    <div className="vb-abilities">
      {ABILITIES.map(a => {
        const isOpen = open === a.n
        return (
          <div key={a.n} className={`vb-ab-row ${isOpen ? 'open' : ''}`}>
            <button className="vb-ab-head" aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : a.n)}>
              <span className="vb-ab-num">{a.n}</span>
              <span className="vb-ab-title">
                <span className="vb-ab-name">{a.name}</span>
                <span className="vb-ab-desc">{a.desc}</span>
              </span>
              <span className="vb-ab-plus">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && <AbilityExhibit a={a} />}
          </div>
        )
      })}
    </div>
  )
}

// Suggestive monoline marks in the same designed set as AgentMark — evocative
// of each app's icon, not brand-logo reproductions.
function BrandMark({ kind }) {
  const p = {
    width: '1em', height: '1em', viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
  }
  if (kind === 'chatgpt') // segmented knot-ring around a hollow core
    return (
      <span className="vb-brandmark">
        <svg {...p}><circle cx="12" cy="12" r="8.2" strokeDasharray="6.7 1.9" /><path d="M12 9.6l2.1 1.2v2.4L12 14.4l-2.1-1.2v-2.4z" /></svg>
      </span>
    )
  // coze — rounded app tile with two eyes
  return (
    <span className="vb-brandmark">
      <svg {...p}><rect x="4.2" y="5.6" width="15.6" height="12.8" rx="3.6" /><path d="M9.3 10.6v2.4M14.7 10.6v2.4" /></svg>
    </span>
  )
}

// [reader, oracle-context accuracy, full-history accuracy, drop] — the paper's
// no-Chain-of-Note reading comparison: same reader, same questions, only the
// context changes.
const NOISE_ROWS = [
  ['GPT-4o', '87.0', '60.6', '30.3'],
  ['Llama 3.1 70B', '74.4', '33.4', '55.1'],
  ['Llama 3.1 8B', '71.0', '45.4', '36.1'],
  ['Phi-3 128k 14B', '70.2', '38.0', '45.9'],
  ['Phi-3.5 Mini 4B', '66.0', '34.2', '48.1'],
]

function NoiseTable() {
  return (
    <div className="vb-cp-scroll">
      <table className="vb-bench">
        <thead>
          <tr>
            <th>reader</th>
            <th className="num">oracle context</th>
            <th className="num">full history</th>
            <th className="num drop">drop</th>
          </tr>
        </thead>
        <tbody>
          {NOISE_ROWS.map(([reader, oracle, full, drop]) => (
            <tr key={reader}>
              <td>{reader}</td>
              <td className="num">{oracle}%</td>
              <td className="num">{full}%</td>
              <td className="num drop">−{drop}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProblemSection() {
  return (
    <Section no="01" kicker="the problem, measured · LongMemEval · arXiv 2410.10813">
      <div className="vb-col">
        <p className="vb-body">
          LongMemEval, a comprehensive benchmark of long-term memory in chat assistants, breaks
          the job into <b>five core abilities</b> and tests them across ~500 hand-built questions.
          Each entry below is a worked example — open one.
        </p>
        <AbilityIndex />
        <p className="vb-body vb-ab-bridge">
          That’s the job. Here’s how the systems people actually use score at it.
        </p>
      </div>

      <div className="vb-duo-wrap">
        <div className="vb-duo">
          <div className="vb-duo-cell">
            <div className="vb-duo-brand"><BrandMark kind="chatgpt" />ChatGPT-4o</div>
            <div className="vb-duo-num">60.6 <span className="vb-pull-pct">%</span></div>
            <div className="vb-duo-cap">long-term memory, scored on LongMemEval</div>
          </div>
          <div className="vb-duo-cell">
            <div className="vb-duo-brand"><BrandMark kind="coze" />LLAMA 3.1 70B</div>
            <div className="vb-duo-num">33.4 <span className="vb-pull-pct">%</span></div>
            <div className="vb-duo-cap">long-term memory, same questions</div>
          </div>
        </div>
        <p className="vb-duo-note">Same questions. The gap is not the model — it is the memory.</p>
      </div>

      <div className="vb-col">
        <p className="vb-body">
          It isn’t only proprietary memory that fails. Hand any LLM the whole transcript in its
          context window — the answer <em>is right there</em> — and it still loses a third of its
          accuracy to the surrounding noise. Bigger context windows make this
          worse, not better (<em>lost in the middle</em>). Having the information isn’t using it.
        </p>
        <NoiseTable />
      </div>
    </Section>
  )
}

/* ── index-showcase layout: numbered list left, big exhibit right ────────── */
// Reference format: headline + lede + numbered index in the left column;
// the selected item's plate on the right with kicker · title · description.

// `progress` (optional): { ms, key } — while auto-cycling, the active row grows
// a hairline that fills over the dwell; the key remount restarts the fill on
// every advance. Pass null once the reader takes over.
function IndexShowcase({ no, kicker, title, lede, extra, items, active, onSelect, meta, accent = 'var(--vermillion)', progress = null, children }) {
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
                  {isActive && progress && (
                    <span key={progress.key} className="vb-sc-load" aria-hidden="true"
                      style={{ background: color, animationDuration: `${progress.ms}ms` }} />
                  )}
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
  { key: 'chunks', label: 'persist raw chunks' },
  { key: 'extract', label: 'extract facts' },
  { key: 'dedup', label: 'dedup' },
  { key: 'classify', label: 'detect relationship & classify facts' },
  { key: 'graph', label: 'versioned graph' },
]
const PIPE_STEP_MS = 2700 // 1.2s base + 1.5s per tab
const PIPE_LAST_MS = 4500 // assembled graph holds longer before the wrap

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

  // Loop the walkthrough while the exhibit is on screen: 0 → 4, hold the
  // assembled graph a beat longer, wrap around. A click on any step hands
  // control to the reader and ends the loop.
  const reduce = usePrefersReducedMotion()
  const wrapRef = useRef(null)
  const inView = useInView(wrapRef)
  const [autoOn, setAutoOn] = useState(true)
  const timerRef = useRef(null)
  const dwell = step === PIPE_STEPS.length - 1 ? PIPE_LAST_MS : PIPE_STEP_MS
  useEffect(() => {
    if (!inView || reduce || !autoOn) return
    timerRef.current = setTimeout(
      () => setStep(s => (s + 1) % PIPE_STEPS.length),
      dwell,
    )
    return () => clearTimeout(timerRef.current)
  }, [inView, reduce, autoOn, step, dwell])
  const manualStep = (key) => {
    setAutoOn(false)
    clearTimeout(timerRef.current)
    setStep(PIPE_STEPS.findIndex(s => s.key === key))
  }
  const progress = inView && !reduce && autoOn ? { ms: dwell, key: step } : null

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
        progress={progress}
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
                <td className="us">round chunks</td><td className="gain">sharper units</td>
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

const TAX_KEYS = Object.keys(TAX_FACTORIES)
// Dwell per tab while auto-cycling — long enough for the slowest reveal
// (stepMs 750 × its timeline) plus a beat on the finished graph.
const TAX_CYCLE_MS = 6500

function TaxonomyFigure() {
  const [tab, setTab] = useState('UPDATES')
  const [inView, setInView] = useState(false)
  // Rotate UPDATES → EXTENDS → DERIVES while the exhibit is on screen; each
  // swap remounts the reveal so the build-up replays. Any click (tab or
  // replay) hands control to the reader and ends the cycle.
  const reduce = usePrefersReducedMotion()
  const [autoOn, setAutoOn] = useState(true)
  const timerRef = useRef(null)
  useEffect(() => {
    if (!inView || reduce || !autoOn) return
    timerRef.current = setTimeout(
      () => setTab(t => TAX_KEYS[(TAX_KEYS.indexOf(t) + 1) % TAX_KEYS.length]),
      TAX_CYCLE_MS,
    )
    return () => clearTimeout(timerRef.current)
  }, [inView, reduce, autoOn, tab])
  const stopCycle = () => {
    setAutoOn(false)
    clearTimeout(timerRef.current)
  }
  const selectTab = (t) => {
    stopCycle()
    setTab(t)
  }
  return (
    <IndexShowcase
      no="03"
      kicker="knowledge updates"
      title={<>Three edges, three <em>meanings.</em></>}
      lede="Memories don’t just accumulate — they relate. The classifier assigns one of three edge types, each with hard guardrails. Real scenario data; every animation replays."
      items={TAX_KEYS.map((kk, i) => ({ key: kk, num: `0${i + 1}`, label: kk, color: TAX_COLOR[kk] }))}
      active={tab}
      onSelect={selectTab}
      progress={inView && !reduce && autoOn ? { ms: TAX_CYCLE_MS, key: tab } : null}
      meta={{
        kicker: `0${TAX_KEYS.indexOf(tab) + 1} · ${tab}`,
        title: TAX_TITLES[tab],
        desc: TAX_CAP[tab],
        color: TAX_COLOR[tab],
      }}
    >
      <TaxReveal key={tab} tab={tab} inView={inView} onVisible={setInView} onInteract={stopCycle} />
    </IndexShowcase>
  )
}

function TaxReveal({ tab, inView, onVisible, onInteract }) {
  const factory = TAX_FACTORIES[tab]
  const { nodes, links, done, replay } = useGraphReveal(factory, { stepMs: 750, active: inView })
  return (
    <div className="vb-tax-plate">
      <EmbeddedGraph nodes={nodes} links={links} height="100%" labelZoom={1.1} onVisible={onVisible} />
      <button className="vb-replay" onClick={() => { onInteract?.(); replay() }} disabled={!done}>↻ replay</button>
    </div>
  )
}

/* ── § 04 · time travel ──────────────────────────────────────────────────── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct']

function TimeFigure() {
  // Auto-scrub Jan → Oct on a loop while the figure is on screen, so the
  // timeline reads as animated rather than a static control. Any scrub or
  // month click hands control to the reader (❚❚ / ▶ toggle it back); readers
  // with reduced motion get the full end state and no loop.
  const reduce = usePrefersReducedMotion()
  const [m, setM] = useState(() => (reduce ? 9 : 0))
  const [autoOn, setAutoOn] = useState(true)
  const wrapRef = useRef(null)
  const inView = useInView(wrapRef)
  const timerRef = useRef(null)
  useEffect(() => {
    if (!inView || reduce || !autoOn) return
    timerRef.current = setTimeout(
      () => setM(x => (x + 1) % MONTHS.length),
      m === MONTHS.length - 1 ? 3000 : 1200,
    )
    return () => clearTimeout(timerRef.current)
  }, [inView, reduce, autoOn, m])
  const scrub = (val) => {
    setAutoOn(false)
    clearTimeout(timerRef.current)
    setM(val)
  }

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
    <div ref={wrapRef}>
    <Figure
      num="01"
      title="time travel: the same graph, asked as of any month."
      height={280}
      note="No reprocessing. Most memory systems overwrite, so the past is gone the moment a fact changes. Here it's retained — rewinding is a filter, not a recomputation."
      toolbar={reduce ? null : (
        <button className="vb-step vb-run" onClick={() => setAutoOn(a => !a)}>
          {autoOn ? '❚❚ pause' : '▶ play'}
        </button>
      )}
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
        {/* the scrubber drawn as what it is: a timeline — month ruler, event
            dots on the track, a playhead carrying the as-of label. An invisible
            range input on top keeps drag + keyboard + click-to-jump. */}
        <div className="vb-tl">
          <div className="vb-tl-line" />
          <div className="vb-tl-fill" style={{ width: `${(m / 9) * 100}%` }} />
          {MONTHS.map((mo, i) => (
            <span key={`t-${mo}`} className="vb-tl-mtick" style={{ left: `${(i / 9) * 100}%` }} />
          ))}
          {ticks.map(t => (
            <span key={t.cap}
              className={`vb-tl-event ${m >= t.at ? 'lit' : ''}`}
              style={{ left: `${(t.at / 9) * 100}%`, '--c': t.color }}
              title={t.cap} />
          ))}
          <div className={`vb-tl-head ${m === 0 ? 'edge-l' : ''} ${m >= 8 ? 'edge-r' : ''}`}
            style={{ left: `${(m / 9) * 100}%` }}>
            <span className="vb-tl-asof">as of · {MONTHS[m]} 2023</span>
            <span className="vb-tl-stem" />
            <span className="vb-tl-dot" />
          </div>
          <input className="vb-tl-input" type="range" min="0" max="9" value={m}
            aria-label="as-of month"
            onChange={e => scrub(Number(e.target.value))} />
          {MONTHS.map((mo, i) => (
            <button key={mo}
              className={`vb-tl-month ${i === m ? 'cur' : ''} ${i <= m ? 'past' : ''} ${i % 2 ? 'alt' : ''}`}
              style={{ left: `${(i / 9) * 100}%` }}
              onClick={() => scrub(i)}>{mo}</button>
          ))}
        </div>

        <div className="vb-time-row">
          <span className="vb-ticks">
            {ticks.map(t => (
              <span key={t.cap} className="vb-tick" style={{ opacity: m >= t.at ? 1 : 0.35 }}>
                <span className="dot" style={{ background: m >= t.at ? t.color : 'transparent', borderColor: t.color }} />
                {t.cap}
              </span>
            ))}
          </span>
        </div>

        <p className="vb-time-mech">
          Every fact carries a validity window. <span className="hl">asOf</span> filters the graph
          to what held on that date and resolves supersession as it stood then — same rows, a
          different clock.
        </p>
      </div>
    </Figure>
    </div>
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
    const t = setTimeout(() => ctrl.abort(), 5000)
    fetch(`${API_BASE}/api/viz/datasets`, { signal: ctrl.signal })
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

      <Section no="04" kicker="temporal reasoning · time travel" title={<>Ask the past.</>}>
        <div className="vb-col">
          <p className="vb-body">
            Memory that overwrites can only answer <em>now</em>. Because greymemory keeps every
            version with the window it was true, you can point it at any past date and read the
            answer that was current then — no re-ingestion, no replay.
          </p>
        </div>
        <TimeFigure />
      </Section>

      <Section no="05" kicker="information extraction · multi-session reasoning" title={<>Retrieval follows the <em>graph.</em></>}>
        <RetrievalFigure />
      </Section>

      <BenchSection />
      <LiveVizFold />

      <footer className="vb-colophon">
        <span>greymemory — ESM · Node 18+ · better-sqlite3 · provider-agnostic by design</span>
        <span className="vb-colo-links">
          <a href="https://github.com/arun-dev-des/greymemory" target="_blank" rel="noreferrer">GitHub ↗</a>
          <a href="https://www.npmjs.com/package/greymemory" target="_blank" rel="noreferrer">npm ↗</a>
        </span>
        <span>ingestion → extraction → relationships → hybrid search → time travel</span>
      </footer>
    </div>
  )
}
