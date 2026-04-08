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
 
    // 1. find relevant existing memories for dedup via semantic search
    const inputText   = Array.isArray(input)
      ? input.map(m => m.content).join(' ')
      : input
    const inputVector   = await this.embedder(inputText)
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

    // 4. save raw input as chunks first — get anchor chunk_id for fact provenance
    const messages = Array.isArray(input)
      ? input
      : [{ role: 'document', content: input }];
 
    let anchorChunkId = null;
 
    for (const message of messages) {
      if (!message.content?.trim()) continue;
 
      const chunkContent = Array.isArray(input)
        ? `${message.role}: ${message.content}`
        : message.content;
 
      this.storage.saveChunk(chunkContent);
 
      const chunkId = this.storage.getLastChunkId();
      if (chunkId) {
        // first chunk of this add() call is the session anchor
        if (anchorChunkId === null) anchorChunkId = chunkId;
        const vector = await this.embedder(chunkContent);
        this.storage.saveChunkEmbedding(chunkId, vector);
      }
    }
 
    // 5. process each memory
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
 
      // detect relationship to existing memories before inserting
      // facts and episodes can contradict, extend, or derive from existing memories
      // preferences are always inserted as new — strengthening handled above
      const relationship = (memory_type === 'fact' || memory_type === 'episode')
        ? await this._detectRelationship(mem, embedding)
        : { type: 'NEW', relatedTo: null };
 
      // save fact with all v0.3 columns — returns the inserted row's id
      const factId = this.storage.saveFact(key, value, {
        memory_type,
        document_date:   today,
        event_date,
        expires_at,
        confidence:      1.0,
        relation_type:   relationship.type !== 'NEW' ? relationship.type : null,
        related_to:      relationship.relatedTo,
        superseded_from: relationship.type === 'UPDATES' ? relationship.relatedTo : null,
        chunk_id:        anchorChunkId,
        metadata:        JSON.stringify(context ? { context } : {}),
      });
 
      // if UPDATES — mark old fact as superseded now that we have the new id
      if (relationship.type === 'UPDATES' && relationship.relatedTo) {
        this.storage.supersedeFact(relationship.relatedTo, factId);
      }
 
      // save embedding keyed by fact_id — each version gets its own embedding row
      this.storage.saveEmbedding(factId, embedding);
    }
  }

  // ── Search ─────────────────────────────────────────

  async search(query, options = {}) {
    const {
      topN           = 5,
      memoryTypes    = null,   // ['fact', 'preference', 'episode'] — null means all
      afterDate      = null,   // filter by event_date >= afterDate
      beforeDate     = null,   // filter by event_date <= beforeDate
      includeHistory = false,  // include superseded facts (is_latest=0)
      includeExpired = false,  // include expired episodes
    } = typeof options === 'number' ? { topN: options } : options;
 
    const queryVector = await this.embedder(query);
    const results     = this.storage.hybridSearch(
      query,
      queryVector,
      this.storage.container,
      topN * 3, // fetch more candidates — filters may reduce count
    );
 
    // apply filters
    let filtered = results;
 
    if (memoryTypes) {
      filtered = filtered.filter(r => memoryTypes.includes(r.memory_type));
    }
    if (!includeHistory) {
      filtered = filtered.filter(r => r.is_latest !== 0);
    }
    if (!includeExpired) {
      const now = new Date().toISOString().slice(0, 10);
      filtered = filtered.filter(r => !r.expires_at || r.expires_at > now);
    }
    if (afterDate) {
      filtered = filtered.filter(r => r.event_date && r.event_date >= afterDate);
    }
    if (beforeDate) {
      filtered = filtered.filter(r => r.event_date && r.event_date <= beforeDate);
    }
 
    // pair each fact with its source chunk — Supermemory's dual retrieval pattern
    return filtered.slice(0, topN).map(fact => ({
      memory:        fact.value,
      chunk:         this.storage.getChunk(fact.chunk_id),
      memory_type:   fact.memory_type,
      confidence:    fact.confidence,
      document_date: fact.document_date,
      event_date:    fact.event_date,
      relation_type: fact.relation_type,
    }));
  }

  // ── Get Memories ──────────────────────────────────────
  // returns full row objects [{ key, value, memory_type, confidence, event_date }]
  // richer than v0.2 getFacts() — callers can filter by type, sort by confidence, etc.
  
  getMemories() {
    return this.storage.loadFacts();
  }

  // ── getProfile ─────────────────────────────────────
 
  // returns static/dynamic profile split — injection-ready for system prompts
  // matches Supermemory's profile API shape: { profile: { static: [], dynamic: [] } }
  //
  // static:  preferences (always) + facts older than 7 days
  // dynamic: facts from last 7 days + current episodes
  //
  // optional q — also runs search() and returns results alongside profile
  async getProfile({ q = null, topN = 5 } = {}) {
    const now     = new Date();
    const today   = now.toISOString().slice(0, 10);
    const cutoff  = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
 
    const allFacts = this.storage.loadFacts();
 
    const staticFacts  = [];
    const dynamicFacts = [];
 
    for (const fact of allFacts) {
      // expired episodes — excluded entirely
      if (fact.expires_at && fact.expires_at < today) continue;
 
      if (fact.memory_type === 'preference') {
        // preferences always go to static — behavioral traits don't expire
        staticFacts.push(fact.value);
 
      } else if (fact.memory_type === 'episode') {
        // current episodes go to dynamic
        dynamicFacts.push(fact.value);
 
      } else {
        // facts — split by recency
        if (fact.document_date && fact.document_date > cutoff) {
          dynamicFacts.push(fact.value);
        } else {
          staticFacts.push(fact.value);
        }
      }
    }
 
    const profile = {
      static:  staticFacts,
      dynamic: dynamicFacts,
    };
 
    // optional: profile + search in one call (Supermemory pattern)
    if (q) {
      const results = await this.search(q, { topN });
      return { profile, results };
    }
 
    return { profile };
  }

  // ── forget ─────────────────────────────────────────
 
  // soft delete — expires a fact immediately via semantic search
  // sets expires_at to yesterday so it's excluded from all filters immediately
  // never hard deletes — data is preserved in database for audit
  // returns the value of what was forgotten, or null if nothing found
  async forget(query) {
    const embedding = await this.embedder(query);
    const results   = this.storage.vectorSearch(embedding, this.storage.container, 1);
 
    if (!results[0]) return null;
 
    // set to yesterday — expires_at < today means immediately excluded
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
 
    this.storage.db.prepare(`
      UPDATE facts SET expires_at = ? WHERE id = ?
    `).run(yesterday, results[0].id);
 
    return results[0].value;
  }

  // ── getCurrent ─────────────────────────────────────
 
  // returns the current (is_latest=1) version of a fact
  // always uses semantic search — keys are internal, not public API
  // use natural language: getCurrent('where does Alex work')
  async getCurrent(query) {
    const embedding = await this.embedder(query);
    const results   = this.storage.vectorSearch(embedding, this.storage.container, 1);
    return results[0] ?? null;
  }
 
  // ── getHistory ─────────────────────────────────────
 
  // returns full version chain for a fact, newest → oldest
  // always uses semantic search to find starting point — keys are internal
  // walks backward via superseded_from regardless of key differences
  // use natural language: getHistory('what jobs has Alex had')
  async getHistory(query) {
    // 1. find current version via semantic search
    const embedding = await this.embedder(query);
    const results   = this.storage.vectorSearch(embedding, this.storage.container, 1);
 
    if (!results[0]) return [];
 
    // fetch full row — vectorSearch returns simplified shape without superseded_from
    let current = this.storage.db.prepare(`
      SELECT * FROM facts WHERE id = ?
    `).get(results[0].id);
 
    if (!current) return [];
 
    // 2. walk backward via superseded_from to build full chain
    const chain = [current];
    let node = current;
 
    while (node.superseded_from) {
      node = this.storage.db.prepare(`
        SELECT * FROM facts WHERE id = ?
      `).get(node.superseded_from);
      if (!node) break;
      chain.push(node);
    }
 
    // 3. reverse to return oldest → newest
    return chain.map(f => ({
      id:            f.id,
      key:           f.key,
      value:         f.value,
      memory_type:   f.memory_type,
      document_date: f.document_date,
      event_date:    f.event_date,
      is_latest:     f.is_latest === 1,
      superseded_by: f.superseded_by,
      relation_type: f.relation_type,
    }));
  }

  // ── runDerivations ─────────────────────────────────
 
  // infers second-order conclusions by combining recent memories with similar existing ones
  // call manually after add(), on a schedule, or before important queries
  // never called inside add() — derivation is a separate concern from ingestion
  //
  // options:
  //   sinceDays: look at facts added in last N days (default 7)
  //   topK:      number of similar facts to combine with each recent fact (default 10)
  async runDerivations({ sinceDays = 7, topK = 10 } = {}) {
    // get recently added facts — focused window, not entire memory graph
    const recentFacts = this.storage.db.prepare(`
      SELECT id, key, value, memory_type, document_date
      FROM facts
      WHERE container = ?
        AND memory_type = 'fact'
        AND is_latest = 1
        AND relation_type != 'DERIVES'
        AND (expires_at IS NULL OR expires_at > datetime('now'))
        AND document_date >= date('now', '-' || ? || ' days')
      ORDER BY created_at DESC
      LIMIT 20
    `).all(this.storage.container, sinceDays);
 
    if (recentFacts.length === 0) return [];
 
    const derived = [];
 
    for (const recentFact of recentFacts) {
      // find top K semantically similar existing facts — focused candidates
      const embedding  = await this.embedder(recentFact.value);
      const candidates = this.storage.vectorSearch(embedding, this.storage.container, topK)
        .filter(f => f.id !== recentFact.id && f.memory_type === 'fact');
 
      if (candidates.length === 0) continue;
 
      // small focused prompt — one recent fact + top K candidates
      const prompt = `You are a memory inference engine.
 
New memory: [ID:${recentFact.id}] "${recentFact.value}"
 
Related existing memories:
${candidates.map((f, i) => `${i + 1}. [ID:${f.id}] "${f.value}"`).join('\n')}
 
Can you infer a NEW factual conclusion by combining the new memory with one or more related memories?
 
Rules:
- The conclusion must NOT be explicitly stated in any memory above
- It must be a confident logical inference, not speculation
- If no confident inference is possible, return null
 
Example:
  "Alex is a PM at Stripe" + "Stripe is a payments company"
  → "Alex likely works on payments products"
 
Return ONLY valid JSON, no explanation:
{"derives": "the inferred conclusion as a complete sentence", "fromIds": [id1, id2]}
or null if no confident inference exists.`;
 
      try {
        const raw  = await this.extractor(prompt);
        const text = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
 
        if (text === 'null' || !text) continue;
 
        const result = JSON.parse(text);
 
        if (!result?.derives || !Array.isArray(result.fromIds) || result.fromIds.length < 2) continue;
 
        // validate fromIds point to real facts
        const allFacts = [recentFact, ...candidates];
        const validIds = result.fromIds.filter(id => allFacts.find(f => f.id === id));
        if (validIds.length < 2) continue;
 
        // check this inference doesn't already exist
        const deriveEmbedding = await this.embedder(result.derives);
        const existing        = this.storage.vectorSearch(deriveEmbedding, this.storage.container, 1);
        if (existing[0]?.score > 0.95) continue;
 
        // save the derived fact
        const today  = new Date().toISOString().slice(0, 10);
        const key    = `derived_${Date.now()}`;
        const factId = this.storage.saveFact(key, result.derives, {
          memory_type:   'fact',
          document_date: today,
          relation_type: 'DERIVES',
          related_to:    validIds[0], // primary source — v0.4 stores all via fact_relations
          confidence:    0.8,         // inferred facts start lower than stated facts
          metadata:      JSON.stringify({ fromIds: validIds }),
        });
 
        this.storage.saveEmbedding(factId, deriveEmbedding);
        derived.push({ id: factId, value: result.derives, fromIds: validIds });
 
      } catch {
        continue; // never block on derivation errors
      }
    }
 
    return derived;
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
      JOIN embeddings e ON e.fact_id = f.id
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

  // detect relationship between a new memory and existing ones
  // step 1: find candidates via same-key lookup + vector similarity
  // step 2: LLM classifies the relationship
  // returns { type: 'UPDATES'|'EXTENDS'|'DERIVES'|'NEW', relatedTo: id|null }
  async _detectRelationship(mem, embedding) {
    const { key, value, memory_type, document_date, event_date } = mem;
    const today = new Date().toISOString().slice(0, 10);
 
    // step 1a — same key facts (strong signal regardless of embedding similarity)
    const sameKeyFacts = this.storage.db.prepare(`
      SELECT id, key, value, memory_type, document_date, event_date
      FROM facts
      WHERE key = ? AND container = ? AND is_latest = 1
        AND (expires_at IS NULL OR expires_at > datetime('now'))
    `).all(key, this.storage.container);
 
    // step 1b — semantically similar facts via vector search
    const similarFacts = this.storage.vectorSearch(embedding, this.storage.container, 5);
 
    // step 1c — combine and dedup by id
    const seen = new Set();
    const candidates = [];
    for (const f of [...sameKeyFacts, ...similarFacts]) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        candidates.push(f);
      }
    }
 
    // no candidates — this is a brand new memory
    if (candidates.length === 0) return { type: 'NEW', relatedTo: null };
 
    // step 2 — LLM classifies the relationship
    const prompt = `You are a memory relationship classifier.
 
New memory: "${value}" [${memory_type}] [recorded: ${document_date ?? today}]${event_date ? ` [event: ${event_date}]` : ''}
 
Existing memories:
${candidates.map((f, i) => `${i + 1}. [ID:${f.id}] "${f.value}" [${f.memory_type}] [recorded: ${f.document_date ?? 'unknown'}]${f.event_date ? ` [event: ${f.event_date}]` : ''}`).join('\n')}
 
Classify the relationship between the new memory and the MOST RELEVANT existing memory.
Priority order: UPDATES > EXTENDS > NEW
 
UPDATES — new memory contradicts and replaces an existing one:
  CRITICAL: These attributes are SINGULAR — a person can only have ONE value at a time.
  When the value changes, it is ALWAYS UPDATES, never EXTENDS:
  - Employer:  "works at Stripe" UPDATES "works at Google"
  - Location:  "lives in Mumbai" UPDATES "lives in Bangalore"
  - Role/Title: "is a PM" UPDATES "is a software engineer"
  - Relationship status, education, any other singular attribute
 
  Even if the wording is different, if it describes the SAME attribute with a DIFFERENT value → UPDATES.
  "Alex recently joined Stripe as PM" UPDATES "Alex works at Google as engineer"
 
EXTENDS — new memory adds detail WITHOUT replacing an existing one:
  - "Alex is a PM at Stripe focusing on payments" EXTENDS "Alex is a PM at Stripe"
  - "Alex lives in Koramangala, Bangalore" EXTENDS "Alex lives in Bangalore"
  Only use EXTENDS if the existing memory is still 100% true after the new one is added.
 
NEW — no meaningful relationship to any existing memory.
 
Return ONLY valid JSON, no explanation:
{"type": "UPDATES|EXTENDS|NEW", "relatedTo": <id of most related existing memory, or null if NEW>}`;
 
    try {
      const raw    = await this.extractor(prompt);
      const text   = raw.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const result = JSON.parse(text);
 
      // validate — ensure relatedTo points to a real candidate
      const validId = candidates.find(c => c.id === result.relatedTo)?.id ?? null;
 
      return {
        type:      ['UPDATES', 'EXTENDS', 'NEW'].includes(result.type) ? result.type : 'NEW',
        relatedTo: result.type !== 'NEW' ? validId : null,
      };
    } catch {
      // if LLM fails or returns invalid JSON — treat as NEW, never block ingestion
      return { type: 'NEW', relatedTo: null };
    }
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