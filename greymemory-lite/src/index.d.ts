/**
 * greymemory-lite — paper-faithful memory core for AI agents.
 *
 * SQLite + FTS5/BM25 + vector cosine + RRF fusion, with bring-your-own-LLM
 * extraction. Self-hosted; no data leaves the box.
 */

// ── Provider seams ──────────────────────────────────────────────

/** Internal stage that triggered an extractor call. Lite only ever extracts. */
export type ExtractorPhase = "extraction";

/** Internal stage that triggered an embedder call. */
export type EmbedderPhase = "chunk" | "dedup_seed" | "memory" | "query";

/**
 * User-supplied LLM call. Receives a complete prompt string and must return
 * the model's raw text (a JSON array of memories for the extraction phase).
 */
export type ExtractorFn = (
  prompt: string,
  context?: { phase: ExtractorPhase }
) => Promise<string>;

/** User-supplied embedding call. Receives text, returns a vector. */
export type EmbedderFn = (
  text: string,
  context?: { phase: EmbedderPhase }
) => Promise<number[]>;

/**
 * Optional custom extraction-prompt builder — the single customization seam.
 * Domain context, filtering rules, persona all live here. Must instruct the
 * model to emit greymemory's JSON memory array.
 */
export type ExtractorPromptFn = (opts: {
  input: string | Array<{ role: string; content: string }>;
  existingFacts: Array<{ key: string; value: string; memory_type: string }>;
  documentDate: string;
  entityContext?: string;
}) => string;

// ── Messages ────────────────────────────────────────────────────

export interface ContentBlock {
  type: string;
  text?: string;
  [k: string]: unknown;
}

export interface Message {
  role: string;
  content: string | ContentBlock[];
  /** assistant turns may carry tool calls; they are folded into text */
  tool_calls?: unknown[];
  /** tool-result turns (role: 'tool') may carry the tool name */
  name?: string;
}

// ── Options ─────────────────────────────────────────────────────

export interface GreyMemoryOptions {
  /** Required. The extraction LLM call. */
  extractor: ExtractorFn;
  /** Required. The embedding call. */
  embedder: EmbedderFn;
  /** Storage directory. Default: ".greymemory-lite" */
  dir?: string;
  /** Namespace isolation within the database. Default: "default" */
  container?: string;
  /**
   * Existing better-sqlite3 Database instance — lite creates its own tables
   * inside it (typed as object: better-sqlite3 ships no type definitions).
   */
  db?: object;
  /** Custom extraction-prompt builder (replaces the built-in prompt). */
  extractorPrompt?: ExtractorPromptFn;
}

export interface AddOptions {
  /**
   * Session date, ISO-ish ("2026-06-10", "2023/05/20 (Sat) 02:21", Date).
   * Defaults to today. Unparseable values fall back to today.
   */
  date?: string | Date;
  /** Provenance + dedup key for one conversation. */
  sessionId?: string;
  /**
   * With sessionId: re-adding the same conversation skips already-ingested
   * rounds entirely (no chunk, no extraction). Default false.
   */
  dedupBySession?: boolean;
}

export interface AddResult {
  chunksStored: number;
  factsStored: number;
  roundsSkipped: number;
  /** one chunk per round; alias of roundsSkipped */
  chunksSkipped: number;
  llmCalls: { extraction: number; total: number };
  embedderCalls: { chunk: number; dedup_seed: number; memory: number; total: number };
}

export type MemoryType = "fact" | "preference" | "episode";

export interface SearchOptions {
  /** Number of results. Default 5. Scale with reader strength (10–25 for GPT-4o class). */
  topN?: number;
  /** Filter by memory type. */
  memoryTypes?: MemoryType[];
  /** Only facts whose event_date >= this (facts with no event_date pass). */
  afterDate?: string;
  /** Only facts whose event_date <= this (facts with no event_date pass). */
  beforeDate?: string;
  /** Temporal cutoff: facts/chunks recorded after this date are invisible. */
  asOf?: string;
}

export interface SearchResult {
  /** The extracted memory text — null for chunk-only results. */
  memory: string | null;
  /** The raw conversation round that produced this memory. */
  chunk: string | null;
  memory_type: MemoryType | null;
  document_date: string | null;
  event_date: string | null;
  source_role: "user" | "assistant" | string | null;
  session_id: string | null;
}

export interface MemoryRow {
  id: number;
  key: string;
  value: string;
  container: string;
  memory_type: MemoryType;
  document_date: string | null;
  event_date: string | null;
  expires_at: string | null;
  chunk_id: number | null;
  source_role: string | null;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  /** preferences (always) + facts older than 7 days */
  static: string[];
  /** facts from the last 7 days + current episodes */
  dynamic: string[];
}

export interface GetProfileOptions {
  /** Also run search(q) and return results alongside the profile. */
  q?: string;
  topN?: number;
  /** Compute the profile relative to this date instead of today. */
  asOf?: string;
}

export interface GetProfileResult {
  profile: Profile;
  results?: SearchResult[];
}

// ── Memory class ────────────────────────────────────────────────

export class Memory {
  constructor(options: GreyMemoryOptions);

  /**
   * Ingest a conversation (or raw text). Chunks are persisted before
   * extraction runs; one extraction LLM call per round.
   */
  add(input: string | Message[], opts?: AddOptions): Promise<AddResult>;

  /** Hybrid BM25 + vector + RRF search. One embedder call, zero LLM calls. */
  search(query: string, options?: number | SearchOptions): Promise<SearchResult[]>;

  /** static/dynamic profile split — injection-ready for system prompts. */
  getProfile(options?: GetProfileOptions): Promise<GetProfileResult>;

  /** Every current (non-expired) memory as full rows — the transparency surface. */
  getMemories(): MemoryRow[];

  /**
   * Soft-delete the closest-matching memory (semantic search). Returns the
   * forgotten value, or null when nothing matched.
   */
  forget(query: string): Promise<string | null>;

  /** Delete all facts, chunks, and embeddings for this container. */
  clear(): void;
}

export { Memory as GreyMemory };
export default Memory;

// ── Reading helpers (CP4) ───────────────────────────────────────

export interface FormatForReadingOptions {
  question: string;
  /** When the question is being asked (ISO date). */
  questionDate: string;
  results?: SearchResult[];
  profile?: Profile | null;
  /** Max results to include. Default 10. */
  topN?: number;
}

/**
 * Build a JSON + Chain-of-Note answering prompt over search results
 * (chronologically sorted). Adds up to ~10 accuracy points over plain prose
 * per LongMemEval §5.5 — and is where contradictions get resolved.
 */
export function formatForReading(opts: FormatForReadingOptions): string;

/** Extract the final answer line from a Chain-of-Note response. */
export function parseReadingAnswer(raw: string): string;

// ── Extraction prompt ───────────────────────────────────────────

/**
 * The built-in extraction prompt: stable static prefix + per-call dynamic
 * suffix. The returned string always begins with EXTRACTOR_STATIC_PREFIX,
 * so consumers can split on it for provider prompt caching.
 */
export function buildExtractorPrompt(opts: {
  input: string | Message[] | Array<{ role: string; content: string }>;
  existingFacts?: Array<{ key: string; value: string; memory_type: string }>;
  documentDate: string;
  filterPrompt?: string;
  entityContext?: string;
}): string;

export const EXTRACTOR_STATIC_PREFIX: string;

// ── Batch embedder ──────────────────────────────────────────────

/**
 * Wraps a batch embedding API into a single-text embedder, collecting calls
 * within a time window and sending them as one request.
 */
export function createBatchEmbedder(
  batchFn: (texts: string[]) => Promise<number[][]>,
  opts?: { windowMs?: number; maxBatch?: number }
): EmbedderFn;
