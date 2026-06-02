// analyze.js — call Claude to explain why a benchmark question was right/wrong.
//
// Builds a focused diagnostic prompt from all available signal (question,
// expected, got, retrieved items, relationship-classifier log) and asks
// Claude to trace the failure (or success) end-to-end.
//
// Default model is Sonnet 4.6 — cost/quality balance for one-shot analysis
// on a small payload. Override via DIAG_ANALYSIS_MODEL env var.

const DEFAULT_MODEL    = 'claude-sonnet-4-6'
const DEFAULT_MAX_TOKS = 1500

export function buildAnalysisPrompt({ question: q, relationshipLog = [] }) {
  const gold = new Set(q.gold_sessions ?? q.answer_session_ids ?? [])

  const retrievedLines = (q.retrieved ?? []).map((r, i) => {
    const goldMark = r.session_id && gold.has(r.session_id) ? ' ⭐GOLD' : ''
    const meta = [
      r.memory_type,
      r.document_date && `dd=${r.document_date}`,
      r.event_date    && `ed=${r.event_date}`,
      r.relation_type && `rel=${r.relation_type}`,
      r.session_id    && `sess=${r.session_id}`,
    ].filter(Boolean).join(' · ')
    const memoryText = r.memory ?? '(no atomic memory — chunk-only result)'
    const chunkExcerpt = r.chunk && r.chunk !== r.memory
      ? `\n      chunk: ${String(r.chunk).slice(0, 300).replace(/\n/g, ' ')}${r.chunk.length > 300 ? '…' : ''}`
      : ''
    return `[${i + 1}]${goldMark} ${memoryText}\n      ${meta}${chunkExcerpt}`
  }).join('\n')

  // Trim relationship log to the genuinely diagnostic entries. UPDATES is
  // where supersession logic lives; failures are where the system gave up.
  // EXTENDS and NEW are usually noise — the summary line conveys their counts.
  const interesting = relationshipLog.filter(e =>
    e.decision?.type === 'UPDATES' ||
    e.reason === 'llm_failed' ||
    e.reason === 'no_candidates'
  )
  const logSummary = relationshipLog.length === 0
    ? '(no classifier log — pre-Task-5.1 run or no decisions made)'
    : `Distribution across ${relationshipLog.length} decisions: ${counts(relationshipLog).join(', ')}\n` +
      `Showing ${interesting.length} diagnostic entries (UPDATES + failures only):\n\n` +
      (interesting.length === 0
        ? '  (none — classifier saw no contradictions and never failed)'
        : interesting.slice(0, 20).map(formatLogEntry).join('\n\n')) +
      (interesting.length > 20 ? `\n\n…and ${interesting.length - 20} more diagnostic entries omitted` : '')

  return `You are a diagnostic analyst for greymemory, a memory system being benchmarked on LongMemEval (Wu et al., ICLR 2025). Your job is to trace exactly WHY a single benchmark question was answered the way it was — citing specific evidence from retrieval and the classifier log.

Be concrete and concise. Cite item numbers ([3], [7]) and fact IDs ([id=42]) when relevant. Do not speculate beyond what the data supports.

QUESTION TYPE: ${q.question_type}
QUESTION: ${q.question}
QUESTION DATE: ${q.question_date ?? '(unknown)'}
EXPECTED ANSWER: ${q.expected}
MODEL ANSWERED: ${(q.answer ?? '').slice(0, 1500)}${(q.answer ?? '').length > 1500 ? '…(truncated)' : ''}
VERDICT: ${q.correct ? 'CORRECT ✓' : 'WRONG ✗'}
FAILURE REASON (heuristic label): ${q.failure_reason ?? '(none)'}
RETRIEVAL METRICS: R@5=${pct(q.recall_at_5)} R@10=${pct(q.recall_at_10)} N@5=${pct(q.ndcg_at_5)} N@10=${pct(q.ndcg_at_10)}
GOLD SESSIONS: ${[...gold].join(', ') || '(none provided)'}

RETRIEVED ITEMS (rank order):
${retrievedLines || '(none)'}

RELATIONSHIP CLASSIFIER LOG (ingestion-time UPDATES/EXTENDS/NEW decisions for this question's container):
${logSummary}

Produce an analysis with these sections (be brief — 2-4 sentences each):

**Verdict explanation** — Why was the answer ${q.correct ? 'correct' : 'wrong'}? Trace the chain: retrieval → reading → answer.

**Retrieval analysis** — Did the right evidence land in the top-N? Cite item numbers. If gold sessions were missed (R@10 < 100%), what's there instead?

**Reading-stage analysis** — Looking at the model's answer, which retrieved items did it actually use? Did Chain-of-Note help or hurt? Are there contradictions across items the model had to resolve?

**Classifier analysis** — Anything in the relationship log that looks wrong? (e.g. UPDATES that should have been EXTENDS, NEW despite a good candidate match, failures.)

**Root cause + next step** — One sentence on the most likely root cause. One sentence on a concrete investigation or fix.
`
}

function counts(log) {
  const c = { UPDATES: 0, EXTENDS: 0, NEW: 0 }
  for (const e of log) c[e.decision?.type] = (c[e.decision?.type] ?? 0) + 1
  return Object.entries(c).map(([k, v]) => `${k}=${v}`)
}

function pct(v) { return v == null ? '—' : `${(v * 100).toFixed(0)}%` }

function formatLogEntry(e) {
  // For UPDATES the top_candidate is the one the LLM said is superseded —
  // that's the diagnostic pivot. For failures (no_candidates / llm_failed)
  // top_candidate may be null and we just show the new fact.
  const newVal = (e.new_fact?.value ?? '').slice(0, 100)
  const newEllip = (e.new_fact?.value ?? '').length > 100 ? '…' : ''
  const tcLine = e.top_candidate
    ? `    superseded → [id=${e.top_candidate.id}] ${e.top_candidate.key}: "${(e.top_candidate.value ?? '').slice(0, 100)}${(e.top_candidate.value ?? '').length > 100 ? '…' : ''}"`
    : `    (no related candidate — relatedTo=${e.decision?.relatedTo ?? 'null'})`
  return `  ▸ ${e.decision?.type} reason=${e.reason} candidates=${e.candidate_count}
    new: [${e.new_fact?.key}] "${newVal}${newEllip}"
${tcLine}`
}

export async function callClaude(prompt, { model = process.env.DIAG_ANALYSIS_MODEL ?? DEFAULT_MODEL, maxTokens = DEFAULT_MAX_TOKS } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in repo-root .env')

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages:   [{ role: 'user', content: prompt }],
    }),
  })
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 400)}`)
  const data = await r.json()
  return {
    analysis: data.content?.[0]?.text ?? '',
    model:    data.model,
    usage:    data.usage,
  }
}
