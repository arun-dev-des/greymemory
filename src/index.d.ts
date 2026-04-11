// greymemory v0.3 — TypeScript types

// ── Core Types ─────────────────────────────────────────────────────────────

/**
 * A single message in a conversation
 */
export interface Message {
  role:    'user' | 'assistant' | 'system' | 'document';
  content: string;
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
  /** atomic extracted memory — high signal, precise */
  memory:        string;
  /** source conversation chunk — full context, may be null for old facts */
  chunk:         string | null;
  memory_type:   MemoryType;
  confidence:    number;
  document_date: string | null;
  event_date:    string | null;
  relation_type: RelationType;
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
export type ExtractorFn = (prompt: string) => Promise<string> | string;

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
export type EmbedderFn = (text: string) => Promise<number[]> | number[];

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
   * Per-container context about who this memory belongs to.
   * Used to resolve ambiguous references during extraction.
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
   * Pass an existing better-sqlite3 Database instance.
   * Use when you want to manage the database lifecycle yourself.
   */
  db?: object;
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
}
export interface SearchOptions {
  /** Number of results to return. @default 5 */
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
  add(input: Message[] | string, options?: AddOptions): Promise<void>;

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