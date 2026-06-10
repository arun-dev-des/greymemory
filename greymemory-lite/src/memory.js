import { createHash } from "node:crypto";
import { Storage } from "./storage.js";
import { buildExtractorPrompt } from "./prompts.js";

/**
 * greymemory-lite — the paper-faithful memory core.
 *
 * SQLite + FTS5/BM25 + vector cosine + RRF fusion, with bring-your-own-LLM
 * extraction. Self-hosted; no data leaves the box.
 *
 * Architecture (LongMemEval, Wu et al., ICLR 2025, arXiv:2410.10813):
 *   • CP1 Value  — one chunk = one conversation round (user turn + assistant
 *     reply), extracted one round at a time. Exact fact→chunk provenance by
 *     construction.
 *   • CP2 Key    — chunks are embedded as K = V + fact (user-side text merged
 *     with the facts extracted from that round) at indexing time.
 *   • Retrieval  — hybrid BM25 + vector cosine fused with RRF. One embedder
 *     call per search; zero LLM calls on the query path.
 *   • CP4 Reading— see reading.js: contradictions are resolved by the READER
 *     over chronologically sorted, timestamped results. There is no
 *     supersession machinery at ingest — deliberately.
 */
export class Memory {
  constructor(options = {}) {
    if (typeof options.extractor !== "function") {
      throw new Error(
        "greymemory-lite requires an extractor function.\n" +
        "Example:\n" +
        "  new GreyMemory({\n" +
        "    extractor: async (prompt) => '...'\n" +
        "  })"
      );
    }

    if (typeof options.embedder !== "function") {
      throw new Error(
        "greymemory-lite requires an embedder function.\n" +
        "Example:\n" +
        "  new GreyMemory({\n" +
        "    embedder: async (text) => [0.1, 0.2, 0.3]\n" +
        "  })"
      );
    }

    this.extractor = options.extractor;
    this.embedder  = options.embedder;
    // Optional override: a custom extraction-prompt builder. The single
    // customization seam — domain context, filtering rules, persona all live
    // in the consumer's builder. Must instruct the model to emit
    // greymemory's JSON memory array.
    this.extractorPrompt = typeof options.extractorPrompt === "function" ? options.extractorPrompt : null;
    // Unknown options are deliberately ignored — callers written against the
    // full greymemory package can pass their flags through harmlessly.
    this.storage = new Storage(
      options.dir       ?? ".greymemory-lite",
      options.container ?? "default",
      options.db        ?? null
    );
  }

  // ── Add ────────────────────────────────────────────
  //
  // Chunks are ALWAYS persisted before extraction runs — a failed or empty
  // extraction still leaves the raw conversation queryable through the chunk
  // channels. Then each round gets one extraction LLM call, and finally every
  // chunk is embedded as K = V + fact.
  async add(input, opts = {}) {
    const documentDate = this._normalizeDate(opts.date) ?? new Date().toISOString().slice(0, 10);

    // Per-add() call accounting. Counts attempts (before each await) so the
    // numbers stay accurate even when an upstream API throws.
    const llmCallCounts      = { extraction: 0 };
    const embedderCallCounts = { chunk: 0, dedup_seed: 0, memory: 0 };

    // dedupBySession: opt-in round-level upsert keyed by sessionId — re-adding
    // the same conversation skips already-ingested rounds entirely.
    const dedupBySession = opts.dedupBySession === true && opts.sessionId != null;
    let roundsSkipped = 0;

    // 1. Normalize input into a messages array. Content-block arrays and
    //    tool_calls are flattened to strings here (the single chokepoint), so
    //    the rest of the pipeline only ever sees { role, content:string }.
    //    A raw string stays a document.
    const isArrayInput = Array.isArray(input);
    const messages = this._normalizeMessages(input);

    // 2. Save chunks first — they are the raw record, independent of extraction.
    //
    // Granularity = ROUND (CP1, LongMemEval §5.2): one chunk row = one user
    // turn + the immediate assistant reply. Greedy left-to-right pairing.
    // Orphan turns (leading/standalone assistant, trailing user, back-to-back
    // same-role turns) become single-turn rounds. A raw string input becomes
    // a single document round.
    //
    // Each round's chunk EMBEDDING happens right after that round's extraction
    // (K = V + fact indexing-stage merge, §5.3) — see _extractByRound. The
    // user-side text travels on the round object.
    const rounds = [];   // { chunkId, messages: [...], userText, contentHash }

    let i = 0;
    while (i < messages.length) {
      const cur  = messages[i];
      const next = messages[i + 1];
      const paired =
        isArrayInput &&
        cur.role === "user" &&
        next?.role === "assistant" &&
        cur.content?.trim() &&
        next.content?.trim();

      const indexes = paired ? [i, i + 1] : [i];
      const advance = paired ? 2 : 1;

      if (!cur.content?.trim()) { i += advance; continue; }

      const rawChunk = paired
        ? `user: ${cur.content}\nassistant: ${next.content}`
        : (isArrayInput ? `${cur.role}: ${cur.content}` : cur.content);

      // Hash the RAW round. If this exact round was already FULLY ingested
      // under the same sessionId/container, skip it entirely — no chunk, no
      // extraction. The hash is written only after the round's whole pipeline
      // completes (see _extractByRound), so a crash mid-add() leaves the chunk
      // durable but unhashed and a retry RESUMES it — reusing the existing row
      // instead of skipping or duplicating it.
      const contentHash = dedupBySession ? this._hashRound(rawChunk) : null;
      if (dedupBySession && this.storage.chunkExists(opts.sessionId, contentHash)) {
        roundsSkipped++;
        i += advance;
        continue;
      }

      const chunkId =
        (dedupBySession ? this.storage.findIncompleteChunk(opts.sessionId, rawChunk) : null) ??
        this.storage.saveChunk(rawChunk, opts.sessionId ?? null, documentDate, null);

      if (chunkId) {
        // userText: the user-side text for K = V + fact (§5.3 — user-side only).
        // paired: user turn; orphan user: the turn; orphan assistant/document:
        // the raw turn content (no user side) so the embedding still has signal.
        rounds.push({
          chunkId,
          messages: indexes.map(idx => messages[idx]),
          userText: cur.content,
          contentHash,
        });
      }

      i += advance;
    }

    // 3. Process rounds in order: extract → persist facts → embed the chunk
    //    (K = V + fact) → mark the round ingested.
    const savedThisBatch = [];
    const chunkIdToFacts = new Map();  // chunk_id → [factValue, ...] for K = V + fact

    await this._extractByRound(rounds, {
      documentDate, savedThisBatch, chunkIdToFacts, llmCallCounts, embedderCallCounts,
    });

    return {
      chunksStored:  rounds.length,
      factsStored:   savedThisBatch.length,
      roundsSkipped,
      chunksSkipped: roundsSkipped,   // one chunk per round; alias for clarity
      llmCalls: {
        extraction: llmCallCounts.extraction,
        total:      llmCallCounts.extraction,
      },
      embedderCalls: {
        chunk:      embedderCallCounts.chunk,
        dedup_seed: embedderCallCounts.dedup_seed,
        memory:     embedderCallCounts.memory,
        total:      embedderCallCounts.chunk + embedderCallCounts.dedup_seed + embedderCallCounts.memory,
      },
    };
  }

  // Extract one round at a time, in order. Each round gets a sharp per-round
  // dedup seed (recent same-topic facts shown to the extractor as "existing
  // memories") and a running summary of the facts established in earlier
  // rounds, so cross-round references ("the office" → Stripe) still resolve.
  // Provenance is exact — every fact belongs to its round's chunk.
  async _extractByRound(rounds, ctx) {
    const { documentDate, embedderCallCounts, llmCallCounts } = ctx;

    const sessionFacts = [];   // fact values seen so far this session — the running summary
    let extractedAny = false;

    for (const round of rounds) {
      const roundMessages = round.messages;
      const roundText = roundMessages.map(m => m.content).join(" ");
      if (!roundText.trim()) continue;

      embedderCallCounts.dedup_seed++;
      const roundVector = await this.embedder(roundText, { phase: "dedup_seed" });
      const existingFacts = this.storage.vectorSearch(roundVector, this.storage.container, 10, documentDate)
        .filter(f => f.memory_type !== "preference");

      const runningContext = this._buildRunningContext(sessionFacts);

      // A single document-role round is passed as the raw string so the
      // extraction prompt labels it DOCUMENT (source_message_index → null,
      // provenance falls back to the round's chunk).
      const isDocumentRound = roundMessages.length === 1 && roundMessages[0].role === "document";
      const extractionInput = isDocumentRound ? roundMessages[0].content : roundMessages;

      // source_message_index is 0/1 relative to this round's 1-2 messages
      const prompt = (this.extractorPrompt ?? buildExtractorPrompt)({
        input:         extractionInput,
        existingFacts,
        documentDate,
        entityContext: runningContext,
      });
      llmCallCounts.extraction++;
      const raw      = await this.extractor(prompt, { phase: "extraction" });
      const memories = this._parseExtraction(raw);

      if (memories.length > 0) {
        extractedAny = true;

        // per-round provenance: every fact belongs to this round's chunk
        const messageIndexToRole    = {};
        const messageIndexToChunkId = {};
        roundMessages.forEach((m, idx) => {
          messageIndexToRole[idx]    = m.role;
          messageIndexToChunkId[idx] = round.chunkId;
        });

        await this._saveMemories(memories, {
          ...ctx,
          messageIndexToRole,
          messageIndexToChunkId,
          anchorChunkId: round.chunkId,
        });

        for (const mem of memories) {
          if (mem?.value) sessionFacts.push(mem.value);
        }
      }

      // K = V + fact chunk embedding — runs even on empty extraction so the
      // chunk still gets a user-side vector.
      await this._embedChunk(round, ctx.chunkIdToFacts, ctx.embedderCallCounts);

      // Round fully processed — only NOW is it marked ingested for
      // dedupBySession. (A crash between _saveMemories and here means a retry
      // re-extracts this round — duplicate facts are possible but benign;
      // the reverse ordering would risk a chunk with no vector forever.)
      if (round.contentHash) this.storage.setChunkHash(round.chunkId, round.contentHash);
    }

    if (rounds.length > 0 && !extractedAny) {
      console.warn("[greymemory-lite] empty extraction, no facts saved.");
    }
  }

  // Embed one round's chunk as K = V + fact (§5.3 indexing-stage merge):
  // user-side text merged with the facts extracted from that round.
  async _embedChunk(round, chunkIdToFacts, embedderCallCounts) {
    const USER_TEXT_CAP       = 4000;  // chars — paper §5.3 dilution control
    const MAX_FACTS_PER_CHUNK = 50;

    const facts = (chunkIdToFacts.get(round.chunkId) ?? []).slice(0, MAX_FACTS_PER_CHUNK);
    const trimmedUserText = (round.userText ?? "").slice(0, USER_TEXT_CAP);

    const parts = [];
    if (trimmedUserText) parts.push(trimmedUserText);
    if (facts.length)    parts.push(`Facts:\n- ${facts.join("\n- ")}`);

    const embeddingInput = parts.join("\n\n");
    if (!embeddingInput.trim()) return;  // defensive guard; shouldn't fire

    embedderCallCounts.chunk++;
    const vector = await this.embedder(embeddingInput, { phase: "chunk" });
    this.storage.saveChunkEmbedding(round.chunkId, vector);
  }

  // Folds the facts established in earlier rounds into a context string so the
  // extractor can resolve cross-round references without a separate
  // summarization call. Capped to bound prompt growth on long sessions.
  _buildRunningContext(sessionFacts) {
    if (sessionFacts.length === 0) return "";
    const recent = sessionFacts.slice(-20);
    return `Established earlier in this session:\n- ${recent.join("\n- ")}`;
  }

  // Per-memory save loop: validate → resolve provenance → embed → in-batch
  // cosine dedup → persist fact + embedding atomically, collecting per-chunk
  // fact values for the K = V + fact merge. No relationship classification —
  // contradictions are the reader's job (see reading.js).
  async _saveMemories(memories, ctx) {
    const { documentDate, savedThisBatch, chunkIdToFacts, embedderCallCounts } = ctx;
    const DEDUP_THRESHOLD = 0.92;

    for (const mem of memories) {
      if (!mem || typeof mem !== "object") continue;
      const {
        key,
        value,
        memory_type = "fact",
        event_date  = null,
        expires_at  = null,
      } = mem;

      if (!key || !value) continue;

      const { source_role, resolvedChunkId } = this._resolveProvenance(mem, ctx);

      embedderCallCounts.memory++;
      const embedding = await this.embedder(value, { phase: "memory" });

      const isDuplicate = savedThisBatch.some(
        saved => this._cosineSimilarity(embedding, saved) > DEDUP_THRESHOLD
      );
      if (isDuplicate) continue;

      this.storage.saveFactWithEmbedding(key, value, {
        memory_type,
        document_date: documentDate,
        event_date,
        expires_at,
        chunk_id:      resolvedChunkId,
        source_role,
      }, embedding);

      savedThisBatch.push(embedding);

      // collect this fact's value for the K = V + fact chunk embedding
      if (resolvedChunkId) {
        if (!chunkIdToFacts.has(resolvedChunkId)) chunkIdToFacts.set(resolvedChunkId, []);
        chunkIdToFacts.get(resolvedChunkId).push(value);
      }
    }
  }

  // Provenance for a memory: deterministic source_role + chunk id from the
  // extractor's source_message_index (falls back to the round's chunk).
  _resolveProvenance(mem, ctx) {
    const { messageIndexToRole, messageIndexToChunkId, anchorChunkId } = ctx;
    const smi = mem.source_message_index;
    const source_role = (Number.isInteger(smi) && messageIndexToRole[smi] != null)
      ? messageIndexToRole[smi] : null;
    const resolvedChunkId = (Number.isInteger(smi) && messageIndexToChunkId[smi] != null)
      ? messageIndexToChunkId[smi] : anchorChunkId;
    return { source_role, resolvedChunkId };
  }

  // ── Search ─────────────────────────────────────────
  //
  // One embedder call, zero LLM calls. Hybrid BM25 + vector + RRF over facts
  // and chunks, then plain filters. `topN` should scale with reader-model
  // capability (LongMemEval §5.2): weak readers degrade past ~3k retrieved
  // tokens; strong readers (GPT-4o class) keep improving past 20k. Rough
  // guidance: weak readers 3–5, strong readers 10–25. The caller decides.
  async search(query, options = {}) {
    const {
      topN        = 5,
      memoryTypes = null,   // e.g. ['fact', 'preference'] or null for all
      afterDate   = null,   // only facts with event_date >= this (null event_date passes)
      beforeDate  = null,   // only facts with event_date <= this (null event_date passes)
      asOf        = null,   // temporal cutoff: facts/chunks recorded after this date are invisible
    } = typeof options === "number" ? { topN: options } : options;
    // Unknown options are deliberately ignored.

    // normalize asOf to end-of-day so same-day records stay visible.
    // Fail-loud on an unparseable value: silently ignoring an explicit
    // temporal cutoff would leak records the caller asked to hide.
    let asOfNorm = null;
    if (asOf) {
      const normalized = this._normalizeDate(asOf);
      if (!normalized) {
        throw new Error(
          `[greymemory-lite] unparseable asOf value: ${JSON.stringify(asOf)} — ` +
          `pass an ISO-ish date string ("2026-06-10"), a Date, or epoch milliseconds.`
        );
      }
      asOfNorm = normalized.includes("T") ? normalized : `${normalized}T23:59:59`;
    }

    // Candidate pool fetched/fused BEFORE filters — decoupled from the seed
    // budget so type/date filters can't starve the final slice.
    const pool = Math.max(topN * 4, 40);

    const queryVector = await this.embedder(query, { phase: "query" });
    const rawResults = this.storage.hybridSearch(
      query,                  // raw text for BM25
      queryVector,            // embedding for vector search
      this.storage.container,
      pool,
      asOfNorm
    );

    // ── filters ──
    let filtered = rawResults;

    if (memoryTypes) {
      filtered = filtered.filter(r =>
        r._type === "chunk" || memoryTypes.includes(r.memory_type)
      );
    }

    // Date-range filter. FAIL-OPEN on a null event_date: many legitimate facts
    // carry no event_date ("ongoing state with no start", "vague past" — see
    // the extraction prompt STEP 3). Excluding them when a bound is active
    // silently tanks recall — only exclude a fact whose event_date is KNOWN
    // to fall outside the range; the reader judges the rest. Partial-precision
    // event_dates ("2026-04") that OVERLAP a bound's period (the bound starts
    // with them) also fail open for the same reason.
    if (afterDate) {
      filtered = filtered.filter(r =>
        r._type === "chunk" || !r.event_date ||
        r.event_date >= afterDate || afterDate.startsWith(r.event_date)
      );
    }

    if (beforeDate) {
      filtered = filtered.filter(r =>
        r._type === "chunk" || !r.event_date ||
        r.event_date <= beforeDate || beforeDate.startsWith(r.event_date)
      );
    }

    // ── shape and return ──
    return filtered.slice(0, topN).map(result => {
      if (result._type === "chunk") {
        return {
          memory:        null,
          chunk:         result.content,
          memory_type:   null,
          document_date: result.created_at?.slice(0, 10) ?? null,
          event_date:    null,
          source_role:   null,
          session_id:    result.session_id ?? null,
        };
      }
      return this._factToResult(result);
    });
  }

  // Shapes a raw facts row into the public search result format.
  _factToResult(fact) {
    return {
      memory:        fact.value,                           // the extracted memory text
      chunk:         this.storage.getChunk(fact.chunk_id), // raw round that produced this fact
      memory_type:   fact.memory_type,                     // 'fact', 'preference', 'episode'
      document_date: fact.document_date,                   // when the conversation happened
      event_date:    fact.event_date,                      // when the described event happened
      source_role:   fact.source_role,                     // 'user' or 'assistant'
      session_id:    fact.session_id ?? null,
    };
  }

  // ── getMemories ────────────────────────────────────
  // Every current (non-expired) memory as full row objects — the
  // transparency surface: see exactly what is stored.
  getMemories() {
    return this.storage.loadFacts();
  }

  // ── getProfile ─────────────────────────────────────
  // static/dynamic profile split — injection-ready for system prompts.
  //   static:  preferences (always) + facts older than 7 days
  //   dynamic: facts from the last 7 days + current episodes
  // optional q — also runs search() and returns results alongside profile
  async getProfile({ q = null, topN = 5, asOf = null } = {}) {
    // asOf keeps episode expiry and the static/dynamic split relative to a
    // historical reference date instead of today
    const referenceDate = asOf
      ? (this._normalizeDate(asOf) ?? new Date().toISOString().slice(0, 10))
      : new Date().toISOString().slice(0, 10);

    const cutoff = new Date(new Date(referenceDate) - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);

    const allFacts = this.storage.loadFacts(referenceDate);

    const staticFacts  = [];
    const dynamicFacts = [];

    for (const fact of allFacts) {
      // expired episodes — excluded relative to referenceDate, not today
      if (fact.expires_at && fact.expires_at < referenceDate) continue;

      if (fact.memory_type === "preference") {
        staticFacts.push(fact.value);
      } else if (fact.memory_type === "episode") {
        dynamicFacts.push(fact.value);
      } else {
        if (fact.document_date && fact.document_date > cutoff) {
          dynamicFacts.push(fact.value);
        } else {
          staticFacts.push(fact.value);
        }
      }
    }

    const profile = { static: staticFacts, dynamic: dynamicFacts };

    if (q) {
      const results = await this.search(q, { topN, asOf });
      return { profile, results };
    }

    return { profile };
  }

  // ── forget ─────────────────────────────────────────
  // Soft delete — expires the closest-matching memory immediately via
  // semantic search. Never hard-deletes; the row stays for audit.
  async forget(query) {
    const embedding = await this.embedder(query, { phase: "query" });
    const results   = this.storage.vectorSearch(embedding, this.storage.container, 1);

    if (!results[0]) return null;

    // yesterday — expiry is inclusive of the expires_at day, so an expires_at
    // before today is excluded everywhere immediately
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    this.storage.expireFact(results[0].id, yesterday);

    return results[0].value;
  }

  // ── clear ──────────────────────────────────────────
  clear() {
    this.storage.clear();
  }

  // ── Extraction parsing ─────────────────────────────
  // raw extractor string → array of memory objects. Handles accidental
  // markdown fences, invalid JSON, prose around the array, and non-string
  // returns. Fail-open: always returns an array.
  _parseExtraction(raw) {
    let text = String(raw ?? "").trim();

    // strip markdown fences
    text = text.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();

    // try direct parse first
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {}

    // try extracting just the JSON array — LLMs sometimes add prose around it,
    // and that prose may itself contain brackets ("[note]"), so try each '['
    // as a candidate start against the last ']' as the end (max 10 attempts).
    const lastClose = text.lastIndexOf("]");
    if (lastClose !== -1) {
      let start = text.indexOf("[");
      for (let attempts = 0; start !== -1 && start < lastClose && attempts < 10; attempts++) {
        try {
          const parsed = JSON.parse(text.slice(start, lastClose + 1));
          if (Array.isArray(parsed)) return parsed;
        } catch {}
        start = text.indexOf("[", start + 1);
      }
    }

    // suppress warning for intentional empty responses
    const looksIntentional =
      text.length === 0 ||
      /nothing to extract|no personal|no facts|no memories|empty|n\/a/i.test(text) ||
      /reasoning|filter|skip|conversation (contains|is|has)|no information/i.test(text) ||
      text.startsWith("**") ||
      text.startsWith("#");

    if (!looksIntentional) {
      console.warn("[greymemory-lite] extractor returned invalid JSON:", text.slice(0, 200));
    }
    return [];
  }

  // ── Message normalization ──────────────────────────
  //
  // The single chokepoint that turns rich messages into the
  // { role, content:string } shape the rest of the pipeline assumes. Accepts a
  // raw string (→ one 'document' message) or a Message[] whose content may be
  // a string OR an array of content blocks, and whose assistant/tool turns may
  // carry tool_calls / tool_call_id. Everything folds to a string; never throws.

  _normalizeContent(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const parts = content.map(block => {
        if (!block || typeof block !== "object") return "";
        if (block.type === "text") return typeof block.text === "string" ? block.text : "";
        if (block.type === "image_url" || block.type === "image") return "[image]";
        return "[unsupported content]";
      }).filter(Boolean);
      return parts.join("\n");
    }
    return "";
  }

  // Render an assistant turn's tool_calls as compact text the extractor can
  // read. Tolerates either {name, arguments} or the OpenAI
  // {function:{name, arguments}} shape.
  _serializeToolCalls(toolCalls) {
    if (!Array.isArray(toolCalls) || toolCalls.length === 0) return "";
    return toolCalls.map(tc => {
      const name = tc?.name ?? tc?.function?.name ?? "tool";
      let args;
      try { args = JSON.stringify(tc?.arguments ?? tc?.function?.arguments ?? {}); } catch { args = null; }
      return args != null ? `[tool_call name=${name} args=${args}]` : `[tool_call name=${name}]`;
    }).join("\n");
  }

  _normalizeMessages(input) {
    const raw = Array.isArray(input) ? input : [{ role: "document", content: input }];
    return raw.map(m => {
      const role = m?.role ?? "user";
      let content = this._normalizeContent(m?.content);
      if (role === "tool") {
        const name = m?.name ?? "tool";
        content = content ? `[tool result name=${name}] ${content}` : `[tool result name=${name}]`;
      } else if (role === "assistant" && m?.tool_calls) {
        const calls = this._serializeToolCalls(m.tool_calls);
        if (calls) content = content ? `${content}\n${calls}` : calls;
      }
      return { role, content };
    });
  }

  // sha256 of a round's RAW text — the dedup key for dedupBySession.
  _hashRound(text) {
    return createHash("sha256").update(String(text), "utf8").digest("hex");
  }

  // ── Date normalization ─────────────────────────────
  // Normalizes a date input to an ISO-ish string, preserving only absolute
  // truths: strips day names in parens (derivable), keeps time only if present
  // in the input, and never timezone-shifts literal wall-clock digits. Returns
  // null when input is missing or unparseable — never invents data.
  //
  // Accepted: Date instances, epoch milliseconds, 'YYYY-MM-DD',
  // 'YYYY/MM/DD HH:MM[:SS]' (incl. the LongMemEval '2023/05/20 (Sat) 02:21'
  // form), ISO datetimes. Anything else (natural language) → null —
  // add()/getProfile() fall back to today; search() fails loud.
  _normalizeDate(input) {
    if (input === null || input === undefined || input === "") return null;
    if (input instanceof Date) {
      if (isNaN(input.getTime())) return null;
      return input.toISOString().replace("Z", "").replace(/\.\d{3}$/, "");
    }
    if (typeof input === "number") {
      const d = new Date(input);
      if (isNaN(d.getTime())) return null;
      return d.toISOString().replace("Z", "").replace(/\.\d{3}$/, "");
    }

    // strip day names in parens — (Sat), (Tue) etc — derivable from the date,
    // not new info. NOTE: this leaves a DOUBLE interior space, e.g.
    // "2023/05/20 (Sat) 02:21" → "2023/05/20  02:21". The time separators
    // below are [T\s]+ (not a single [T ]) so that artifact stays on the
    // literal, timezone-naive path.
    const cleaned = String(input).trim().replace(/\([^)]*\)/g, "").trim();

    // YYYY/MM/DD HH:MM:SS — un-anchored at the end on purpose: a trailing zone
    // marker (Z / +05:30 / .123) is simply not captured, keeping the literal
    // wall-clock digits verbatim.
    let m = cleaned.match(/^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})[T\s]+(\d{2}):(\d{2}):(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;

    // YYYY/MM/DD HH:MM or ISO YYYY-MM-DDTHH:MM (optional trailing zone marker)
    m = cleaned.match(/^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})[T\s]+(\d{2}):(\d{2})(?:Z|[+\-]\d{2}:?\d{2})?$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}`;

    // YYYY/MM/DD or YYYY-MM-DD or YYYY.MM.DD
    m = cleaned.match(/^(\d{4})[\/\-\.](\d{2})[\/\-\.](\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;

    return null;
  }

  _cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot  += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }
}
