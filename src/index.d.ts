// ── Core Types ─────────────────────────────────────────────

/**
 * A single message in a conversation
 */
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * Extracted facts — flat key:value pairs
 */
export type Facts = Record<string, string>;

/**
 * A single search result from greymemory
 */
export interface SearchResult {
  /** fact key or chunk_N for raw chunks */
  key: string;
  /** the stored value or raw conversation text */
  value: string;
  /** RRF fusion score — higher is more relevant */
  rrf: number;
  /** which search found this result */
  sources: ("bm25" | "vector")[];
  /** whether this came from extracted facts or raw chunks */
  type: "fact" | "chunk";
}

// ── Function Types ─────────────────────────────────────────

/**
 * Extracts facts from a conversation.
 * You provide this — use any LLM you want.
 *
 * @example Anthropic
 * const extractor = async (messages) => {
 *   const res = await anthropic.messages.create({ ... })
 *   return JSON.parse(res.content[0].text)
 * }
 *
 * @example OpenAI
 * const extractor = async (messages) => {
 *   const res = await openai.chat.completions.create({ ... })
 *   return JSON.parse(res.choices[0].message.content)
 * }
 *
 * @example Ollama (local)
 * const extractor = async (messages) => {
 *   const res = await fetch('http://localhost:11434/api/chat', { ... })
 *   return JSON.parse((await res.json()).message.content)
 * }
 */
export type ExtractorFn = (
  messages: Message[]
) => Promise<Facts> | Facts;

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
export type EmbedderFn = (
  text: string
) => Promise<number[]> | number[];

// ── Options ────────────────────────────────────────────────

export interface GreyMemoryOptions {
  /**
   * Function that extracts facts from a conversation.
   * Must return a flat { key: value } object.
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
   * // isolate work and personal memory
   * new GreyMemory({ container: "work", ... })
   * new GreyMemory({ container: "personal", ... })
   */
  container?: string;
}

// ── Main Class ─────────────────────────────────────────────

/**
 * greymemory — private, self-hosted memory for AI agents.
 *
 * @example
 * import GreyMemory from 'greymemory'
 *
 * const memory = new GreyMemory({
 *   extractor: async (messages) => { ... },
 *   embedder:  async (text) => { ... }
 * })
 *
 * await memory.add(messages)
 * const results = await memory.search('what is my name')
 */
export default class GreyMemory {
  constructor(options: GreyMemoryOptions);

  /**
   * Add a conversation to memory.
   * Extracts facts, stores raw chunks, generates embeddings.
   *
   * @example
   * await memory.add([
   *   { role: 'user', content: 'My name is Arun' },
   *   { role: 'assistant', content: 'Got it.' }
   * ])
   */
  add(messages: Message[]): Promise<void>;

  /**
   * Search memory using hybrid BM25 + vector search.
   * Returns facts and raw chunks ranked by relevance.
   *
   * @param query   Natural language search query
   * @param topN    Number of results to return (default: 5)
   *
   * @example
   * const results = await memory.search('what is my name')
   * const results = await memory.search('Priya hiring', 10)
   */
  search(query: string, topN?: number): Promise<SearchResult[]>;

  /**
   * Get all extracted facts for this container.
   *
   * @example
   * const facts = memory.getFacts()
   * // { name: 'Arun', interest: 'powerlifting' }
   */
  getFacts(): Facts;

  /**
   * Clear all memory for this container.
   * Deletes facts, chunks, and embeddings.
   * Other containers are untouched.
   *
   * @example
   * memory.clear()
   */
  clear(): void;
}