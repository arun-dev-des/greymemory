import { Storage } from "./storage.js";
import { buildExtractorPrompt } from "./prompts.js";

export class Memory {
  constructor(options = {}) {
    if (typeof options.extractor !== "function") {
      throw new Error(
        "GreyMemory requires an extractor function.\n" +
        "Example:\n" +
        "  new GreyMemory({\n" +
        "    extractor: async (prompt) => '...'\n" +
        "  })"
      );
    }
 
    if (typeof options.embedder !== "function") {
      throw new Error(
        "GreyMemory requires an embedder function.\n" +
        "Example:\n" +
        "  new GreyMemory({\n" +
        "    embedder: async (text) => [0.1, 0.2, 0.3]\n" +
        "  })"
      );
    }

    this.extractor     = options.extractor;
    this.embedder      = options.embedder;
    this.filterPrompt  = options.filterPrompt  ?? '';   // v0.3
    this.entityContext = options.entityContext ?? '';   // v0.3
    this.storage       = new Storage(
      options.dir       ?? ".greymemory",
      options.container ?? "default",
      options.db        ?? null
    );
  }

  // ── Add ────────────────────────────────────────────
 
  async add(input) {
    const today = new Date().toISOString().slice(0, 10);
 
    // 1. load existing facts for dedup — already filtered by is_latest + expires_at
    // loadFacts() returns [{ key, value, memory_type, confidence, event_date }]
    // embed the input to find relevant existing memories
    const inputText   = Array.isArray(input)
      ? input.map(m => m.content).join(' ')
      : input
    const inputVector   = await this.embedder(inputText)
    // only pass facts and episodes — not preferences
    // preferences are handled by _strengthenPreference separately
    const existingFacts = this.storage.vectorSearch(inputVector, this.storage.container, 10)
      .filter(f => f.memory_type !== 'preference')
 
    // 2. build prompt — single string with everything the LLM needs
    const prompt = buildExtractorPrompt({
      input,
      existingFacts,
      today,
      filterPrompt:  this.filterPrompt,
      entityContext: this.entityContext,
    });
 
    // 3. call extractor — returns raw string
    const raw      = await this.extractor(prompt);
    const memories = this._parseExtraction(raw);
 
    if (memories.length === 0) return;
 
    // 4. process each memory
    for (const mem of memories) {
      const {
        key,
        value,
        memory_type = 'fact',
        event_date  = null,
        expires_at  = null,
        context     = null,
      } = mem;
 
      if (!key || !value) continue;
 
      // embed value only — not `${key}: ${value}`, key adds noise
      const embedding = await this.embedder(value);
 
      // preferences — use cosine similarity to find existing ones, not key match
      // LLMs are not deterministic so the key will vary across calls
      if (memory_type === 'preference') {
        const strengthened = this._strengthenPreference(key, value, embedding);
        if (strengthened) continue;
      }
 
      // save fact with all v0.3 columns
      this.storage.saveFact(key, value, {
        memory_type,
        document_date: today,
        event_date,
        expires_at,
        confidence: 1.0,
        metadata: JSON.stringify(context ? { context } : {}),
      });
 
      // save embedding keyed by fact_key
      // Week 2 will migrate this to fact_id once UNIQUE constraint is removed
      this.storage.saveEmbeddings({ [key]: embedding });
    }
 
    // 5. save raw input as chunks with embeddings
    const messages = Array.isArray(input)
      ? input
      : [{ role: 'document', content: input }];
 
    for (const message of messages) {
      if (!message.content?.trim()) continue;
 
      const chunkContent = Array.isArray(input)
        ? `${message.role}: ${message.content}`
        : message.content;
 
      this.storage.saveChunk(chunkContent);
 
      const chunkId = this.storage.getLastChunkId();
      if (chunkId) {
        const vector = await this.embedder(chunkContent);
        this.storage.saveChunkEmbedding(chunkId, vector);
      }
    }
  }

  // ── Search ─────────────────────────────────────────

  async search(query, topN = 5) {
    const queryVector = await this.embedder(query);
    return this.storage.hybridSearch(
      query,
      queryVector,
      this.storage.container,
      topN
    );
  }

  // ── Get Memories ──────────────────────────────────────
  // returns full row objects [{ key, value, memory_type, confidence, event_date }]
  // richer than v0.2 getFacts() — callers can filter by type, sort by confidence, etc.
  
  getMemories() {
    return this.storage.loadFacts();
  }

  // ── Clear ──────────────────────────────────────────

  clear() {
    this.storage.clear();
  }

  // ── Private ────────────────────────────────────────
 
  // use cosine similarity to find an existing preference with similar meaning
  // key matching is unreliable — LLMs produce different keys for the same preference
  _strengthenPreference(key, value, embedding) {
    const existing = this.storage.db.prepare(`
      SELECT f.id, f.key, f.confidence, e.vector
      FROM facts f
      JOIN embeddings e ON e.fact_key = f.key AND e.container = f.container
      WHERE f.container = ?
        AND f.memory_type = 'preference'
        AND f.is_latest = 1
        AND (f.expires_at IS NULL OR f.expires_at > datetime('now'))
    `).all(this.storage.container);
 
    const THRESHOLD = 0.92;
 
    // 1. try exact key match first — cheap, no vector math
    const keyMatch = existing.find(row => row.key === key);
    if (keyMatch) {
      this.storage.db.prepare(`
        UPDATE facts SET confidence = MIN(confidence + 0.1, 2.0) WHERE id = ?
      `).run(keyMatch.id);
      return true;
    }
 
    // 2. cosine similarity — strengthen ALL matches above threshold
    // multiple preferences can mean the same thing with different wording
    const matches = existing
      .map(row => ({
        ...row,
        similarity: this._cosineSimilarity(embedding, JSON.parse(row.vector))
      }))
      .filter(row => row.similarity > THRESHOLD);
 
    if (matches.length === 0) return false;
 
    const update = this.storage.db.prepare(`
      UPDATE facts SET confidence = MIN(confidence + 0.1, 2.0) WHERE id = ?
    `);
 
    for (const match of matches) {
      update.run(match.id);
    }
 
    return true;
  }
 
  // parse raw extractor string → array of memory objects
  // handles accidental markdown fences, invalid JSON, object instead of array
  _parseExtraction(raw) {
    const text = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/```\s*$/, '')
      .trim();
 
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      console.warn('[greymemory] extractor returned invalid JSON:', text.slice(0, 200));
      return [];
    }
  }
 
  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    const dot  = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
    if (magA === 0 || magB === 0) return 0;
    return dot / (magA * magB);
  }

}