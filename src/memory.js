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
    this.filterPrompt        = options.filterPrompt       ?? '';
    this.entityContext       = options.entityContext       ?? '';
    this.contextualRetrieval = options.contextualRetrieval ?? false;
    this.storage       = new Storage(
      options.dir       ?? ".greymemory",
      options.container ?? "default",
      options.db        ?? null
    );
  }

  // ── Add ────────────────────────────────────────────
 
  async add(input, opts = {}) {
    const documentDate  = this._normalizeDate(opts.date) ?? new Date().toISOString().slice(0, 10);
    const entityContext = opts.entityContext ?? this.entityContext;

    // 1. Normalize input into messages array
    const messages = Array.isArray(input)
      ? input
      : [{ role: 'document', content: input }]

    const fullConversation = messages.map(m => `${m.role}: ${m.content}`).join('\n')

    // 2. ALWAYS save chunks first — they are the raw record, independent of extraction
    let anchorChunkId = null
    const messageIndexToChunkId = {}
    const messageIndexToRole = {}

    for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
      const message = messages[messageIndex]
      if (!message.content?.trim()) continue
      messageIndexToRole[messageIndex] = message.role  // 'user' or 'assistant'

      const rawChunk = Array.isArray(input)
        ? `${message.role}: ${message.content}`
        : message.content

      const chunkContent = this.contextualRetrieval
        ? await this._contextualizeChunk(rawChunk, fullConversation)
        : rawChunk

      this.storage.saveChunk(chunkContent, null, message.role, documentDate)
      const chunkId = this.storage.getLastChunkId()

      if (chunkId) {
        if (anchorChunkId === null) anchorChunkId = chunkId
        messageIndexToChunkId[messageIndex] = chunkId
        const vector = await this.embedder(chunkContent)
        this.storage.saveChunkEmbedding(chunkId, vector)
      }
    }

    // 3. Now run extraction — if it returns empty, chunks are already safe
    const inputText   = Array.isArray(input) ? input.map(m => m.content).join(' ') : input
    const inputVector = await this.embedder(inputText)

    //Todo: Why not Dedup by bm25search as well?
    const existingFacts = this.storage.vectorSearch(inputVector, this.storage.container, 10, documentDate)
      .filter(f => f.memory_type !== 'preference')

    const prompt   = buildExtractorPrompt({ input, existingFacts, documentDate, filterPrompt: this.filterPrompt, entityContext })
    const raw      = await this.extractor(prompt)
    const memories = this._parseExtraction(raw)

    if (memories.length === 0) {
      const inputPreview = (Array.isArray(input)
        ? input.map(m => m.content).join(' ')
        : input
      ).slice(0, 300)
      console.warn(`[greymemory] empty extraction, skipping fact save. preview: ${inputPreview}`)
      return { chunksStored: Object.keys(messageIndexToChunkId).length, factsStored: 0 }
    }

    // 4. Save facts (existing logic, unchanged)
    const savedThisBatch = []
    const DEDUP_THRESHOLD = 0.92

    for (const mem of memories) {
      const {
        key,
        value,
        memory_type          = 'fact',
        event_date           = null,
        expires_at           = null,
        context              = null,
        source_message_index = null,
      } = mem

      if (!key || !value) continue

      // derive source_role from message index — deterministic, no LLM needed
      const source_role = (
        Number.isInteger(source_message_index) &&
        messageIndexToRole[source_message_index] != null
      )
        ? messageIndexToRole[source_message_index]
        : null

      const resolvedChunkId = (
        Number.isInteger(source_message_index) &&
        messageIndexToChunkId[source_message_index] != null
      )
        ? messageIndexToChunkId[source_message_index]
        : anchorChunkId

      const embedding = await this.embedder(value)

      const isDuplicate = savedThisBatch.some(
        saved => this._cosineSimilarity(embedding, saved) > DEDUP_THRESHOLD
      )
      if (isDuplicate) continue

      if (memory_type === 'preference') {
        const strengthened = this._strengthenPreference(mem.key, mem.value, embedding, documentDate)
        if (strengthened) continue
      }

      const relationship = (memory_type === 'fact' || memory_type === 'episode')
        ? await this._detectRelationship(mem, embedding, documentDate)
        : { type: 'NEW', relatedTo: null }

      const factId = this.storage.saveFact(key, value, {
        memory_type,
        document_date:   documentDate,
        event_date,
        expires_at,
        confidence:      1.0,
        relation_type:   relationship.type !== 'NEW' ? relationship.type : null,
        related_to:      relationship.relatedTo,
        superseded_from: relationship.type === 'UPDATES' ? relationship.relatedTo : null,
        chunk_id:        resolvedChunkId,
        source_role,
        metadata:        JSON.stringify(context ? { context } : {}),
      })

      if (relationship.type === 'UPDATES' && relationship.relatedTo) {
        this.storage.supersedeFact(relationship.relatedTo, factId)
      }

      this.storage.saveEmbedding(factId, embedding)
      savedThisBatch.push(embedding)
    }

    const { profile } = await this.getProfile({ asOf: documentDate })
    const known = [...profile.static, ...profile.dynamic].slice(0, 20)
    if (known.length > 0) {
      this.entityContext = `Prior context: ${known.join('. ')}.`
    }

    return { chunksStored: Object.keys(messageIndexToChunkId).length, factsStored: savedThisBatch.length }
  }

  // ── Search ─────────────────────────────────────────
  async search(query, options = {}) {
    const {
      topN           = 5,
      memoryTypes    = null,      // e.g. ['fact', 'preference'] or null for all
      afterDate      = null,      // filter: only facts with event_date >= this
      beforeDate     = null,      // filter: only facts with event_date <= this
      includeHistory = false,     // if true, include superseded (is_latest=0) facts
      includeExpired = false,     // if true, include facts past their expires_at
      asOf           = null,      // time-travel: pretend it's this date
      expandViaGraph = true,      // master toggle for graph expansion
      expandedLimit  = 10,        // max additional facts from graph traversal
      expandDepth    = 5,         // max EXTENDS hops to walk
    } = typeof options === 'number' ? { topN: options } : options;

    // ── normalize asOf ──
    let asOfNorm = null;
    if (asOf) {
      const normalized = this._normalizeDate(asOf) ?? asOf;
      asOfNorm = normalized.includes('T') ? normalized : `${normalized}T23:59:59`;
    }

    // ── core retrieval ──
    const queryVector = await this.embedder(query);
    const rawResults  = this.storage.hybridSearch(
      query,           // raw text for BM25
      queryVector,     // embedding for vector search
      this.storage.container,  // e.g. "852ce960"
      topN * 3,        // overfetch factor: 30 candidates for topN=10
      asOfNorm,        // temporal cutoff
    );

    // ── apply filters (unchanged) ──
    let filtered = rawResults;

    if (memoryTypes) {
      filtered = filtered.filter(r => r._type === 'chunk' || memoryTypes.includes(r.memory_type));
    }
    if (!includeHistory && !asOfNorm) {
      filtered = filtered.filter(r => r._type === 'chunk' || r.is_latest !== 0);
    }
    if (!includeExpired) {
      const expiryCutoff = asOfNorm ? asOfNorm.slice(0, 10) : new Date().toISOString().slice(0, 10);
      filtered = filtered.filter(r => r._type === 'chunk' || !r.expires_at || r.expires_at > expiryCutoff);
    }
    if (afterDate) {
      filtered = filtered.filter(r => r._type === 'chunk' || (r.event_date && r.event_date >= afterDate));
    }
    if (beforeDate) {
      filtered = filtered.filter(r => r._type === 'chunk' || (r.event_date && r.event_date <= beforeDate));
    }

    // ── slice seed budget (new boundary) ──
    // Seeds are the topN best matches by RRF score from core retrieval.
    // Expansion pulls in additional context but does not compete for these slots.
    const seedResults = filtered.slice(0, topN);

    // ── graph expansion (UPDATED) ──
    let expanded = []
    let history  = []

    if (expandViaGraph && expandedLimit > 0) {
      const seedFacts = seedResults.filter(r => r._type !== 'chunk' && r.id)

      if (seedFacts.length > 0) {
        // Forward semantic traversal: facts connected via EXTENDS chains
        const rawExpanded = await this._expandViaExtends(seedFacts, {
          maxDepth:   expandDepth,
          maxResults: expandedLimit,
          asOfNorm,
        })
        expanded = rawExpanded.filter(({ fact }) => {
          if (memoryTypes && !memoryTypes.includes(fact.memory_type)) return false
          if (afterDate  && (!fact.event_date || fact.event_date <  afterDate))  return false
          if (beforeDate && (!fact.event_date || fact.event_date >  beforeDate)) return false
          return true
        })

        // Backward temporal traversal: predecessors via superseded_from chain.
        // Skipped when caller explicitly excluded history (includeHistory: false
        // is the default; setting it to true means they want full version chains
        // surfaced, but our backward walk should run regardless of that flag —
        // the question is whether the caller said "give me ONLY current state").
        //
        // Decision: walk history whenever expandViaGraph is true. Callers who
        // truly want only current state can set expandViaGraph: false to opt
        // out of all expansion mechanisms.
        const rawHistory = await this._expandViaSupersessionHistory(seedFacts, {
          maxResults: 5,
        })
        history = rawHistory.filter(({ fact }) => {
          if (memoryTypes && !memoryTypes.includes(fact.memory_type)) return false
          if (afterDate  && (!fact.event_date || fact.event_date <  afterDate))  return false
          if (beforeDate && (!fact.event_date || fact.event_date >  beforeDate)) return false
          // is_latest filter NOT applied — history facts are by definition is_latest=0
          // asOf filter NOT applied — we want history relative to the seed, not asOf
          return true
        })
      }
    }

    // ── shape and return ──
    const seedShaped = seedResults.map(result => {
      if (result._type === 'chunk') {
        return {
          memory:        null,
          chunk:         result.content,
          memory_type:   null,
          confidence:    null,
          document_date: result.created_at?.slice(0, 10) ?? null,
          event_date:    null,
          relation_type: null,
          source_role:   result.source_role ?? null,
        }
      }
      return this._factToResult(result)
    })

    const expandedShaped = expanded.map(({ fact, _expansion }) =>
      this._factToResult(fact, _expansion)
    )

    const historyShaped = history.map(({ fact, _expansion }) =>
      this._factToResult(fact, _expansion)
    )

    // Order: seeds (best matches) → semantic expansion → temporal history.
    // This ordering mirrors confidence: highest-relevance first, then context,
    // then version chain. The answerer reads top-down.
    return [...seedShaped, ...expandedShaped, ...historyShaped]
  }

  // ── Get Memories ──────────────────────────────────────
  // returns full row objects [{ key, value, memory_type, confidence, event_date }]
  // richer than v0.2 getFacts() — callers can filter by type, sort by confidence, etc.
  
  getMemories() {
    return this.storage.loadFacts();
  }

  // ── getFacts — v0.2.x backward compatibility alias ─────────
  getFacts() {
    return this.getMemories();
  }

  // ── getProfile ─────────────────────────────────────
 
  // returns static/dynamic profile split — injection-ready for system prompts
  // matches Supermemory's profile API shape: { profile: { static: [], dynamic: [] } }
  //
  // static:  preferences (always) + facts older than 7 days
  // dynamic: facts from last 7 days + current episodes
  //
  // optional q — also runs search() and returns results alongside profile
  async getProfile({ q = null, topN = 5, asOf = null } = {}) {
    // use asOf if provided — critical for historical session ingestion
    // ensures episode expiry and static/dynamic split are relative to session date, not today
    const referenceDate = asOf
      ? (this._normalizeDate(asOf) ?? new Date().toISOString().slice(0, 10))
      : new Date().toISOString().slice(0, 10)

    const cutoff = new Date(new Date(referenceDate) - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10)

    const allFacts = this.storage.loadFacts(referenceDate);

    const staticFacts  = [];
    const dynamicFacts = [];

    for (const fact of allFacts) {
      // expired episodes — excluded relative to referenceDate, not today
      if (fact.expires_at && fact.expires_at < referenceDate) continue;

      if (fact.memory_type === 'preference') {
        staticFacts.push(fact.value);

      } else if (fact.memory_type === 'episode') {
        dynamicFacts.push(fact.value);

      } else {
        // facts — split by recency relative to referenceDate
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
 
  // returns top 3 semantic matches, each with their full version chain
  // newest first within each chain — current version at index 0
  // let the answering prompt reason about which chain is relevant
  async getHistory(query, topN = 3) {
    const embedding = await this.embedder(query);
    const results   = this.storage.vectorSearch(embedding, this.storage.container, topN);
 
    if (!results.length) return [];
 
    const chains = [];
 
    for (const result of results) {
      // fetch full row — vectorSearch returns simplified shape without superseded_from
      let current = this.storage.db.prepare(`
        SELECT * FROM facts WHERE id = ?
      `).get(result.id);
 
      if (!current) continue;
 
      // walk backward via superseded_from to build full chain
      const chain = [current];
      let node = current;
 
      while (node.superseded_from) {
        node = this.storage.db.prepare(`
          SELECT * FROM facts WHERE id = ?
        `).get(node.superseded_from);
        if (!node) break;
        chain.push(node);
      }
 
      chains.push({
        current: chain[0].value,
        chain: chain.map(f => ({
          id:            f.id,
          key:           f.key,
          value:         f.value,
          memory_type:   f.memory_type,
          document_date: f.document_date,
          event_date:    f.event_date,
          is_latest:     f.is_latest === 1,
          superseded_by: f.superseded_by,
          relation_type: f.relation_type,
        }))
      });
    }
 
    return chains;
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
  // use most recent document_date as reference — works correctly for historical ingestion
  // prevents date('now') from excluding all facts when sessions are in the past
  const latestRow = this.storage.db.prepare(`
    SELECT MAX(document_date) as latest FROM facts
    WHERE container = ? AND is_latest = 1
  `).get(this.storage.container)

  const referenceDate = latestRow?.latest ?? new Date().toISOString().slice(0, 10)

  const recentFacts = this.storage.db.prepare(`
    SELECT id, key, value, memory_type, document_date
    FROM facts
    WHERE container = ?
      AND memory_type = 'fact'
      AND is_latest = 1
      AND relation_type != 'DERIVES'
      AND (expires_at IS NULL OR expires_at > ?)
      AND document_date >= date(?, '-' || ? || ' days')
    ORDER BY created_at DESC
    LIMIT 20
  `).all(this.storage.container, referenceDate, referenceDate, sinceDays);

  if (recentFacts.length === 0) return [];

  const derived = [];

  for (const recentFact of recentFacts) {
    // find top K semantically similar existing facts — anchored to referenceDate
    const embedding  = await this.embedder(recentFact.value);
    const candidates = this.storage.vectorSearch(embedding, this.storage.container, topK, referenceDate)
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

      // check this inference doesn't already exist — anchored to referenceDate
      const deriveEmbedding = await this.embedder(result.derives);
      const allCurrent      = this.storage.db.prepare(`
        SELECT id, value FROM facts
        WHERE container = ? AND is_latest = 1
          AND (expires_at IS NULL OR expires_at > ?)
      `).all(this.storage.container, referenceDate);

      const tooSimilar = allCurrent.some(f => {
        const vec = this.storage.db.prepare(
          `SELECT vector FROM embeddings WHERE fact_id = ? LIMIT 1`
        ).get(f.id);
        if (!vec) return false;
        return this._cosineSimilarity(deriveEmbedding, JSON.parse(vec.vector)) > 0.88;
      });

      if (tooSimilar) continue;

      // save derived fact — use referenceDate not today
      const key    = `derived_${Date.now()}`;
      const factId = this.storage.saveFact(key, result.derives, {
        memory_type:   'fact',
        document_date: referenceDate,
        relation_type: 'DERIVES',
        related_to:    validIds[0],
        confidence:    0.8,
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
  
  // contextualizes a chunk using the full conversation as context
  // Anthropic's Contextual Retrieval technique — prepend context before embedding + BM25 indexing
  // makes retrieval accurate months later — no vague pronouns or references in the index
  // one LLM call per chunk — only runs if contextualRetrieval: true
  async _contextualizeChunk(chunk, fullConversation) {
    const prompt = `<conversation>
${fullConversation}
</conversation>
Here is the message we want to situate within the whole conversation:
<chunk>
${chunk}
</chunk>
Give a short succinct context (1-2 sentences) to situate this message within the overall conversation for improving search retrieval. Resolve all pronouns and vague references to specific names and places. Answer only with the context and nothing else.`;
 
    try {
      const context = await this.extractor(prompt);
      // prepend context to chunk — both are stored, embedded, and BM25 indexed together
      return `${context.trim()}\n${chunk}`;
    } catch {
      // if contextualization fails — fall back to raw chunk, never block ingestion
      return chunk;
    }
  }

  // Walks the superseded_by chain from a stale fact to its current latest version.
  // Returns the latest fact row, or null if the chain is broken or non-terminating.
  // Three exit conditions:
  //   1. We reached a fact with is_latest=1 — return it
  //   2. We hit a dangling pointer (superseded_by points to deleted fact) — return null
  //   3. We exceeded 20 hops (defensive cycle guard) — return null
  _walkSupersession(factId) {
    let current = this.storage.db.prepare(
      `SELECT * FROM facts WHERE id = ?`
    ).get(factId)

    if (!current) return null

    let hops = 0
    while (current && current.is_latest === 0 && current.superseded_by) {
      if (++hops > 20) return null  // cycle guard

      const next = this.storage.db.prepare(
        `SELECT * FROM facts WHERE id = ?`
      ).get(current.superseded_by)

      if (!next) return null  // dangling pointer
      current = next
    }

    return current?.is_latest === 1 ? current : null
  }

  // Shapes a raw `facts` table row into the public search result format.
  // Optionally attaches expansion metadata when the fact came from graph traversal
  // rather than core retrieval.
  //
  // Result shape mirrors what search() currently returns for fact results,
  // with one addition: the optional `_expansion` field on traversed facts.
  _factToResult(fact, expansion = null) {
    const result = {
      memory:        fact.value,
      chunk:         this.storage.getChunk(fact.chunk_id),
      memory_type:   fact.memory_type,
      confidence:    fact.confidence,
      document_date: fact.document_date,
      event_date:    fact.event_date,
      relation_type: fact.relation_type,
      source_role:   fact.source_role,
    }

    if (expansion) result._expansion = expansion

    return result
  }

  // Walks EXTENDS edges from seed facts in both directions (outgoing and incoming).
  // Bidirectional because EXTENDS is a directed edge but conceptually a chain has
  // no "preferred" direction — refinements above and below the seed are both relevant.
  //
  // For each fact discovered:
  //   - If it's the latest version (is_latest=1), include it directly
  //   - If it's been superseded (is_latest=0), resolve to the latest version,
  //     annotate with `supersededFrom`, and walk further from the LATEST not the stale one
  //   - Apply asOf and expiry filters (consistent with core search behavior)
  //
  // Returns: [{ fact, _expansion: { via, depth, seedId, supersededFrom } }, ...]
  async _expandViaExtends(seedFacts, { maxDepth = 5, maxResults = 10, asOfNorm = null } = {}) {
    const seedIds = seedFacts.filter(f => f.id).map(f => f.id)
    if (seedIds.length === 0) return []

    // `seen` tracks every fact id we've already processed (seed or expanded) — prevents
    // revisiting and prevents the expanded set from including seeds.
    const seen = new Set(seedIds)

    // Frontier: the set of fact ids whose neighbors we'll explore in the next iteration.
    // Starts with seeds; each iteration replaces it with the newly-discovered ids.
    let frontier = [...seedIds]

    // Provenance tracking: for each discovered fact, which seed brought it in?
    // Useful for debugging and for the answerer to weight results by seed proximity.
    const seedIdByFact = new Map()
    for (const id of seedIds) seedIdByFact.set(id, id)

    // Pre-compute expiry cutoff once — used to filter expired episodes consistently
    // with the rest of the codebase's expiry semantics.
    const expiryCutoff = asOfNorm
      ? asOfNorm.slice(0, 10)
      : new Date().toISOString().slice(0, 10)

    const collected = []

    for (let depth = 1; depth <= maxDepth && frontier.length > 0 && collected.length < maxResults; depth++) {
      const placeholders = frontier.map(() => '?').join(',')

      // Find all EXTENDS neighbors of the current frontier — both directions in one query.
      //
      //   Outgoing: facts in frontier extend X → return X
      //     "the seed extends fact A" → fetch A
      //
      //   Incoming: X extends facts in frontier → return X
      //     "fact B extends the seed" → fetch B
      //
      // We fetch all columns because we need the full row to apply filters
      // (is_latest, expires_at, document_date) and to attach as result.
      const neighbors = this.storage.db.prepare(`
        SELECT DISTINCT f.* FROM facts f
        WHERE f.container = ?
          AND (
            -- outgoing: the thing frontier extends
            f.id IN (
              SELECT related_to FROM facts
              WHERE id IN (${placeholders})
                AND relation_type = 'EXTENDS'
                AND related_to IS NOT NULL
            )
            OR
            -- incoming: the thing that extends frontier
            (f.related_to IN (${placeholders}) AND f.relation_type = 'EXTENDS')
          )
      `).all(this.storage.container, ...frontier, ...frontier)

      const nextFrontier = []

      for (const neighbor of neighbors) {
        // Skip if we've already processed this fact in any earlier iteration
        // (or if it's a seed). Prevents duplicates and prevents cycles.
        if (seen.has(neighbor.id)) continue
        seen.add(neighbor.id)

        // Resolve to the latest version if this neighbor was superseded.
        // We want to surface the CURRENT truth, not a stale ancestor.
        let resolved = neighbor
        let supersededFrom = null

        if (neighbor.is_latest === 0) {
          const latest = this._walkSupersession(neighbor.id)
          if (!latest) continue              // chain broken or fully forgotten

          // The latest version might already be a seed or already collected.
          // If so, we don't add it again — but we DO want to record that we
          // walked through this stale neighbor (no-op for now since we skip).
          if (seen.has(latest.id)) continue

          seen.add(latest.id)
          resolved = latest
          supersededFrom = { id: neighbor.id, value: neighbor.value }
        }

        // asOf time-travel: skip facts recorded after the asOf timestamp.
        // Keeps expansion consistent with the core search's temporal cutoff.
        if (asOfNorm && resolved.document_date && resolved.document_date > asOfNorm) continue

        // Expiry filter: skip episodes that have expired by the cutoff date.
        // Mirrors the includeExpired check in search() — graph expansion shouldn't
        // resurrect expired episodes that core search would have filtered.
        if (resolved.expires_at && resolved.expires_at <= expiryCutoff) continue

        // Attribute this fact to a seed for provenance tracking.
        // Best-effort: if this fact was reached via a previously-expanded fact,
        // inherit that fact's seed attribution. Otherwise fall back to the first
        // frontier element (imperfect but only matters for multi-seed debugging).
        const parentSeed =
          seedIdByFact.get(neighbor.related_to)
          ?? seedIdByFact.get(neighbor.id)
          ?? frontier[0]
        seedIdByFact.set(resolved.id, parentSeed)

        collected.push({
          fact: resolved,
          _expansion: {
            via: 'EXTENDS',
            depth,
            seedId: parentSeed,
            supersededFrom,
          }
        })

        // Walk further from the resolved (latest) fact, not the stale one.
        // This is the key correctness property: the latest fact's edges may differ
        // from the stale fact's edges (new EXTENDS may have been added since).
        nextFrontier.push(resolved.id)

        if (collected.length >= maxResults) break
      }

      frontier = nextFrontier
    }

    return collected
  }

  // Walks backward from each seed fact via superseded_from to surface version history.
  // Where _expandViaExtends walks the SEMANTIC graph (refinements that are all currently
  // true), this walks the TEMPORAL graph (predecessors that USED to be true).
  //
  // Critical for queries like "did I switch to more or less" where the answer requires
  // comparing the current value against the historical value. Without this, search
  // surfaces only the latest fact and the answerer has nothing to compare against.
  //
  // Each predecessor is annotated with `via: 'UPDATES_HISTORY'` and a `supersededBy`
  // pointer so the answerer can see the version chain explicitly.
  //
  // Returns: [{ fact, _expansion: { via, depth, seedId, supersededBy } }, ...]
  async _expandViaSupersessionHistory(seedFacts, { maxResults = 5 } = {}) {
    const seedIds = new Set(seedFacts.map(f => f.id).filter(Boolean))
    if (seedIds.size === 0) return []

    const seen = new Set(seedIds)
    const collected = []

    for (const seed of seedFacts) {
      if (!seed.id) continue

      // Re-fetch the seed's full row — hybridSearch results don't include
      // superseded_from, which is what we need to walk backward.
      let current = this.storage.db.prepare(
        `SELECT * FROM facts WHERE id = ?`
      ).get(seed.id)

      let depth = 0
      while (current?.superseded_from && depth < 20) {
        depth++

        const prev = this.storage.db.prepare(
          `SELECT * FROM facts WHERE id = ?`
        ).get(current.superseded_from)

        if (!prev) break
        if (seen.has(prev.id)) break
        seen.add(prev.id)

        collected.push({
          fact: prev,
          _expansion: {
            via: 'UPDATES_HISTORY',
            depth,
            seedId: seed.id,
            supersededBy: { id: current.id, value: current.value },
          }
        })

        if (collected.length >= maxResults) return collected
        current = prev
      }
    }

    return collected
  }
 
  // use cosine similarity to find an existing preference with similar meaning
  // key matching is unreliable — LLMs produce different keys for the same preference
  _strengthenPreference(key, value, embedding, documentDate) {
    const existing = this.storage.db.prepare(`
      SELECT f.id, f.key, f.confidence, e.vector
      FROM facts f
      JOIN embeddings e ON e.fact_id = f.id
      WHERE f.container = ?
        AND f.memory_type = 'preference'
        AND f.is_latest = 1
        AND (f.expires_at IS NULL OR f.expires_at > ?)
    `).all(this.storage.container, documentDate);
 
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
  // returns { type: 'UPDATES'|'EXTENDS'|'NEW', relatedTo: id|null }
  // DERIVES is handled separately by runDerivations() — not classified here
  async _detectRelationship(mem, embedding, documentDate) {
    const { key, value, memory_type, event_date, source_role } = mem;
 
    // step 1a — same key facts (strong signal regardless of embedding similarity)
    const sameKeyFacts = this.storage.db.prepare(`
      SELECT id, key, value, memory_type, document_date, event_date
      FROM facts
      WHERE key = ? AND container = ? AND is_latest = 1
        AND (expires_at IS NULL OR expires_at > ?)
    `).all(key, this.storage.container, documentDate);
 
    // step 1b — semantically similar facts via vector search
    const similarFacts = this.storage.vectorSearch(embedding, this.storage.container, 5, documentDate);
 
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
 
New memory: "${value}" [${memory_type}] [source: ${source_role ?? 'user'}] [recorded: ${documentDate ?? 'unknown'}]${event_date ? ` [event: ${event_date}]` : ''}
 
Existing memories:
${candidates.map((f, i) => `${i + 1}. [ID:${f.id}] "${f.value}" [${f.memory_type}] [source: ${f.source_role ?? 'user'}] [recorded: ${f.document_date ?? 'unknown'}]${f.event_date ? ` [event: ${f.event_date}]` : ''}`).join('\n')}
 
Classify the relationship between the new memory and the MOST RELEVANT existing memory.
Priority order: UPDATES > EXTENDS > NEW
 
UPDATES — new memory contradicts and replaces an existing one:
  CRITICAL: Only apply UPDATES to SINGULAR attributes — concepts where a person
  can only have ONE value at a time:
  - Employer:  "works at Stripe" UPDATES "works at Google"
  - Location:  "lives in Mumbai" UPDATES "lives in Bangalore"
  - Role/Title: "is a PM" UPDATES "is a software engineer"
  - Relationship status, education level, any other singular attribute

  Do NOT use UPDATES for list-like or additive concepts:
  - Recommendations: a second restaurant recommendation does not replace the first
  - Suggestions, options, alternatives: each is independent
  - Steps, instructions, checklist items: each is additive
  - Assistant-provided examples: each example is a separate fact

  For assistant facts (source_role=assistant): default to EXTENDS or NEW
  unless the same specific item is explicitly contradicted.
  "The assistant recommended Armando" does NOT update "The assistant recommended Roscioli"
  — these are two separate recommendations.

  Even if the wording is different, if it describes the SAME attribute with a
  DIFFERENT value AND the attribute is singular → UPDATES.
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
    let text = raw.trim()
 
    // strip markdown fences
    text = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
 
    // try direct parse first
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed : []
    } catch {}
 
    // try extracting just the JSON array — LLM sometimes adds reasoning before/after
    const arrayMatch = text.match(/\[[\s\S]*\]/)
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0])
        return Array.isArray(parsed) ? parsed : []
      } catch {}
    }
 
    // suppress warning for intentional empty responses
    const looksIntentional =
      text.length === 0 ||
      /nothing to extract|no personal|no facts|no memories|empty|n\/a/i.test(text) ||
      /reasoning|filter|skip|conversation (contains|is|has)|no information/i.test(text) ||
      text.startsWith('**') ||
      text.startsWith('#')
 
    if (!looksIntentional) {
      console.warn('[greymemory] extractor returned invalid JSON:', text.slice(0, 200))
    }
    return []
  }

  // normalize a date input to an ISO string — preserving only absolute truths
  // strips day names in parens (derivable), keeps time only if present in input
  // returns null when input is missing or unparseable — never invents data
  _normalizeDate(input) {
    if (input === null || input === undefined || input === '') return null
    if (input instanceof Date) {
      if (isNaN(input.getTime())) return null
      return input.toISOString().replace('Z', '').replace(/\.\d{3}$/, '')
    }
    if (typeof input === 'number') {
      const d = new Date(input)
      if (isNaN(d.getTime())) return null
      return d.toISOString().replace('Z', '').replace(/\.\d{3}$/, '')
    }
 
    // strip day names in parens — (Sat), (Tue) etc — derivable from date, not new info
    const cleaned = String(input).trim().replace(/\([^)]*\)/g, '').trim()
 
    // match from most to least specific — only capture what's actually present
 
    // YYYY/MM/DD HH:MM:SS or YYYY-MM-DD HH:MM:SS
    let m = cleaned.match(/^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
 
    // YYYY/MM/DD HH:MM or ISO YYYY-MM-DDTHH:MM
    m = cleaned.match(/^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})[T ](\d{2}):(\d{2})$/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`
 
    // YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
    m = cleaned.match(/^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})$/)
    if (m) return `${m[1]}-${m[2]}-${m[3]}`
 
    // YYYY/MM or YYYY-MM
    m = cleaned.match(/^(\d{4})[\/\-](\d{2})$/)
    if (m) return `${m[1]}-${m[2]}`
 
    // YYYY only
    m = cleaned.match(/^(\d{4})$/)
    if (m) return m[1]
 
    // natural language — try Date constructor as last resort
    const parsed = new Date(cleaned)
    if (!isNaN(parsed.getTime())) {
      const hasTime = /\d{1,2}:\d{2}/.test(cleaned)
      if (hasTime) return parsed.toISOString().slice(0, 16).replace('T', 'T')
      return parsed.toISOString().slice(0, 10)
    }
 
    return null
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