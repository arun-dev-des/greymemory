// greymemory v0.3 — TypeScript types

// ── Core Types ─────────────────────────────────────────────────────────────

/**
 * Role of a message / the source role attributed to a fact.
 * 'document' is used internally when a raw string is added.
 */
export type Role = 'user' | 'assistant' | 'system' | 'document' | 'tool';

/** A text content block. */
export interface TextBlock { type: 'text'; text: string; }
/** An image content block — ingested as a '[image]' placeholder (the URL is never stored). */
export interface ImageBlock { type: 'image_url'; imageUrl: { url: string }; }
/** A single content block within a structured message. */
export type ContentBlock = TextBlock | ImageBlock;

/** A tool invocation on an assistant turn. Provider-shaped; serialized into text for the extractor. */
export interface ToolCall {
  id?:        string;
  name?:      string;
  arguments?: unknown;
  /** OpenAI-style nesting is also accepted. */
  function?:  { name?: string; arguments?: unknown };
}

/**
 * A single message in a conversation.
 *
 * `content` may be a plain string or an array of content blocks (text / image). Structured
 * agent transcripts may also carry `tool_calls` (assistant turns) and `tool_call_id` / `name`
 * (tool-result turns). All of these are flattened to a string at ingest — content blocks are
 * concatenated, images become a `[image]` placeholder, and tool calls/results are folded into
 * readable text — so older `{ role, content: string }` callers behave exactly as before.
 */
export interface Message {
  role:          Role;
  content:       string | ContentBlock[];
  /** Tool invocations made on an assistant turn. */
  tool_calls?:   ToolCall[];
  /** For a tool-result turn (role:'tool'): which call it answers. */
  tool_call_id?: string;
  /** Tool / function name (tool-result or named turns). */
  name?:         string;
}

/**
 * Memory types — how a fact is classified
 */
export type MemoryType = 'fact' | 'preference' | 'episode';

/**
 * Relationship types — how a memory relates to existing ones
 */
export type RelationType = 'UPDATES' | 'EXTENDS' | 'DERIVES' | null;

/**
 * A single memory row — returned by getMemories()
 */
export interface Memory {
  id:             number;
  key:            string;
  value:          string;
  container:      string;
  memory_type:    MemoryType;
  confidence:     number;
  document_date:  string | null;
  event_date:     string | null;
  expires_at:     string | null;
  is_latest:      number;
  superseded_by:  number | null;
  superseded_from:number | null;
  relation_type:  RelationType;
  related_to:     number | null;
  chunk_id:       number | null;
  metadata:       string;
  created_at:     string;
  updated_at:     string;
}

/**
 * A single search result — returned by search()
 * Pairs atomic memory with its source chunk (dual retrieval)
 */
export interface SearchResult {
  /** internal fact id — stable within this DB, null for chunk-only results */
  id:            number | null;
  /** atomic extracted memory — high signal, precise */
  memory:        string;
  /** source conversation chunk — full context, may be null for old facts */
  chunk:         string | null;
  /** FK into the chunks table — lets callers dedupe across facts sharing a source */
  chunk_id:      number | null;
  memory_type:   MemoryType;
  confidence:    number;
  document_date: string | null;
  event_date:    string | null;
  relation_type: RelationType;
  /** source role of the producing message (user / assistant / system / tool / document) */
  source_role:   Role | null;
  /** identifier of the session this item came from — null if the chunk had no sessionId at ingest */
  session_id:    string | null;
}

/**
 * A chain of versions for a fact — returned by getHistory()
 */
export interface HistoryChain {
  /** value of the current (latest) version */
  current: string;
  /** full version chain, newest first */
  chain: HistoryEntry[];
}
export interface HistoryEntry {
  id:            number;
  key:           string;
  value:         string;
  memory_type:   MemoryType;
  document_date: string | null;
  event_date:    string | null;
  is_latest:     boolean;
  superseded_by: number | null;
  relation_type: RelationType;
}

/**
 * User profile — returned by getProfile()
 * Matches Supermemory's profile API shape
 */
export interface Profile {
  /** stable long-term facts and preferences */
  static:  string[];
  /** recent facts and current episodes */
  dynamic: string[];
}

/**
 * A derived memory — returned by runDerivations()
 */
export interface DerivedMemory {
  id:      number;
  value:   string;
  fromIds: number[];
}

// ── Function Types ─────────────────────────────────────────────────────────

/**
 * Extracts memories from a prompt string.
 * You provide this — use any LLM you want.
 * Receives the full built prompt, returns a raw string (JSON array).
 *
 * @example Anthropic
 * const extractor = async (prompt) => {
 *   const res = await anthropic.messages.create({
 *     model: 'claude-haiku-4-5-20251001',
 *     max_tokens: 1024,
 *     messages: [{ role: 'user', content: prompt }]
 *   })
 *   return res.content[0].text
 * }
 *
 * @example OpenAI
 * const extractor = async (prompt) => {
 *   const res = await openai.chat.completions.create({
 *     model: 'gpt-4o-mini',
 *     messages: [{ role: 'user', content: prompt }]
 *   })
 *   return res.choices[0].message.content
 * }
 *
 * @example Ollama (local)
 * const extractor = async (prompt) => {
 *   const res = await fetch('http://localhost:11434/api/chat', {
 *     method: 'POST',
 *     body: JSON.stringify({
 *       model: 'llama3',
 *       messages: [{ role: 'user', content: prompt }],
 *       stream: false
 *     })
 *   })
 *   return (await res.json()).message.content
 * }
 */
export interface ExtractorContext {
  /**
   * Internal call site the library is making this call from. Lets consumers
   * attribute LLM tokens/cost to a specific stage of the pipeline.
   * New phases may be added without breaking changes — match defensively.
   */
  phase?: 'extraction' | 'relationship' | 'contextualization' | 'derivation' | 'time_extraction';
}

export type ExtractorFn = (prompt: string, context?: ExtractorContext) => Promise<string> | string;

/**
 * Converts text into a vector embedding.
 * You provide this — use any embedding model you want.
 *
 * @example Ollama (local)
 * const embedder = async (text) => {
 *   const res = await fetch('http://localhost:11434/api/embeddings', {
 *     method: 'POST',
 *     body: JSON.stringify({ model: 'mxbai-embed-large', prompt: text })
 *   })
 *   return (await res.json()).embedding
 * }
 *
 * @example OpenAI
 * const embedder = async (text) => {
 *   const res = await openai.embeddings.create({
 *     model: 'text-embedding-3-small',
 *     input: text
 *   })
 *   return res.data[0].embedding
 * }
 */
export interface EmbedderContext {
  /**
   * Internal call site the library is making this call from. Lets consumers
   * attribute embedder calls (and downstream cost) to a specific stage.
   * New phases may be added without breaking changes — match defensively.
   */
  phase?: 'chunk' | 'dedup_seed' | 'memory' | 'query' | 'derivation';
}

export type EmbedderFn = (text: string, context?: EmbedderContext) => Promise<number[]> | number[];

// ── Options ────────────────────────────────────────────────────────────────

export interface GreyMemoryOptions {
  /**
   * Function that receives a built prompt and returns a raw string.
   * Use any LLM — Anthropic, OpenAI, Ollama, etc.
   * Required.
   */
  extractor: ExtractorFn;

  /**
   * Function that converts text to a vector embedding.
   * Must return an array of numbers.
   * Required.
   */
  embedder: EmbedderFn;

  /**
   * Directory to store the SQLite database.
   * @default ".greymemory"
   */
  dir?: string;

  /**
   * Container name for isolating memory namespaces.
   * Use different containers for different users or projects.
   * @default "default"
   *
   * @example
   * new GreyMemory({ container: 'user_123', ... })
   */
  container?: string;

  /**
   * Organisation-level filter instructions.
   * Tell greymemory what to index and what to skip.
   *
   * @example
   * filterPrompt: 'Index: decisions, preferences, project context. Skip: small talk, greetings.'
   */
  filterPrompt?: string;

  /**
   * Optional override for the extraction-phase prompt. When provided, this builder is called
   * instead of the built-in prompt for the EXTRACTION phase only (relationship,
   * contextualization and time-extraction keep their built-in prompts). Lets a consumer supply
   * a domain-specific extractor prompt (e.g. a coding-session prompt) without forking the library.
   * The returned string must instruct the model to emit greymemory's JSON memory array.
   */
  extractorPrompt?: (opts: {
    input: string | Message[];
    existingFacts: { key: string; value: string; memory_type: MemoryType }[];
    documentDate: string;
    filterPrompt?: string;
    entityContext?: string;
  }) => string;

  /**
   * Per-container context about who this memory belongs to.
   * Used as the seed for reference resolution during extraction.
   * Automatically enriched after each add() call from the accumulated profile.
   * By session 3+, the extractor knows: employer, location, preferences etc.
   *
   * @example
   * entityContext: 'Memory for Arun, a product designer based in Bangalore.'
   */
  entityContext?: string;

  /**
   * Enable Contextual Retrieval — prepends chunk-specific context before
   * embedding and BM25 indexing. Improves retrieval accuracy significantly
   * but adds one LLM call per chunk at ingestion time.
   * Based on Anthropic's Contextual Retrieval technique.
   * @default false
   */
  contextualRetrieval?: boolean;

  /**
   * Extraction granularity.
   *
   * - `'session'` (default): extract the whole conversation in one LLM call,
   *   mapping each fact back to its round via the extractor's
   *   `source_message_index`. Strongest cross-round reference resolution.
   * - `'round'`: extract one round at a time, in order, with a sharp per-round
   *   dedup seed and a running summary of earlier rounds (threaded through
   *   `entityContext`) so cross-round references still resolve. Provenance is
   *   exact — every fact is attributed to its own round's chunk — and the
   *   K = V + fact chunk embedding aligns by construction. Plain string
   *   (document) inputs always use `'session'`.
   *
   * Overridable per call via {@link AddOptions.extractionMode}.
   * @default 'session'
   */
  extractionMode?: 'session' | 'round';

  /**
   * Pass an existing better-sqlite3 Database instance.
   * Use when you want to manage the database lifecycle yourself.
   */
  db?: object;

  /**
   * Diagnostic callback — invoked once per relationship-classification
   * decision (UPDATES / EXTENDS / NEW). Use to instrument the supersession
   * classifier (Task 5.1: KU-gap diagnosis). Errors thrown by the callback
   * are swallowed so ingestion never blocks on logging.
   */
  onRelationshipDecision?: (entry: RelationshipDecisionLog) => void;
}

/**
 * Structured log entry emitted by Memory for each relationship-classification
 * call. Lets consumers diagnose whether KU failures originate in candidate
 * retrieval (`candidate_count === 0`, or correct old fact not in `candidates`)
 * vs. the classifier prompt (correct old fact present but `decision.type !==
 * 'UPDATES'`).
 */
export interface RelationshipDecisionLog {
  /** Wall-clock ms when the decision was made */
  timestamp: number;
  /** Memory container this decision belongs to */
  container: string;
  /** The new fact being classified */
  new_fact: {
    key:           string;
    value:         string;
    memory_type:   MemoryType;
    document_date: string | null;
    event_date:    string | null;
    source_role:   Role | null;
  };
  /** Number of existing facts the classifier considered */
  candidate_count: number;
  /** Trimmed view of each candidate the classifier saw */
  candidates: Array<{
    id:            number;
    key:           string;
    value:         string;
    memory_type:   MemoryType;
    document_date: string | null;
    event_date:    string | null;
  }>;
  /** The chosen relationship */
  decision: {
    type:      'UPDATES' | 'EXTENDS' | 'NEW';
    relatedTo: number | null;
  };
  /** The candidate that decision.relatedTo points at — or candidates[0] for NEW */
  top_candidate: { id: number; key: string; value: string } | null;
  /** How the decision was reached */
  reason: 'no_candidates' | 'llm' | 'llm_failed';
  /** Raw LLM response (when reason === 'llm' | 'llm_failed'); null otherwise */
  llm_raw: string | null;
}

/**
 * Result returned by add(). Counts are accumulated per-call (attempts, not
 * successes), so they match the wrapper's view modulo API-error edge cases.
 */
export interface AddResult {
  chunksStored: number;
  factsStored:  number;
  /** Rounds skipped because their content was already ingested under this sessionId
   *  (only ever non-zero when `dedupBySession` is set). */
  roundsSkipped: number;
  /** Chunks skipped — equals `roundsSkipped` (one chunk per round); alias for clarity. */
  chunksSkipped: number;
  llmCalls: {
    extraction:        number;
    relationship:      number;
    contextualization: number;
    total:             number;
  };
  embedderCalls: {
    chunk:      number;
    dedup_seed: number;
    memory:     number;
    total:      number;
  };
}

/**
 * Options for add()
 */
export interface AddOptions {
  /**
   * The date this session occurred.
   * Accepts any reasonable format — LongMemEval, ISO, slash dates, natural language, Date object, Unix ms.
   * Only absolute truths preserved — time kept only if present in input.
   * Defaults to current date if not provided.
   *
   * @example
   * { date: "2023/05/20 (Sat) 02:21" }  // LongMemEval format
   * { date: "2023-05-20" }               // ISO date
   * { date: new Date() }                 // Date object
   */
  date?: string | number | Date | null;

  /**
   * Per-session entity context — overrides the constructor entityContext for this call.
   * Use to pass evolving user context that updates after each session.
   *
   * @example
   * // update context from profile after each session
   * const { profile } = await memory.getProfile()
   * const entityContext = `Known facts: ${[...profile.static, ...profile.dynamic].join('. ')}`
   * await memory.add(nextSession, { date, entityContext })
   */
  entityContext?: string;

  /**
   * Caller-supplied session identifier. Persisted to chunks.session_id and surfaces
   * on SearchResult.session_id, enabling per-session provenance tracking and
   * evaluation metrics (e.g. LongMemEval-style Recall@k / NDCG@k).
   *
   * When {@link AddOptions.dedupBySession} is set, this also becomes the dedup/upsert
   * key — re-adding a growing conversation under the same id only ingests new rounds.
   */
  sessionId?: string | null;

  /**
   * Opt in to round-level dedup keyed by {@link AddOptions.sessionId} (requires it).
   * When true, a round whose raw text was already ingested under the same sessionId in
   * this container is skipped — not re-chunked, not re-embedded, not re-extracted —
   * letting a hook re-send a whole transcript cheaply. Two rounds with identical text
   * collide by design (content-hash dedup). Off by default → behavior is unchanged.
   * @default false
   */
  dedupBySession?: boolean;

  /**
   * Override the constructor's extraction granularity for this call.
   * See {@link GreyMemoryOptions.extractionMode}.
   */
  extractionMode?: 'session' | 'round';
}
export interface SearchOptions {
  /**
   * Number of results to return. @default 5
   *
   * Should scale with reader-model capability (LongMemEval §5.2): weak readers
   * degrade past ~3k retrieved tokens, strong readers (e.g. GPT-4o) keep
   * improving past 20k. Rough guidance: weak readers `topN: 3–5`, strong
   * readers `topN: 15–25`. The caller decides — no auto-scaling here.
   */
  topN?: number;
  /** Filter by memory type. null returns all types. */
  memoryTypes?: MemoryType[] | null;
  /** Filter by event_date — only return memories on or after this date (YYYY-MM-DD) */
  afterDate?: string | null;
  /** Filter by event_date — only return memories on or before this date (YYYY-MM-DD) */
  beforeDate?: string | null;
  /** Include superseded facts (is_latest=0). @default false */
  includeHistory?: boolean;
  /** Include expired episodes. @default false */
  includeExpired?: boolean;
  /**
   * Return facts that were current at this point in time, not just is_latest=1.
   * ISO date string: "2023-03-10" or "2023-03-10T14:30".
   * Date-only values are treated as end-of-day.
   * Critical for temporal queries — "where did the user work in March 2023?"
   */
  asOf?: string | null;
  /**
   * Auto-extract a date range from the query via an LLM call (LongMemEval §5.4).
   * Only fires when both `afterDate` and `beforeDate` are unset — caller-supplied
   * bounds always win. Gated by a cheap temporal-cue regex; non-temporal queries
   * skip the LLM call entirely.
   *
   * Paper note: the extractor model must be reasonably strong — a weak model
   * that hallucinates ranges can make temporal recall WORSE than baseline by
   * filtering out the correct answer. Set to false if your extractor is small.
   *
   * @default true
   */
  timeAwareQuery?: boolean;
  /**
   * Rerank the candidate pool against the query before slicing seeds, using the
   * user-supplied extractor LLM (phase `'rerank'`). RRF fusion ranks by
   * rank-position, not relevance; reranking rescores candidates against the
   * actual question. Fail-open: any error leaves the RRF order untouched.
   * @default false
   */
  rerank?: boolean;
  /**
   * Pluggable custom reranker. Receives the query and the candidate texts and
   * returns an array of candidate indices ordered most→least relevant. Overrides
   * the built-in LLM reranker. Lets you drop in a cross-encoder (Cohere/bge/
   * Voyage) without forking. Fail-open on throw.
   */
  reranker?: ((query: string, candidates: string[]) => Promise<number[]> | number[]) | null;
  /**
   * Expand the query into paraphrases (extractor phase `'query_expansion'`) and
   * union the candidate sets — raises recall on multi-session/temporal questions.
   * `true` → 3 variants; pass a number for a different count.
   * @default false
   */
  multiQuery?: boolean | number;
  /**
   * Raise the effective `topN` for aggregation/count questions ("how many",
   * "total", "every"…), whose evidence is spread across many sessions.
   * @default false
   */
  adaptiveAggregation?: boolean;
  /**
   * Demote results beyond this many per session to the end of the list before
   * the seed slice (never drops). Protects multi-session recall from a single
   * chatty session monopolising the seed budget. null = no cap.
   * @default null
   */
  maxPerSession?: number | null;
  /**
   * Candidate count fetched and fused before filtering + reranking. Decoupled
   * from `topN` so type/date filters can't starve the seed slice.
   * @default max(topN*4, 40)
   */
  candidatePool?: number | null;
}

/**
 * Options for getProfile()
 */
export interface ProfileOptions {
  /** Optional search query — returns profile + search results in one call */
  q?: string | null;
  /** Number of search results when q is provided. @default 5 */
  topN?: number;
}

/**
 * Options for runDerivations()
 */
export interface DerivationOptions {
  /** Look at facts added in last N days. @default 7 */
  sinceDays?: number;
  /** Number of similar facts to combine with each recent fact. @default 10 */
  topK?: number;
}

// ── Main Class ─────────────────────────────────────────────────────────────

/**
 * greymemory — self-hosted memory layer for AI agents.
 *
 * @example
 * import GreyMemory from 'greymemory'
 *
 * const memory = new GreyMemory({
 *   extractor: async (prompt) => { ... },
 *   embedder:  async (text)   => { ... },
 *   filterPrompt:  'Index decisions and preferences. Skip small talk.',
 *   entityContext: 'Memory for Arun, product designer.',
 * })
 *
 * await memory.add(messages)
 * const results = await memory.search('where does Arun work')
 */
export default class GreyMemory {
  constructor(options: GreyMemoryOptions);

  /**
   * Add a conversation or document to memory.
   * Saves chunks first, then extracts and stores memories with provenance.
   * After each call, entityContext is automatically updated from the accumulated profile —
   * reference resolution improves with every session.
   *
   * @example Conversation
   * await memory.add([
   *   { role: 'user',      content: 'I work at Stripe as a PM' },
   *   { role: 'assistant', content: 'Great!' }
   * ], { date: '2023-05-20' })
   *
   * @example Plain text
   * await memory.add('Arun is building greymemory.', { date: new Date() })
   */
  add(input: Message[] | string, options?: AddOptions): Promise<AddResult>;

  /**
   * Search memory using hybrid BM25 + vector search with RRF fusion.
   * Returns atomic memories paired with their source chunks.
   *
   * @example Basic
   * const results = await memory.search('where does Arun work')
   *
   * @example With options
   * const results = await memory.search('investor meeting', {
   *   topN:        3,
   *   memoryTypes: ['episode'],
   *   afterDate:   '2026-04-01',
   * })
   */
  search(query: string, options?: SearchOptions | number): Promise<SearchResult[]>;

  /**
   * Get all current memories for this container.
   * Returns full row objects — useful for inspection and debugging.
   */
  getMemories(): Memory[];

  /**
   * @deprecated Use getMemories() instead.
   * Kept for v0.2.x backward compatibility.
   */
  getFacts(): Memory[];

  /**
   * Get the current (is_latest=1) version of a fact via semantic search.
   * Always uses natural language — keys are internal.
   *
   * @example
   * const current = await memory.getCurrent('where does Arun work')
   * // → { id: 3, value: 'Arun works at Stripe', ... }
   */
  getCurrent(query: string): Promise<SearchResult | null>;

  /**
   * Returns top N semantic matches, each with their full version chain.
   * Newest first within each chain. Let the answering prompt reason about
   * which chain is relevant.
   *
   * @example
   * const chains = await memory.getHistory('where has Arun worked')
   * // chains[0].current → most recent employer
   * // chains[0].chain   → full version history
   */
  getHistory(query: string, topN?: number): Promise<HistoryChain[]>;

  /**
   * Get static/dynamic user profile — injection-ready for system prompts.
   * Matches Supermemory's profile API shape.
   *
   * static:  preferences (always) + facts older than 7 days
   * dynamic: facts from last 7 days + current episodes
   *
   * @example Basic
   * const { profile } = await memory.getProfile()
   * // profile.static  → ['Arun prefers TypeScript', ...]
   * // profile.dynamic → ['Arun is building greymemory', ...]
   *
   * @example With search (profile + results in one call)
   * const { profile, results } = await memory.getProfile({ q: 'current project' })
   */
  getProfile(options?: ProfileOptions): Promise<{ profile: Profile; results?: SearchResult[] }>;

  /**
   * Soft-delete a memory via semantic search.
   * Sets expires_at to yesterday — immediately excluded from all queries.
   * Data is preserved in the database for audit.
   *
   * @returns The value of the forgotten memory, or null if not found.
   *
   * @example
   * const forgotten = await memory.forget('investor demo')
   * // → 'Arun has an investor demo on Friday April 10th at 3pm'
   */
  forget(query: string): Promise<string | null>;

  /**
   * Infer second-order conclusions by combining recent memories.
   * Call manually after add(), on a schedule, or before important queries.
   * Never blocks ingestion — derivation is a separate concern.
   *
   * @example
   * await memory.add(messages)
   * await memory.runDerivations()             // default: last 7 days
   * await memory.runDerivations({ sinceDays: 1, topK: 5 })
   */
  runDerivations(options?: DerivationOptions): Promise<DerivedMemory[]>;

  /**
   * Clear all memory for this container.
   * Deletes facts, embeddings, chunks, and chunk embeddings.
   * Other containers are untouched.
   */
  clear(): void;
}

// ── Answering ──────────────────────────────────────────────────────────────

/**
 * Options for buildAnsweringPrompt()
 */
export interface AnsweringOptions {
  /** The question to answer */
  question: string;
  /** When the question was asked — ISO date or datetime */
  questionDate: string;
  /** Search results from memory.search() */
  results: SearchResult[];
  /** Optional profile from memory.getProfile() */
  profile?: Profile | null;
  /** Max results to include in prompt. @default 10 */
  topN?: number;
}

/**
 * Builds the answering prompt for a question using retrieved memories.
 * Handles temporal reasoning, knowledge updates, abstention, and DERIVES inference.
 *
 * @example
 * import GreyMemory, { buildAnsweringPrompt } from 'greymemory'
 *
 * const results = await memory.search(question, { topN: 10 })
 * const { profile } = await memory.getProfile()
 *
 * const prompt = buildAnsweringPrompt({
 *   question,
 *   questionDate: '2023-05-30',
 *   results,
 *   profile,
 * })
 *
 * const answer = await extractor(prompt)
 */
export function buildAnsweringPrompt(options: AnsweringOptions): string;

/**
 * Options for formatForReading()
 */
export interface FormatForReadingOptions {
  /** The question to answer */
  question: string;
  /** When the question was asked — ISO date or datetime */
  questionDate: string;
  /** Search results from memory.search() */
  results: SearchResult[];
  /** Optional profile from memory.getProfile() */
  profile?: Profile | null;
  /** Max results to include in prompt. @default 10 */
  topN?: number;
  /** Reserved for future date-anchoring (unused today) */
  asOf?: string | null;
  /**
   * CoN prompt variant. 'v1' is the original Chain-of-Note prompt.
   * 'v2' (see {@link formatForReadingV2}) introduces topic anchors, 3-tier
   * relevance tagging, and an off-topic self-check. @default 'v1'
   */
  version?: 'v1' | 'v2';
}

/**
 * Builds a JSON + Chain-of-Note (CoN) answering prompt.
 *
 * Per LongMemEval §5.5 (Wu et al., ICLR 2025), this rendering adds ~10
 * absolute points to answerer accuracy over plain-prose. JSON and CoN are
 * intentionally bundled — JSON alone underperforms prose.
 *
 * Retrieved items are sorted by document_date ascending (null dates last)
 * for the prompt only; the input `results` array is not mutated.
 *
 * @example
 * import GreyMemory, { formatForReading } from 'greymemory'
 *
 * const results = await memory.search(question, { topN: 10 })
 * const prompt  = formatForReading({
 *   question,
 *   questionDate: '2026-05-25',
 *   results,
 * })
 * const answer  = await answerer(prompt)
 */
export function formatForReading(options: FormatForReadingOptions): string;

/**
 * Builds a redesigned Chain-of-Note answering prompt that fixes the false-
 * negative gold-memory rejection observed in v1 (see `formatForReading`).
 *
 * Differences from v1:
 *   • Step 0 — Topic anchors (entity/attribute/event the question is about)
 *   • Step 1 — 3-tier scoring: `answers` / `related` / `off-topic`
 *     (`off-topic` requires a quoted noun phrase from the item)
 *   • Step 1.5 — Self-check on off-topic items
 *   • Step 2 — Explicit inline date comparison for superlative questions
 *
 * The CURRENT VALUES banner remains the sole authority for present-tense
 * knowledge-update questions. Output still ends with `Answer: <text>`, so
 * downstream judges that read the Answer line are unaffected.
 *
 * @example
 * const prompt = formatForReadingV2({ question, questionDate, results })
 * // equivalent to: formatForReading({ ..., version: 'v2' })
 */
export function formatForReadingV2(
  options: Omit<FormatForReadingOptions, 'version' | 'asOf'>
): string;

/**
 * Returns just the retrieved-context string the answerer sees — the JSON
 * items block produced by `formatForReading`, without the surrounding
 * question and instructions.
 *
 * Used to measure supermemory-style `contextTok` (tokens in just the
 * context the memory provider returns to the answering model). The string
 * is byte-identical to the corresponding section inside `formatForReading`,
 * so token counts on this output match what the answerer is actually billed
 * for in the context portion.
 *
 * @example
 * import { formatRetrievedContext } from 'greymemory'
 * import { encode } from 'gpt-tokenizer/model/gpt-4o'
 *
 * const results = await memory.search(question, { topN: 10 })
 * const context = formatRetrievedContext(results, 10)
 * const contextTokens = encode(context).length
 */
export function formatRetrievedContext(results: SearchResult[], topN?: number): string;