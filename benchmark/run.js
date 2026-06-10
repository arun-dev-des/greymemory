// benchmark/run.js
// LongMemEval benchmark runner for greymemory
//
// Config:
//   LIMIT = true + PER_CATEGORY = 1  → 1 question per category
//   LIMIT = true + PER_CATEGORY = 10 → 60 questions (full benchmark)
//   LIMIT = null                     → all 500 questions
//   CATEGORY_FILTER = ['single-session-assistant'] → only run specific categories

import 'dotenv/config'
import fs   from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createBatchEmbedder } from '../src/batch-embedder.js'
import { formatForReading, formatRetrievedContext } from '../src/answering.js'
import { EXTRACTOR_STATIC_PREFIX } from '../src/prompts.js'
import { encode as encodeGpt4o } from 'gpt-tokenizer/model/gpt-4o'
import { buildJudgePrompt, parseJudgeVerdict } from './judge-prompts.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GREYMEMORY_LIB swaps the Memory implementation under the same harness, e.g.
//   GREYMEMORY_LIB=../greymemory-lite/src/index.js node benchmark/run.js
// The reading prompt (answering.js above) and judge stay from the main lib so
// an old-vs-lite A/B isolates ingestion+retrieval. Lite ignores the legacy
// constructor/search flags this runner passes.
const GREYMEMORY_LIB = process.env.GREYMEMORY_LIB || '../src/memory.js'
const { Memory } = await import(GREYMEMORY_LIB)

// ── config ─────────────────────────────────────────────────────────────────

// All knobs are env-overridable so multiple configs can be scripted without
// editing this file (the value after the comma is the default). Pass e.g.
//   RERANK=1 CON_PROMPT_VERSION=v2 SKIP_INGEST=true node benchmark/run.js
const envBool = (k, def) => process.env[k] == null || process.env[k] === '' ? def : /^(1|true|yes|on)$/i.test(process.env[k])
const envNum  = (k, def) => process.env[k] == null || process.env[k] === '' ? def : (Number.isFinite(+process.env[k]) ? +process.env[k] : def)
const envStr  = (k, def) => process.env[k] == null || process.env[k] === '' ? def : process.env[k]
const envList = (k, def) => process.env[k] == null || process.env[k] === '' ? def : (process.env[k] === 'all' ? null : process.env[k].split(',').map(s => s.trim()).filter(Boolean))

const LIMIT           = envBool('LIMIT', true)              // true = use PER_CATEGORY | null = all 500
const PER_CATEGORY    = envNum('PER_CATEGORY', 10)          // questions per category
const CATEGORY_FILTER = envList('CATEGORY_FILTER', ['knowledge-update'])  // CATEGORY_FILTER=all → all categories
const QUESTION_ID     = envStr('QUESTION_ID', null)        // set to a question_id to run a single question
const SEARCH_TOP_N    = envNum('SEARCH_TOP_N', 10)
const SKIP_INGEST     = envBool('SKIP_INGEST', true)       // true = skip ingestion, use existing DB
const TIME_AWARE_QUERY = envBool('TIME_AWARE_QUERY', true) // CP3 (LongMemEval §5.4): auto-extract date range from query
const READING_MODE    = envStr('READING_MODE', 'json-con') // CP4 (§5.5): 'json-con' = JSON + Chain-of-Note | 'legacy' = pre-Task-4 prose
const EXTRACTION_MODE = envStr('EXTRACTION_MODE', 'session')// A/B (indexing): 'session' = one extraction per conversation | 'round' = per-round (EXPENSIVE: N calls/session)
const BATCH_RELATIONSHIPS = envBool('BATCH_RELATIONSHIPS', false)  // Task 8.1: classify a batch's relationships in ONE call (cuts the dominant ingest cost; makes round-mode affordable)
const PROMPT_CACHE        = envBool('PROMPT_CACHE', true)          // Task 8.2: send the static extraction prefix as an Anthropic prompt-cache block (~90% input-token cut on the repeated portion). Pure cost optimization — identical content to the model.
const CON_PROMPT_VERSION = (process.env.CON_PROMPT_VERSION === 'v1' ? 'v1' : 'v2')  // 'v2' (default) = anchor + 3-tier scoring + self-check (see formatForReadingV2); set CON_PROMPT_VERSION=v1 to opt out
const JUDGE_DUAL      = envBool('JUDGE_DUAL', false)        // A/B: judge each answer TWICE — once without chunks (paper-comparable), once with deduped CoN-filtered source chunks.
const QUESTION_DELAY_MS = envNum('QUESTION_DELAY_MS', 6000) // sleep between questions to stay under OpenAI per-minute TPM

// ── retrieval levers (Phase 1; gated, default OFF → identical retrieval to before) ──
const RERANK          = envBool('RERANK', false)           // LLM-as-reranker over the candidate pool
const MULTI_QUERY     = process.env.MULTI_QUERY == null || process.env.MULTI_QUERY === '' ? false
                      : (/^(1|true|yes|on)$/i.test(process.env.MULTI_QUERY) ? true
                      : (Number.isFinite(+process.env.MULTI_QUERY) ? +process.env.MULTI_QUERY : false))
const ADAPTIVE_AGG    = envBool('ADAPTIVE_AGG', false)      // raise topN for aggregation/count questions
const MAX_PER_SESSION = process.env.MAX_PER_SESSION == null || process.env.MAX_PER_SESSION === '' ? null
                      : (Number.isFinite(+process.env.MAX_PER_SESSION) ? +process.env.MAX_PER_SESSION : null)

// USE_FIXED_IDS=true (default) pins the reproducible 10-KU set below. Set
// USE_FIXED_IDS=false to use the per-category selection (deterministic: first
// PER_CATEGORY by question_id), e.g. CATEGORY_FILTER=all PER_CATEGORY=1 for a
// 1-question-per-category smoke.
const USE_FIXED_IDS   = envBool('USE_FIXED_IDS', true)

// Answerer / judge provider. Default 'openai' + gpt-4o keeps results
// paper-comparable to supermemory's published numbers. Set ANSWERER_PROVIDER /
// JUDGE_PROVIDER = 'anthropic' to fall back to Claude (e.g. when the OpenAI key
// is unavailable) — useful for INTERNAL A/B (judge held constant across runs)
// but NOT directly comparable to gpt-4o-judged numbers.
const ANSWERER_PROVIDER = envStr('ANSWERER_PROVIDER', 'openai')
const ANSWERER_MODEL    = envStr('ANSWERER_MODEL', ANSWERER_PROVIDER === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o')
const JUDGE_PROVIDER    = envStr('JUDGE_PROVIDER', 'openai')
const JUDGE_MODEL       = envStr('JUDGE_MODEL', JUDGE_PROVIDER === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o')

const DB_DIR      = process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : path.join(__dirname, '.greymemory-bench-ku10-validation')
const DATA_FILE   = path.join(__dirname, 'data', 'longmemeval_s_cleaned.json')
const RESULTS_DIR = path.join(__dirname, 'results')

const FILTER_PROMPT = ''

const INITIAL_ENTITY_CONTEXT = `This is memory for a single user across multiple conversation sessions with an AI assistant.
"I", "me", "my", "mine" always refer to the same person.
Resolve all pronouns and vague references using context from the full conversation.`

// ── retrieval metrics (LongMemEval §3.3) ───────────────────────────────────
// Binary relevance at session granularity. Both metrics dedupe by session —
// only the first appearance of each gold session contributes (NDCG gain /
// Recall set inclusion). See plan: read-this-file-greymemory-longmemeval-im-sorted-hamming.md

function recallAtK(rankedSessionIds, goldSet, k) {
  if (goldSet.size === 0) return null
  const seen = new Set()
  for (let i = 0; i < Math.min(k, rankedSessionIds.length); i++) {
    const sid = rankedSessionIds[i]
    if (sid != null && goldSet.has(sid)) seen.add(sid)
  }
  return seen.size / goldSet.size
}

function ndcgAtK(rankedSessionIds, goldSet, k) {
  if (goldSet.size === 0) return null
  const seenRelevant = new Set()
  let dcg = 0
  for (let i = 0; i < Math.min(k, rankedSessionIds.length); i++) {
    const sid = rankedSessionIds[i]
    if (sid != null && goldSet.has(sid) && !seenRelevant.has(sid)) {
      seenRelevant.add(sid)
      dcg += 1 / Math.log2(i + 2)
    }
  }
  let idcg = 0
  for (let i = 0; i < Math.min(k, goldSet.size); i++) {
    idcg += 1 / Math.log2(i + 2)
  }
  return idcg === 0 ? 0 : dcg / idcg
}

if (SEARCH_TOP_N < 10) {
  throw new Error(`SEARCH_TOP_N must be >= 10 to compute Recall@10 / NDCG@10 (got ${SEARCH_TOP_N})`)
}

// ── token tracking ─────────────────────────────────────────────────────────
// Phase-keyed buckets. Library passes { phase } to extractor/embedder so the
// wrapper can attribute tokens/calls to the internal stage that caused them.
// New phases added by the library fall back into the default bucket defensively.

const tokenLog = {
  extractor: {
    extraction:        { input: 0, output: 0, calls: 0 },
    relationship:      { input: 0, output: 0, calls: 0 },
    contextualization: { input: 0, output: 0, calls: 0 },
    derivation:        { input: 0, output: 0, calls: 0 },
    time_extraction:   { input: 0, output: 0, calls: 0 },
    rerank:            { input: 0, output: 0, calls: 0 },  // Phase 1: LLM-as-reranker
    query_expansion:   { input: 0, output: 0, calls: 0 },  // Phase 1: multi-query expansion
  },
  embedder: {
    chunk:      { calls: 0 },
    dedup_seed: { calls: 0 },
    memory:     { calls: 0 },
    query:      { calls: 0 },
    derivation: { calls: 0 },
  },
  answering: { input: 0, output: 0 },
  judging:   { input: 0, output: 0 },
}

const sumCalls = obj => Object.values(obj).reduce((s, p) => s + (p.calls  ?? 0), 0)
const sumIn    = obj => Object.values(obj).reduce((s, p) => s + (p.input  ?? 0), 0)
const sumOut   = obj => Object.values(obj).reduce((s, p) => s + (p.output ?? 0), 0)

function resetTokenLog() {
  for (const p of Object.values(tokenLog.extractor)) { p.input = 0; p.output = 0; p.calls = 0; p.cache_read = 0; p.cache_write = 0 }
  for (const p of Object.values(tokenLog.embedder))  { p.calls = 0 }
  tokenLog.answering = { input: 0, output: 0 }
  tokenLog.judging   = { input: 0, output: 0 }
}

// ── providers ──────────────────────────────────────────────────────────────

const extractor = async (prompt, context, retries = 4) => {
  const phase  = context?.phase ?? 'extraction'
  const bucket = tokenLog.extractor[phase] ?? tokenLog.extractor.extraction

  // Task 8.2 — prompt caching. The extraction prompt always begins with the
  // stable EXTRACTOR_STATIC_PREFIX (~3k tokens, identical every call). Send it
  // as a separate cache_control block so repeated calls read it at ~0.1x.
  // Identical content reaches the model either way — purely a billing/latency win.
  const useCache = PROMPT_CACHE && phase === 'extraction'
    && typeof prompt === 'string' && prompt.startsWith(EXTRACTOR_STATIC_PREFIX)
  const content = useCache
    ? [
        { type: 'text', text: EXTRACTOR_STATIC_PREFIX, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: prompt.slice(EXTRACTOR_STATIC_PREFIX.length) },
      ]
    : prompt

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages:   [{ role: 'user', content }],
      }),
    })
    const data = await res.json()
    // Retry transient rate-limit / overload errors with exponential backoff so
    // unattended overnight ingestion doesn't silently drop sessions on a 429.
    const t = data.error?.type ?? ''
    if (res.status === 429 || res.status >= 500 || /rate_limit|overloaded|api_error/i.test(t)) {
      if (attempt < retries - 1) {
        const wait = Math.pow(2, attempt) * 2000
        process.stderr.write(`\n  [retry] extractor ${t || res.status}, waiting ${wait/1000}s...\n`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
    }
    if (data.error) throw new Error(`Anthropic: ${data.error.message}`)
    bucket.input       += data.usage?.input_tokens               ?? 0
    bucket.output      += data.usage?.output_tokens              ?? 0
    bucket.cache_read   = (bucket.cache_read  ?? 0) + (data.usage?.cache_read_input_tokens     ?? 0)
    bucket.cache_write  = (bucket.cache_write ?? 0) + (data.usage?.cache_creation_input_tokens ?? 0)
    bucket.calls  += 1
    return data.content[0].text.trim()
  }
  throw new Error('Anthropic extractor: max retries exceeded')
}

const rawBatchedEmbedder = createBatchEmbedder(async (texts) => {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ model: 'voyage-3', input: texts }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Voyage: ${data.error.message}`)
  return data.data.map(d => d.embedding)
}, { windowMs: 20, maxBatch: 128 })

// Phase-aware wrapper around the batched embedder. Counts the call before it
// enters the batch queue so dedup/batching can't lose attribution.
const embedder = async (text, context) => {
  const phase  = context?.phase ?? 'query'
  const bucket = tokenLog.embedder[phase] ?? tokenLog.embedder.query
  bucket.calls += 1
  return rawBatchedEmbedder(text)
}

// Anthropic chat helper for the Claude fallback (answerer / judge). Returns
// { text, usage:{input,output} }. Throws on API error so the caller can retry.
const anthropicChat = async (prompt, model, maxTokens) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  const data = await res.json()
  if (data.error) throw new Error(`Anthropic: ${data.error.message}`)
  return { text: (data.content?.[0]?.text ?? '').trim(), usage: { input: data.usage?.input_tokens ?? 0, output: data.usage?.output_tokens ?? 0 } }
}

const answerer = async (prompt, retries = 3) => {
  if (ANSWERER_PROVIDER === 'anthropic') {
    const { text, usage } = await anthropicChat(prompt, ANSWERER_MODEL, 512)
    tokenLog.answering.input  += usage.input
    tokenLog.answering.output += usage.output
    return text
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'gpt-4o',
        max_tokens:  512,
        temperature: 0,
        messages:    [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (data.error?.type === 'rate_limit_exceeded' || data.error?.code === 'rate_limit_exceeded') {
      const wait = Math.pow(2, attempt) * 2000
      process.stderr.write(`\n  [retry] rate limited, waiting ${wait/1000}s...\n`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (data.error) throw new Error(`OpenAI answerer: ${data.error.message}`)
    tokenLog.answering.input  += data.usage?.prompt_tokens     ?? 0
    tokenLog.answering.output += data.usage?.completion_tokens ?? 0
    return data.choices[0].message.content.trim()
  }
  throw new Error('OpenAI answerer: max retries exceeded')
}

// Uses LongMemEval's official per-question-type prompts (see ./judge-prompts.js).
// Routes by questionType + isAbstention so accuracy is comparable to the paper.
// `sourceChunks` is the optional deduped chunk list (supermemory-style A/B); when
// null the prompt stays byte-identical to the vendored template.
const judge = async (question, expected, got, questionType, isAbstention, sourceChunks = null, retries = 3) => {
  const prompt = buildJudgePrompt({
    questionType, isAbstention,
    question, answer: expected, response: got,
    sourceChunks,
  })
  if (JUDGE_PROVIDER === 'anthropic') {
    const { text, usage } = await anthropicChat(prompt, JUDGE_MODEL, 10)
    tokenLog.judging.input  += usage.input
    tokenLog.judging.output += usage.output
    return parseJudgeVerdict(text)
  }
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model:       'gpt-4o',
        max_tokens:  10,
        temperature: 0,
        messages:    [{ role: 'user', content: prompt }],
      }),
    })
    const data = await res.json()
    if (data.error?.type === 'rate_limit_exceeded' || data.error?.code === 'rate_limit_exceeded') {
      const wait = Math.pow(2, attempt) * 2000
      process.stderr.write(`\n  [retry] judge rate limited, waiting ${wait/1000}s...\n`)
      await new Promise(r => setTimeout(r, wait))
      continue
    }
    if (data.error) throw new Error(`OpenAI judge: ${data.error.message}`)
    tokenLog.judging.input  += data.usage?.prompt_tokens     ?? 0
    tokenLog.judging.output += data.usage?.completion_tokens ?? 0
    return parseJudgeVerdict(data.choices?.[0]?.message?.content)
  }
  throw new Error('OpenAI judge: max retries exceeded')
}

// ── temporal pre-computation ───────────────────────────────────────────────

function buildTemporalTimeline(question, results) {
  const isTemporal = /how many (days|weeks|months)|how long|how old|which.*(first|before|after|earlier|later)|when did|what day|what date|ago/i.test(question)
  if (!isTemporal) return ''

  const events = results
    .map(r => {
      const date = r.event_date ?? r.document_date
      return date ? {
        date,
        description: (r.memory || r.chunk?.slice(0, 150) || '').replace(/\n/g, ' ')
      } : null
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (events.length === 0) return ''

  // deduplicate same date + similar description
  const seen = new Set()
  const unique = events.filter(e => {
    const key = `${e.date}|${e.description.slice(0, 50)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return `
TIMELINE (events sorted chronologically — use these dates for any date arithmetic):
${unique.map(e => `  ${e.date}: ${e.description}`).join('\n')}

IMPORTANT: Use the dates above for all calculations. Do NOT estimate dates from
phrases like "a few weeks ago" or "last month" — use the extracted eventDate values.
When computing durations, subtract the earlier date from the later date.
`
}

// ── answering prompt ───────────────────────────────────────────────────────

function buildAnsweringPrompt({ question, questionDate, results, temporalTimeline }) {
  const retrievedContext = results.map((r, i) => {
    const lines = [`[${i + 1}]`]
    if (r.memory) lines.push(`Memory: ${r.memory}`)
    if (r.chunk && r.chunk !== r.memory) lines.push(`Chunks: ${r.chunk}`)
    if (!r.memory && r.chunk) lines.push(`Raw content: ${r.chunk}`)
    if (r.document_date) lines.push(`documentDate: ${r.document_date}`)
    if (r.event_date)    lines.push(`eventDate: ${r.event_date}`)
    if (r.relation_type) lines.push(`Version: ${r.relation_type}`)
    if (r.source_role)   lines.push(`Source: ${r.source_role}`)

    // NEW: surface graph expansion provenance
    if (r._expansion?.via === 'UPDATES_HISTORY') {
      lines.push(
        `⚠️ HISTORICAL VERSION: this fact USED TO be true but was replaced. ` +
        `Current value (from result #${r._expansion.seedId}): "${r._expansion.supersededBy.value}". ` +
        `When answering, treat this as the previous state, not a current fact.`
      )
    } else if (r._expansion?.via === 'EXTENDS') {
      lines.push(`(Related context: connected to result #${r._expansion.seedId} via EXTENDS chain, depth ${r._expansion.depth})`)
    }

    return lines.join('\n')
  }).join('\n\n')

  // Also strengthen the instructions section to handle version chains explicitly:
  return `You are a question-answering system. Based on the retrieved context below, answer the question.

Question: ${question}
Question Date: ${questionDate}

Retrieved Context:
${retrievedContext || '(no memories retrieved)'}

Understanding the Context:
The context contains search results from a memory system. Each result has multiple components:

Memory: A high-level summary/atomic fact — the searchable title/summary of what was stored
Chunks: The actual detailed raw content where the memory was extracted from
Source: "assistant" means this came from something the assistant said
        "user" means this came from something the user said

Temporal Context (if present):
  Question Date: when the question was asked
  documentDate: when the content was originally authored/written/said
  eventDate: when the event/fact actually occurred or will occur

Version Chains (CRITICAL):
  Some results are marked "⚠️ HISTORICAL VERSION" — these describe what USED TO
  be true, not what is currently true. The replacement value is shown inline.
  When the question asks about a CHANGE ("did you switch from X to Y", "more or
  less", "previous vs current"), you MUST compare:
    - The current fact (the seed, which has no HISTORICAL marker)
    - The historical fact (marked HISTORICAL) — this is what it used to be
  Do not infer the previous value from anywhere else. Use the HISTORICAL marker.

Instructions:
  Before answering, identify which memory or chunk contains the relevant
  information and note the exact value from it.
  If the context contains enough information, provide a clear, concise answer.
  If not, respond with "I don't know" or explain what is missing.
  Base your answer ONLY on the provided context.
  Match your answer format to the question.

${temporalTimeline}
Answer:`
}

// ── failure classification ─────────────────────────────────────────────────
// Categories:
//   'retrieval' — neither gold session reached the top-N. Search problem.
//   'answering' — the gold session was retrieved but the model still got it
//                 wrong. Reading-stage / format / timeline issue.
//   'extraction' — the gold session was retrieved AND the expected literal
//                 string appears in a chunk/memory, but no atomic fact was
//                 created for it. Extraction-coverage gap.
//   'unknown'   — gold session retrieved, no literal match in chunks; the
//                 answer is derived (number, date arithmetic, comparison).
//                 The substring heuristic can't tell extraction vs reading
//                 here, so we name it honestly instead of defaulting to one.
//
// Derived-answer categories (TR, MR) bypass the substring test entirely —
// the expected answer ("7 days", "3 events") never appears literally in
// source text, so substring-matching always false-negatives and the old
// classifier always called these 'extraction' regardless of the real cause.
function classifyFailure({ expected, retrieved, questionType, goldSessions }) {
  // Retrieval check: did any gold session land in top-N at all?
  if (goldSessions && goldSessions.size > 0) {
    const retrievedSessions = new Set(retrieved.map(r => r.session_id).filter(Boolean))
    const anyGoldRetrieved = [...goldSessions].some(g => retrievedSessions.has(g))
    if (!anyGoldRetrieved) return 'retrieval'
  }

  // Derived-answer categories — substring test is meaningless because the
  // expected answer is a computation result, not a stored string. We can't
  // distinguish extraction vs reading from the retrieved chunks alone here;
  // mark 'answering' since the gold session WAS reached.
  if (questionType === 'temporal-reasoning' || questionType === 'multi-session') {
    return 'answering'
  }

  // Direct-lookup categories — substring test on retrieved items.
  const exp = String(expected).toLowerCase()
  const inRetrieval = retrieved.some(r =>
    r.memory?.toLowerCase().includes(exp) ||
    r.chunk?.toLowerCase().includes(exp)
  )
  if (inRetrieval) return 'answering'

  // Gold session retrieved but expected string absent from chunks → either
  // the answer is derived (KU comparing values) or the extractor missed it.
  // We can't tell which, so 'unknown' rather than the old false 'extraction'.
  return goldSessions && goldSessions.size > 0 ? 'unknown' : 'extraction'
}

// ── pre-flight checks ──────────────────────────────────────────────────────

console.log('[benchmark] checking API keys...')

const checks = [
  {
    name: 'Anthropic (extractor)',
    fn: async () => {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 10, messages: [{ role: 'user', content: 'Say OK' }] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      return data.content[0].text.trim()
    },
  },
  {
    name: 'OpenAI (answerer + judge)',
    fn: async () => {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 10, messages: [{ role: 'user', content: 'Say OK' }] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      return data.choices[0].message.content.trim()
    },
  },
  {
    name: 'Voyage (embedder)',
    fn: async () => {
      const res = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}` },
        body: JSON.stringify({ model: 'voyage-3', input: ['test'] }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)
      return `vector[${data.data[0].embedding.length}] batch-enabled`
    },
  },
]

// Only verify providers actually in use — when answerer+judge run on Anthropic
// (OpenAI-key-unavailable fallback), skip the OpenAI check so it doesn't abort.
const usesOpenAI = ANSWERER_PROVIDER === 'openai' || JUDGE_PROVIDER === 'openai'
const activeChecks = checks.filter(c => usesOpenAI || !c.name.startsWith('OpenAI'))

let allPassed = true
for (const check of activeChecks) {
  try {
    const result = await check.fn()
    console.log(`  ✅  ${check.name} — ${result}`)
  } catch (err) {
    console.error(`  ❌  ${check.name} — ${err.message}`)
    allPassed = false
  }
}

if (!allPassed) {
  console.error('\n[benchmark] fix API key errors above before running')
  process.exit(1)
}

console.log('[benchmark] all keys OK\n')

// ── dataset loading ────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_FILE)) {
  console.error(`[benchmark] dataset not found: ${DATA_FILE}`)
  process.exit(1)
}

const dataset = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
console.log(`[benchmark] loaded ${dataset.length} questions`)

// ── question selection ─────────────────────────────────────────────────────

let questions = dataset

// single question override — highest priority
if (QUESTION_ID) {
  questions = dataset.filter(q => q.question_id === QUESTION_ID)
  console.log(`[benchmark] single question override: ${QUESTION_ID}`)
  if (questions.length === 0) {
    console.error(`[benchmark] question_id not found: ${QUESTION_ID}`)
    process.exit(1)
  }
} else {
  // apply category filter first
  if (CATEGORY_FILTER) {
    questions = questions.filter(q => CATEGORY_FILTER.includes(q.question_type))
    console.log(`[benchmark] category filter: ${CATEGORY_FILTER.join(', ')} (${questions.length} questions available)`)
  }

  // then apply limit — random pick per category
  // if (LIMIT) {
  //   const byCategory = {}
  //   for (const q of questions) {
  //     const cat = q.question_type
  //     if (!byCategory[cat]) byCategory[cat] = []
  //     byCategory[cat].push(q)
  //   }
  //   questions = Object.values(byCategory).flatMap(qs => {
  //     const shuffled = qs.sort(() => Math.random() - 0.5)
  //     return shuffled.slice(0, PER_CATEGORY)
  //   })
  // }

  // fixed set for reproducible comparison — the 10 KU question_ids from the
  // historic baseline at benchmark/results/run-2026-05-25T18-38-43.json (80% acc).
  const FIXED_IDS = [
    '6a1eabeb', '6aeb4375', '830ce83f', '852ce960', '945e3d21',
    'd7c942c3', '71315a70', '89941a93', 'ce6d2d27', '9ea5eabc',
  ]

  if (USE_FIXED_IDS && FIXED_IDS.length > 0) {
    questions = questions.filter(q => FIXED_IDS.includes(q.question_id))
  } else if (LIMIT) {
    // Deterministic per-category selection (first PER_CATEGORY by question_id) —
    // reproducible, unlike the old Math.random shuffle. CATEGORY_FILTER=all +
    // PER_CATEGORY=1 + USE_FIXED_IDS=false → one question per category.
    const byCategory = {}
    for (const q of questions) {
      const cat = q.question_type
      if (!byCategory[cat]) byCategory[cat] = []
      byCategory[cat].push(q)
    }
    questions = Object.values(byCategory).flatMap(qs =>
      qs.sort((a, b) => a.question_id.localeCompare(b.question_id)).slice(0, PER_CATEGORY)
    )
  }

  console.log(`[benchmark] selected ${questions.length} questions (${PER_CATEGORY} random per category):`)
  questions.forEach(q => console.log(`  ${q.question_type} — ${q.question_id}`))
}

// ── setup ──────────────────────────────────────────────────────────────────

if (!fs.existsSync(RESULTS_DIR)) fs.mkdirSync(RESULTS_DIR, { recursive: true })
if (!fs.existsSync(DB_DIR))      fs.mkdirSync(DB_DIR,      { recursive: true })

const timestamp   = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const resultsFile = path.join(RESULTS_DIR, `run-${timestamp}.json`)

// Task 5.1 — relationship-classification log. One JSON line per decision.
// Tagged with current_question_id so per-question diagnosis is possible.
const relationshipLogFile = path.join(RESULTS_DIR, `relationship-decisions-${timestamp}.jsonl`)
let currentQuestionId = null  // set inside the question loop
const relationshipStats = { total: 0, UPDATES: 0, EXTENDS: 0, NEW: 0, no_candidates: 0, llm_failed: 0, candidate_count_sum: 0 }
const relationshipLogStream = fs.createWriteStream(relationshipLogFile, { flags: 'a' })
const onRelationshipDecision = entry => {
  relationshipStats.total += 1
  relationshipStats[entry.decision.type] += 1
  relationshipStats.candidate_count_sum += entry.candidate_count
  if (entry.reason === 'no_candidates') relationshipStats.no_candidates += 1
  if (entry.reason === 'llm_failed')    relationshipStats.llm_failed    += 1
  relationshipLogStream.write(JSON.stringify({ question_id: currentQuestionId, ...entry }) + '\n')
}

const run = {
  meta: {
    timestamp, total: questions.length, per_category: PER_CATEGORY,
    category_filter: CATEGORY_FILTER ?? 'all',
    search_top_n:    SEARCH_TOP_N,
    model_extractor: 'claude-haiku-4-5-20251001',
    model_answerer:  ANSWERER_MODEL,
    answerer_provider: ANSWERER_PROVIDER,
    model_embedder:  'voyage-3',
    model_judge:     JUDGE_MODEL,
    judge_provider:  JUDGE_PROVIDER,
    tokens_format:   'v2-phase-keyed',  // see questions[].tokens shape
    judge_format:    'paper-official-v1',  // LongMemEval per-type prompts (./judge-prompts.js)
    con_prompt_version: CON_PROMPT_VERSION,
    skip_ingest:     SKIP_INGEST,
    extraction_mode: EXTRACTION_MODE,
    batch_relationships: BATCH_RELATIONSHIPS,
    prompt_cache:    PROMPT_CACHE,
    time_aware_query: TIME_AWARE_QUERY,
    reading_mode:    READING_MODE,
    judge_dual:      JUDGE_DUAL,
    rerank:          RERANK,
    multi_query:     MULTI_QUERY,
    adaptive_agg:    ADAPTIVE_AGG,
    max_per_session: MAX_PER_SESSION,
    db_dir:          path.basename(DB_DIR),
  },
  summary:   {},
  questions: [],
}

const SUPERMEMORY_SCORES = {
  'single-session-user':       97.1,
  'single-session-assistant':  96.4,
  'single-session-preference': 70.0,
  'knowledge-update':          88.5,
  'temporal-reasoning':        76.7,
  'multi-session':             71.4,
}

// ── main loop ──────────────────────────────────────────────────────────────

console.log(`\n[benchmark] starting — results: ${resultsFile}\n`)

for (let i = 0; i < questions.length; i++) {
  const tc = questions[i]
  const { question_id, question_type, question, answer: expected,
          question_date, haystack_sessions, haystack_dates,
          haystack_session_ids, answer_session_ids } = tc

  const isAbstention = question_id.endsWith('_abs')

  console.log(`${'─'.repeat(70)}`)
  console.log(`[${String(i + 1).padStart(3)}/${questions.length}] ${question_type}`)
  console.log(`  id:       ${question_id}`)
  console.log(`  question: "${question}"`)
  console.log(`  date:     ${question_date}`)
  console.log(`  sessions: ${haystack_sessions.length}`)
  console.log()

  // reset token log per question
  resetTokenLog()

  currentQuestionId = question_id
  const memory = new Memory({
    extractor, embedder,
    dir:            DB_DIR,
    container:      question_id,
    filterPrompt:   FILTER_PROMPT,
    entityContext:  INITIAL_ENTITY_CONTEXT,
    extractionMode: EXTRACTION_MODE,
    batchRelationships: BATCH_RELATIONSHIPS,
    onRelationshipDecision,
  })

  // ── ingest ─────────────────────────────────────────────────────────────
  const t0 = Date.now()
  if (SKIP_INGEST) {
    console.log(`  ⏩ skipping ingestion (SKIP_INGEST=true)`)
  } else {
    for (let s = 0; s < haystack_sessions.length; s++) {
      process.stdout.write(`  ingesting session ${s + 1}/${haystack_sessions.length}...`)
      try {
        await memory.add(haystack_sessions[s], {
          date:      haystack_dates[s],
          sessionId: haystack_session_ids?.[s] ?? null,
        })
      }
      catch (err) { process.stderr.write(`\n  [warn] session ${s}: ${err.message}\n`) }
      process.stdout.write('\r' + ' '.repeat(50) + '\r')
    }
  }
  const ingestMs = Date.now() - t0

  const ext = tokenLog.extractor
  const emb = tokenLog.embedder
  const totalHaikuCalls = sumCalls(ext)
  const totalHaikuIn    = sumIn(ext)
  const totalHaikuOut   = sumOut(ext)

  console.log(`  ⏱  ingest:         ${(ingestMs / 1000).toFixed(1)}s  (~${(ingestMs / haystack_sessions.length / 1000).toFixed(2)}s/session)`)
  console.log(`  🔢  haiku — extraction:        ${ext.extraction.calls} calls, ${ext.extraction.input.toLocaleString()} in / ${ext.extraction.output.toLocaleString()} out`)
  console.log(`  🔢  haiku — relationship:      ${ext.relationship.calls} calls, ${ext.relationship.input.toLocaleString()} in / ${ext.relationship.output.toLocaleString()} out`)
  console.log(`  🔢  haiku — contextualization: ${ext.contextualization.calls} calls, ${ext.contextualization.input.toLocaleString()} in / ${ext.contextualization.output.toLocaleString()} out`)
  if (ext.derivation.calls > 0) {
    console.log(`  🔢  haiku — derivation:        ${ext.derivation.calls} calls, ${ext.derivation.input.toLocaleString()} in / ${ext.derivation.output.toLocaleString()} out`)
  }
  console.log(`  🔢  haiku — total:             ${totalHaikuCalls} calls, ${totalHaikuIn.toLocaleString()} in / ${totalHaikuOut.toLocaleString()} out`)
  const cacheRead  = Object.values(ext).reduce((s, p) => s + (p.cache_read  ?? 0), 0)
  const cacheWrite = Object.values(ext).reduce((s, p) => s + (p.cache_write ?? 0), 0)
  if (cacheRead || cacheWrite) {
    console.log(`  💾  prompt cache — read ${cacheRead.toLocaleString()} tok (billed 0.1×) / write ${cacheWrite.toLocaleString()} tok (1.25×)`)
  }
  console.log(`  📐  embedder calls — chunk/dedup/memory/query/derivation: ${emb.chunk.calls}/${emb.dedup_seed.calls}/${emb.memory.calls}/${emb.query.calls}/${emb.derivation.calls}  (total ${sumCalls(emb)})`)

  // ── search ──────────────────────────────────────────────────────────────
  const t1 = Date.now()
  const questionDateNorm = memory._normalizeDate(question_date) ?? question_date
  // round asOf to end-of-day so all same-day sessions are visible
  const asOf = questionDateNorm.length === 10
    ? questionDateNorm + 'T23:59'
    : questionDateNorm.slice(0, 10) + 'T23:59'
  const timeExtractCallsBefore = ext.time_extraction.calls
  const retrieved = await memory.search(question, {
    topN: SEARCH_TOP_N,
    asOf,
    timeAwareQuery:      TIME_AWARE_QUERY,
    rerank:              RERANK,
    multiQuery:          MULTI_QUERY,
    adaptiveAggregation: ADAPTIVE_AGG,
    maxPerSession:       MAX_PER_SESSION,
  })
  const searchMs         = Date.now() - t1
  const timeExtractFired = ext.time_extraction.calls > timeExtractCallsBefore

  // MemScore contextTok: tokens in just the retrieved-context string (not the full answering prompt).
  // Only the json-con path produces a cleanly isolable context block — see formatRetrievedContext.
  let contextTokens = null
  if (READING_MODE === 'json-con') {
    const contextString = formatRetrievedContext(retrieved, SEARCH_TOP_N)
    contextTokens = encodeGpt4o(contextString).length
  }
  console.log(`\n  ⏱  search:         ${searchMs.toFixed(0)}ms  (${retrieved.length} results, ctxTok ${contextTokens ?? '—'})${timeExtractFired ? `  [M_T fired: ${ext.time_extraction.input}↓/${ext.time_extraction.output}↑]` : '  [M_T skipped]'}`)

  // ── retrieval metrics ───────────────────────────────────────────────────
  const goldSessions     = new Set(answer_session_ids ?? [])
  const rankedSessionIds = retrieved.map(r => r.session_id ?? null)
  const trackedRetrieved = rankedSessionIds.filter(s => s != null).length
  const legacyDb         = retrieved.length > 0 && trackedRetrieved === 0

  let recall_at_5, recall_at_10, ndcg_at_5, ndcg_at_10
  if (goldSessions.size === 0) {
    recall_at_5 = recall_at_10 = ndcg_at_5 = ndcg_at_10 = null
  } else if (legacyDb) {
    recall_at_5 = recall_at_10 = ndcg_at_5 = ndcg_at_10 = null
    process.stderr.write(`  [warn] metrics skipped — retrieved items have no session_id (re-ingest needed)\n`)
  } else {
    recall_at_5  = recallAtK(rankedSessionIds, goldSessions, 5)
    recall_at_10 = recallAtK(rankedSessionIds, goldSessions, 10)
    ndcg_at_5    = ndcgAtK  (rankedSessionIds, goldSessions, 5)
    ndcg_at_10   = ndcgAtK  (rankedSessionIds, goldSessions, 10)
  }

  const fmtMetric = v => v == null ? '—' : (v * 100).toFixed(0) + '%'
  console.log(`  📚  R@5 ${fmtMetric(recall_at_5)}  R@10 ${fmtMetric(recall_at_10)}  N@5 ${fmtMetric(ndcg_at_5)}  N@10 ${fmtMetric(ndcg_at_10)}  (${trackedRetrieved}/${retrieved.length} tagged, ${goldSessions.size} gold)`)

  // ── answer ───────────────────────────────────────────────────────────────
  const temporalTimeline = buildTemporalTimeline(question, retrieved)
  let answerPrompt
  if (READING_MODE === 'json-con') {
    answerPrompt = formatForReading({
      question,
      questionDate: questionDateNorm,
      results:      retrieved,
      version:      CON_PROMPT_VERSION,
    })
    if (temporalTimeline) answerPrompt += '\n' + temporalTimeline
  } else {
    answerPrompt = buildAnsweringPrompt({ question, questionDate: questionDateNorm, results: retrieved, temporalTimeline })
  }
  const t3 = Date.now()
  let answer = 'I don\'t know'
  try { answer = await answerer(answerPrompt) }
  catch (err) { process.stderr.write(`\n  [warn] answering: ${err.message}\n`) }
  console.log(`  ⏱  answer:         ${(Date.now() - t3).toFixed(0)}ms  (${tokenLog.answering.input.toLocaleString()} in / ${tokenLog.answering.output.toLocaleString()} out tokens)`)
  console.log(`  💬  "${answer}"`)
  console.log(`  📊  expected: "${expected}"`)

  // ── judge ────────────────────────────────────────────────────────────────
  // All question types (incl. _abs) route through the paper's per-type prompts.
  // CoN answers start with a "Notes:" block; strip to the final "Answer:" line
  // so the paper's terse-answer judge prompt sees what it was designed for.
  const t4 = Date.now()
  let correct = false
  let correctWithChunks = null
  let failureReason = null
  const judgedAnswer = answer.match(/^Answer:\s*(.*)$/m)?.[1]?.trim() ?? answer

  // Baseline judge — vendored LongMemEval prompt, paper-comparable.
  correct = await judge(question, expected, judgedAnswer, question_type, isAbstention, null)

  // Treatment judge — same prompt + a Source Context block built from chunks
  // for ONLY the items CoN flagged as relevant (skip "Not relevant" notes).
  // supermemory-style: atomic memories for precision, chunks for nuance, with
  // CoN as the precision filter so the judge sees high-signal source only.
  // CoN item indices match the chronologically-sorted top-N retrieved list
  // built by _buildContextItems() in src/answering.js — replicate that sort here.
  let conRelevantN = 0, conTotalN = 0, conOffTopicN = 0
  if (JUDGE_DUAL) {
    const topRetrieved = retrieved.slice(0, SEARCH_TOP_N)
    const sortedForCoN = [...topRetrieved].sort((a, b) => {
      const da = a.document_date ?? '9999-12-31'
      const db = b.document_date ?? '9999-12-31'
      return da.localeCompare(db)
    })

    // Parse CoN notes: lines like "[N] <text>". Recognize both v1 and v2:
    //   v1 — "[N] Not relevant" → filter; everything else → keep
    //   v2 — "[N] off-topic: <reason>" → filter; "[N] answers: ..." /
    //        "[N] related: ..." → keep; "[N] (revised) <tag>: ..." overrides
    //        an earlier line for the same N (Step 1.5 self-check promotion).
    // Last write wins per index so a revised line beats its original tag.
    const noteRe = /^\s*\[(\d+)\]\s+(.+?)\s*$/gm
    const tagByIdx = new Map()  // idx → 'relevant' | 'off-topic'
    let m
    while ((m = noteRe.exec(answer)) !== null) {
      const idx = parseInt(m[1], 10)
      const note = m[2].trim().replace(/^\(revised\)\s+/i, '')
      const isOffTopic = /^not relevant\.?$/i.test(note) || /^off-topic\b/i.test(note)
      tagByIdx.set(idx, isOffTopic ? 'off-topic' : 'relevant')
    }
    conTotalN = tagByIdx.size
    const relevantIdxs = [...tagByIdx.entries()]
      .filter(([, tag]) => tag === 'relevant')
      .map(([idx]) => idx)
    conOffTopicN = conTotalN - relevantIdxs.length
    conRelevantN = relevantIdxs.length

    const seenChunkIds = new Set()
    const sourceChunks = []
    const addChunk = (r) => {
      if (!r || !r.chunk) return
      const cid = r.chunk_id ?? null
      if (cid != null) {
        if (seenChunkIds.has(cid)) return
        seenChunkIds.add(cid)
      }
      sourceChunks.push(r.chunk)
    }
    if (relevantIdxs.length > 0) {
      // CoN-filtered: only the items the answerer marked relevant
      for (const idx of relevantIdxs) addChunk(sortedForCoN[idx - 1])
    } else {
      // Fallback when CoN couldn't be parsed (malformed output) — use all
      // retrieved so the treatment arm still gets *some* signal instead of
      // degenerating to the baseline prompt.
      for (const r of retrieved) addChunk(r)
    }
    correctWithChunks = await judge(question, expected, judgedAnswer, question_type, isAbstention, sourceChunks)
  }

  if (!correct) failureReason = classifyFailure({ expected, retrieved, questionType: question_type, goldSessions })
  console.log(`  ⏱  judge:          ${(Date.now() - t4).toFixed(0)}ms  (${tokenLog.judging.input.toLocaleString()} tokens)`)
  console.log(`  ${correct ? '✅ correct' : `❌ incorrect — ${failureReason ?? 'abstention'}`}` +
    (JUDGE_DUAL ? `   | with-chunks: ${correctWithChunks ? '✅' : '❌'}  (CoN relevant ${conRelevantN}/${conTotalN})` : ''))

  // ── cost breakdown ────────────────────────────────────────────────────────
  const HAIKU_IN_PER_M  = 1    // $ per million input tokens
  const HAIKU_OUT_PER_M = 5
  // cache writes bill at 1.25x input, cache reads at 0.1x (Anthropic prompt caching)
  const costFor = b => (
    b.input * HAIKU_IN_PER_M +
    (b.cache_write ?? 0) * HAIKU_IN_PER_M * 1.25 +
    (b.cache_read  ?? 0) * HAIKU_IN_PER_M * 0.1 +
    b.output * HAIKU_OUT_PER_M
  ) / 1_000_000

  const haikuExtractionCost = costFor(ext.extraction)
  const haikuRelationCost   = costFor(ext.relationship)
  const haikuContextCost    = costFor(ext.contextualization)
  const haikuDerivationCost = costFor(ext.derivation)
  const haikuSubtotal       = haikuExtractionCost + haikuRelationCost + haikuContextCost + haikuDerivationCost
  const gpt4oCost = (
    (tokenLog.answering.input + tokenLog.judging.input) * 2.5 +
    (tokenLog.answering.output + tokenLog.judging.output) * 10
  ) / 1_000_000
  const totalCost = haikuSubtotal + gpt4oCost
  const totalMs   = Date.now() - t0

  console.log(`\n  💰 Cost breakdown:`)
  console.log(`     Haiku — extraction:        $${haikuExtractionCost.toFixed(4)}  (${ext.extraction.calls} calls)`)
  console.log(`     Haiku — relationship:      $${haikuRelationCost.toFixed(4)}  (${ext.relationship.calls} calls)`)
  console.log(`     Haiku — contextualization: $${haikuContextCost.toFixed(4)}  (${ext.contextualization.calls} calls)`)
  if (haikuDerivationCost > 0) {
    console.log(`     Haiku — derivation:        $${haikuDerivationCost.toFixed(4)}  (${ext.derivation.calls} calls)`)
  }
  console.log(`     Haiku — subtotal:          $${haikuSubtotal.toFixed(4)}`)
  console.log(`     GPT-4o (answer+judge):     $${gpt4oCost.toFixed(4)}`)
  console.log(`     Total (this question):     $${totalCost.toFixed(4)}`)
  console.log(`     × 60 questions:           ~$${(totalCost * 60).toFixed(2)}`)
  console.log(`\n  ⏱  Total time: ${(totalMs / 1000 / 60).toFixed(1)} min`)
  console.log(`     × 60 questions: ~${((totalMs / 1000 / 60) * 60 / 60).toFixed(1)} hours`)

  run.questions.push({
    question_id, question_type, question, expected, answer,
    correct, correct_with_chunks: correctWithChunks,
    con_relevant_n: conRelevantN, con_total_n: conTotalN, con_off_topic_n: conOffTopicN,
    is_abstention: isAbstention, failure_reason: failureReason,
    ingest_ms: ingestMs, sessions_count: haystack_sessions.length, retrieved_count: retrieved.length,
    search_ms:      searchMs,
    context_tokens: contextTokens,
    m_t_fired:      timeExtractFired,
    recall_at_5, recall_at_10, ndcg_at_5, ndcg_at_10,
    gold_sessions:      [...goldSessions],
    retrieved_sessions: rankedSessionIds,
    tokens: {
      extractor: {
        extraction:        { ...ext.extraction },
        relationship:      { ...ext.relationship },
        contextualization: { ...ext.contextualization },
        derivation:        { ...ext.derivation },
        time_extraction:   { ...ext.time_extraction },
        rerank:            { ...ext.rerank },
        query_expansion:   { ...ext.query_expansion },
        total: { input: sumIn(ext), output: sumOut(ext), calls: sumCalls(ext) },
      },
      embedder: {
        chunk:      { ...emb.chunk },
        dedup_seed: { ...emb.dedup_seed },
        memory:     { ...emb.memory },
        query:      { ...emb.query },
        derivation: { ...emb.derivation },
        total: { calls: sumCalls(emb) },
      },
      gpt4o_input:  tokenLog.answering.input  + tokenLog.judging.input,
      gpt4o_output: tokenLog.answering.output + tokenLog.judging.output,
    },
    retrieved: retrieved.map(r => ({
      memory:        r.memory,
      chunk:         r.chunk?.slice(0, 300),
      memory_type:   r.memory_type,
      confidence:    r.confidence,
      document_date: r.document_date,
      event_date:    r.event_date,
      relation_type: r.relation_type,
      source_role:   r.source_role,
      session_id:    r.session_id ?? null,
    })),
  })

  fs.writeFileSync(resultsFile, JSON.stringify(run, null, 2))

  // Throttle to keep cumulative GPT-4o token rate under per-minute TPM —
  // dual judge ~triples 4o calls per question vs the baseline runner.
  if (QUESTION_DELAY_MS > 0 && i < questions.length - 1) {
    await new Promise(r => setTimeout(r, QUESTION_DELAY_MS))
  }
}

// ── summary ────────────────────────────────────────────────────────────────

const LLM_PHASES      = ['extraction', 'relationship', 'contextualization', 'derivation', 'rerank', 'query_expansion']
const EMBEDDER_PHASES = ['chunk', 'dedup_seed', 'memory', 'query', 'derivation']

const byCat = {}
const llmTotal      = Object.fromEntries(LLM_PHASES.map(p      => [p, { input: 0, output: 0, calls: 0 }]))
const embedderTotal = Object.fromEntries(EMBEDDER_PHASES.map(p => [p, { calls: 0 }]))

for (const r of run.questions) {
  if (!byCat[r.question_type]) {
    byCat[r.question_type] = {
      total: 0, correct: 0, failures: {},
      correct_with_chunks: 0, chunks_n: 0, flipped_to_correct: 0, flipped_to_wrong: 0,
      r5_sum: 0, r10_sum: 0, n5_sum: 0, n10_sum: 0, metric_n: 0,
      search_ms_sum: 0, search_ms_n: 0,
      search_ms_mt_on_sum:  0, search_ms_mt_on_n:  0,
      search_ms_mt_off_sum: 0, search_ms_mt_off_n: 0,
      context_tokens_sum: 0, context_tokens_n: 0,
      extractor: Object.fromEntries(LLM_PHASES.map(p      => [p, { input: 0, output: 0, calls: 0 }])),
      embedder:  Object.fromEntries(EMBEDDER_PHASES.map(p => [p, { calls: 0 }])),
    }
  }
  const cat = byCat[r.question_type]
  cat.total++
  if (r.correct) cat.correct++
  else if (r.failure_reason) {
    cat.failures[r.failure_reason] = (cat.failures[r.failure_reason] ?? 0) + 1
  }
  // A/B treatment arm — count only when the dual judge actually ran.
  if (r.correct_with_chunks != null) {
    cat.chunks_n++
    if (r.correct_with_chunks) cat.correct_with_chunks++
    if (!r.correct &&  r.correct_with_chunks) cat.flipped_to_correct++
    if ( r.correct && !r.correct_with_chunks) cat.flipped_to_wrong++
  }
  if (r.recall_at_5 != null) {
    cat.r5_sum  += r.recall_at_5
    cat.r10_sum += r.recall_at_10
    cat.n5_sum  += r.ndcg_at_5
    cat.n10_sum += r.ndcg_at_10
    cat.metric_n += 1
  }
  // MemScore: search latency (split by M_T fired/not) + context tokens.
  if (r.search_ms != null) {
    cat.search_ms_sum += r.search_ms; cat.search_ms_n++
    if (r.m_t_fired) { cat.search_ms_mt_on_sum  += r.search_ms; cat.search_ms_mt_on_n++  }
    else             { cat.search_ms_mt_off_sum += r.search_ms; cat.search_ms_mt_off_n++ }
  }
  if (r.context_tokens != null) {
    cat.context_tokens_sum += r.context_tokens; cat.context_tokens_n++
  }
  // phase-keyed token/call accumulation
  const t = r.tokens
  if (t?.extractor) {
    for (const phase of LLM_PHASES) {
      const src = t.extractor[phase]; if (!src) continue
      cat.extractor[phase].input  += src.input  ?? 0
      cat.extractor[phase].output += src.output ?? 0
      cat.extractor[phase].calls  += src.calls  ?? 0
      llmTotal[phase].input  += src.input  ?? 0
      llmTotal[phase].output += src.output ?? 0
      llmTotal[phase].calls  += src.calls  ?? 0
    }
  }
  if (t?.embedder) {
    for (const phase of EMBEDDER_PHASES) {
      const src = t.embedder[phase]; if (!src) continue
      cat.embedder[phase].calls += src.calls ?? 0
      embedderTotal[phase].calls += src.calls ?? 0
    }
  }
}

console.log(`\n${'─'.repeat(70)}`)
console.log('\n── Results ─────────────────────────────────────────────────────────────')

const pct = (sum, n) => n ? ((sum / n) * 100).toFixed(1) + '%' : '—'
const meanMs  = (sum, n) => n ? Math.round(sum / n) + 'ms' : '—'
const meanTok = (sum, n) => n ? Math.round(sum / n).toString()   : '—'
const head = `  ${'category'.padEnd(28)} ${'acc'.padStart(7)} ${'acc+ch'.padStart(7)} ${'R@5'.padStart(7)} ${'R@10'.padStart(7)} ${'N@5'.padStart(7)} ${'N@10'.padStart(7)} ${'search'.padStart(7)} ${'ctxTok'.padStart(7)}  ${'supermem'.padStart(8)}  failures`
console.log(head)

let totalCorrect = 0, totalTotal = 0
let totalCorrectChunks = 0, totalChunksN = 0
let totalFlippedToCorrect = 0, totalFlippedToWrong = 0
let totalR5 = 0, totalR10 = 0, totalN5 = 0, totalN10 = 0, totalMetricN = 0
for (const [cat, s] of Object.entries(byCat)) {
  const acc  = ((s.correct / s.total) * 100).toFixed(1) + '%'
  const accCh = s.chunks_n
    ? ((s.correct_with_chunks / s.chunks_n) * 100).toFixed(1) + '%'
    : '—'
  const sm   = SUPERMEMORY_SCORES[cat] != null ? SUPERMEMORY_SCORES[cat].toFixed(1) + '%' : '—'
  const fail = Object.entries(s.failures).map(([k, v]) => `${k}:${v}`).join(' ')
  console.log(
    `  ${cat.padEnd(28)} ${acc.padStart(7)} ${accCh.padStart(7)} ` +
    `${pct(s.r5_sum,  s.metric_n).padStart(7)} ` +
    `${pct(s.r10_sum, s.metric_n).padStart(7)} ` +
    `${pct(s.n5_sum,  s.metric_n).padStart(7)} ` +
    `${pct(s.n10_sum, s.metric_n).padStart(7)} ` +
    `${meanMs(s.search_ms_sum, s.search_ms_n).padStart(7)} ` +
    `${meanTok(s.context_tokens_sum, s.context_tokens_n).padStart(7)}  ` +
    `${sm.padStart(8)}  ${fail}`
  )
  totalCorrect += s.correct
  totalTotal   += s.total
  totalCorrectChunks    += s.correct_with_chunks
  totalChunksN          += s.chunks_n
  totalFlippedToCorrect += s.flipped_to_correct
  totalFlippedToWrong   += s.flipped_to_wrong
  totalR5  += s.r5_sum;  totalR10 += s.r10_sum
  totalN5  += s.n5_sum;  totalN10 += s.n10_sum
  totalMetricN += s.metric_n
}

const overall = ((totalCorrect / totalTotal) * 100).toFixed(1) + '%'
const overallChunks = totalChunksN
  ? ((totalCorrectChunks / totalChunksN) * 100).toFixed(1) + '%'
  : '—'
// totals for the search-ms / ctx-tok columns mirror byCat aggregates.
const overallSearchMsSum  = Object.values(byCat).reduce((a, c) => a + c.search_ms_sum, 0)
const overallSearchMsN    = Object.values(byCat).reduce((a, c) => a + c.search_ms_n,   0)
const overallMtOnSum      = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_on_sum,  0)
const overallMtOnN        = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_on_n,    0)
const overallMtOffSum     = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_off_sum, 0)
const overallMtOffN       = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_off_n,   0)
const overallCtxTokSum    = Object.values(byCat).reduce((a, c) => a + c.context_tokens_sum, 0)
const overallCtxTokN      = Object.values(byCat).reduce((a, c) => a + c.context_tokens_n,   0)
console.log(
  `  ${'overall'.padEnd(28)} ${overall.padStart(7)} ${overallChunks.padStart(7)} ` +
  `${pct(totalR5,  totalMetricN).padStart(7)} ` +
  `${pct(totalR10, totalMetricN).padStart(7)} ` +
  `${pct(totalN5,  totalMetricN).padStart(7)} ` +
  `${pct(totalN10, totalMetricN).padStart(7)} ` +
  `${meanMs(overallSearchMsSum, overallSearchMsN).padStart(7)} ` +
  `${meanTok(overallCtxTokSum,  overallCtxTokN).padStart(7)}  ` +
  `${'81.6%'.padStart(8)}`
)

// A/B summary — only print when the dual judge actually ran.
if (totalChunksN > 0) {
  const baseAcc  = (totalCorrect       / totalChunksN) * 100
  const chAcc    = (totalCorrectChunks / totalChunksN) * 100
  const delta    = chAcc - baseAcc
  const sign     = delta > 0 ? '+' : ''
  console.log(
    `\n  A/B (judge with vs without source chunks, n=${totalChunksN}):\n` +
    `    baseline (no chunks):  ${baseAcc.toFixed(1)}%  (${totalCorrect}/${totalChunksN} correct)\n` +
    `    treatment (+chunks):   ${chAcc.toFixed(1)}%  (${totalCorrectChunks}/${totalChunksN} correct)\n` +
    `    delta:                 ${sign}${delta.toFixed(1)} pp\n` +
    `    flipped → correct:     ${totalFlippedToCorrect}\n` +
    `    flipped → wrong:       ${totalFlippedToWrong}`
  )
}

// supermemory-style triple: accuracy% / latencyMs / contextTok
//   https://supermemory.ai/docs/memorybench/memscore
// Bimodality from the optional M_T (time-extraction) LLM call is reported
// separately so the headline mean doesn't average it away.
const mtOnMs  = overallMtOnN  ? Math.round(overallMtOnSum  / overallMtOnN)  + 'ms' : '—'
const mtOffMs = overallMtOffN ? Math.round(overallMtOffSum / overallMtOffN) + 'ms' : '—'
console.log(
  `\n  MemScore (accuracy/latency/ctxTok): ${overall} / ` +
  `${meanMs(overallSearchMsSum, overallSearchMsN)} / ` +
  `${meanTok(overallCtxTokSum, overallCtxTokN)} tok` +
  `    (M_T on: ${mtOnMs}, off: ${mtOffMs})`
)

// ── Cost & call dominance ─────────────────────────────────────────────────
const HAIKU_IN_PER_M  = 1
const HAIKU_OUT_PER_M = 5
const phaseCost = b => (
  b.input * HAIKU_IN_PER_M +
  (b.cache_write ?? 0) * HAIKU_IN_PER_M * 1.25 +
  (b.cache_read  ?? 0) * HAIKU_IN_PER_M * 0.1 +
  b.output * HAIKU_OUT_PER_M
) / 1_000_000

const llmCostTotal = LLM_PHASES.reduce((s, p) => s + phaseCost(llmTotal[p]), 0)

console.log('\n── Cost & call dominance ───────────────────────────────────────────────')
console.log(`  ${'phase'.padEnd(30)} ${'calls'.padStart(8)} ${'in tok'.padStart(12)} ${'out tok'.padStart(10)} ${'$'.padStart(9)} ${'% LLM $'.padStart(9)}`)
for (const phase of LLM_PHASES) {
  const b = llmTotal[phase]
  const $ = phaseCost(b)
  const pctShare = llmCostTotal > 0 ? ((($ / llmCostTotal) * 100).toFixed(1) + '%') : '—'
  console.log(
    `  ${('Haiku — ' + phase).padEnd(30)} ${String(b.calls).padStart(8)} ${b.input.toLocaleString().padStart(12)} ${b.output.toLocaleString().padStart(10)} ${('$' + $.toFixed(4)).padStart(9)} ${pctShare.padStart(9)}`
  )
}
const llmCallsAll = LLM_PHASES.reduce((s, p) => s + llmTotal[p].calls,  0)
const llmInAll    = LLM_PHASES.reduce((s, p) => s + llmTotal[p].input,  0)
const llmOutAll   = LLM_PHASES.reduce((s, p) => s + llmTotal[p].output, 0)
console.log(
  `  ${'Haiku — TOTAL'.padEnd(30)} ${String(llmCallsAll).padStart(8)} ${llmInAll.toLocaleString().padStart(12)} ${llmOutAll.toLocaleString().padStart(10)} ${('$' + llmCostTotal.toFixed(4)).padStart(9)} ${'100.0%'.padStart(9)}`
)
console.log()
for (const phase of EMBEDDER_PHASES) {
  const b = embedderTotal[phase]
  console.log(`  ${('Embedder — ' + phase).padEnd(30)} ${String(b.calls).padStart(8)}`)
}
const embCallsAll = EMBEDDER_PHASES.reduce((s, p) => s + embedderTotal[p].calls, 0)
console.log(`  ${'Embedder — TOTAL'.padEnd(30)} ${String(embCallsAll).padStart(8)}`)

// Task 5.1 — relationship-classifier summary. Surfaces the UPDATES /
// EXTENDS / NEW distribution and how often the classifier even had
// candidates to choose from. KU diagnosis happens against the JSONL.
relationshipLogStream.end()
if (relationshipStats.total > 0) {
  const r = relationshipStats
  const pct = n => ((n / r.total) * 100).toFixed(1) + '%'
  const avgCands = (r.candidate_count_sum / r.total).toFixed(2)
  console.log(`\n── Relationship classifier (Task 5.1) ─────────────────────────────────`)
  console.log(`  total decisions:    ${r.total}`)
  console.log(`  UPDATES:            ${r.UPDATES} (${pct(r.UPDATES)})`)
  console.log(`  EXTENDS:            ${r.EXTENDS} (${pct(r.EXTENDS)})`)
  console.log(`  NEW:                ${r.NEW} (${pct(r.NEW)})`)
  console.log(`  no candidates:      ${r.no_candidates} (${pct(r.no_candidates)})  ← went straight to NEW`)
  console.log(`  LLM parse failed:   ${r.llm_failed} (${pct(r.llm_failed)})  ← fell back to NEW`)
  console.log(`  avg candidate count: ${avgCands}`)
  console.log(`  log: ${relationshipLogFile}`)
}

console.log(`\n[benchmark] results: ${resultsFile}`)

const toPct = (sum, n) => n ? parseFloat(((sum / n) * 100).toFixed(1)) : null
const meanOrNull = (sum, n, digits = 0) => n ? parseFloat((sum / n).toFixed(digits)) : null

// MemScore aggregate — overall + per-category mirrors of supermemory's triple.
const totalSearchMsSum    = Object.values(byCat).reduce((a, c) => a + c.search_ms_sum, 0)
const totalSearchMsN      = Object.values(byCat).reduce((a, c) => a + c.search_ms_n,   0)
const totalMtOnSum        = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_on_sum, 0)
const totalMtOnN          = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_on_n,   0)
const totalMtOffSum       = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_off_sum, 0)
const totalMtOffN         = Object.values(byCat).reduce((a, c) => a + c.search_ms_mt_off_n,   0)
const totalCtxTokSum      = Object.values(byCat).reduce((a, c) => a + c.context_tokens_sum, 0)
const totalCtxTokN        = Object.values(byCat).reduce((a, c) => a + c.context_tokens_n,   0)

run.summary = {
  overall_pct:                parseFloat(overall),
  supermemory_overall:        81.6,
  overall_recall_at_5_pct:    toPct(totalR5,  totalMetricN),
  overall_recall_at_10_pct:   toPct(totalR10, totalMetricN),
  overall_ndcg_at_5_pct:      toPct(totalN5,  totalMetricN),
  overall_ndcg_at_10_pct:     toPct(totalN10, totalMetricN),
  overall_metric_n:           totalMetricN,
  // supermemory-style triple: accuracy% / latencyMs / contextTok
  // https://supermemory.ai/docs/memorybench/memscore
  memscore: {
    accuracy_pct:          parseFloat(overall),
    mean_search_ms:        meanOrNull(totalSearchMsSum,  totalSearchMsN),
    mean_search_ms_mt_on:  meanOrNull(totalMtOnSum,      totalMtOnN),
    mean_search_ms_mt_off: meanOrNull(totalMtOffSum,     totalMtOffN),
    mean_context_tokens:   meanOrNull(totalCtxTokSum,    totalCtxTokN),
    n_questions:           totalSearchMsN,
  },
  cost: {
    by_phase: Object.fromEntries(LLM_PHASES.map(phase => {
      const b = llmTotal[phase]
      const $ = phaseCost(b)
      return [phase, {
        calls:      b.calls,
        in_tokens:  b.input,
        out_tokens: b.output,
        cost_usd:   parseFloat($.toFixed(4)),
        pct_of_llm: llmCostTotal > 0 ? parseFloat((($ / llmCostTotal) * 100).toFixed(1)) : null,
      }]
    })),
    embedder_calls_by_phase: Object.fromEntries(EMBEDDER_PHASES.map(p => [p, embedderTotal[p].calls])),
    total_haiku_usd: parseFloat(llmCostTotal.toFixed(4)),
  },
  by_category: Object.fromEntries(Object.entries(byCat).map(([cat, s]) => [cat, {
    correct:           s.correct,
    total:             s.total,
    pct:               parseFloat(((s.correct / s.total) * 100).toFixed(1)),
    supermemory_pct:   SUPERMEMORY_SCORES[cat] ?? null,
    recall_at_5_pct:   toPct(s.r5_sum,  s.metric_n),
    recall_at_10_pct:  toPct(s.r10_sum, s.metric_n),
    ndcg_at_5_pct:     toPct(s.n5_sum,  s.metric_n),
    ndcg_at_10_pct:    toPct(s.n10_sum, s.metric_n),
    metric_n:          s.metric_n,
    failures:          s.failures,
    memscore: {
      accuracy_pct:        parseFloat(((s.correct / s.total) * 100).toFixed(1)),
      mean_search_ms:      meanOrNull(s.search_ms_sum,      s.search_ms_n),
      mean_context_tokens: meanOrNull(s.context_tokens_sum, s.context_tokens_n),
    },
    extractor:         s.extractor,
    embedder:          s.embedder,
  }])),
}

fs.writeFileSync(resultsFile, JSON.stringify(run, null, 2))