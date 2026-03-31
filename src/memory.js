import { Storage } from "./storage.js";

export class Memory {
  constructor(options = {}) {
    if (typeof options.extractor !== "function") {
      throw new Error(
        "GreyMemory requires an extractor function.\n" +
        "Example:\n" +
        "  new GreyMemory({\n" +
        "    extractor: async (messages) => ({ name: 'Arun' })\n" +
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

    this.extractor = options.extractor;
    this.embedder  = options.embedder;
    this.storage   = new Storage(
      options.dir       ?? ".greymemory",
      options.container ?? "default",
      options.db        ?? null
    );
  }

  async add(messages) {
    // extract facts using developer's LLM
    const raw = await this.extractor(messages);

    // normalize — extractor might return nested objects
    const facts = {};
    for (const [key, value] of Object.entries(raw)) {
      facts[key] = typeof value === "string"
        ? value
        : JSON.stringify(value);
    }

    // save facts
    this.storage.saveFacts(facts);

    // save each message as its own chunk
    for (const message of messages) {
      if (!message.content?.trim()) continue;

      const chunkContent = `${message.role}: ${message.content}`;
      this.storage.saveChunk(chunkContent);

      const chunkId = this.storage.getLastChunkId();
      if (chunkId) {
        const vector = await this.embedder(chunkContent);
        this.storage.saveChunkEmbedding(chunkId, vector);
      }
    }

    // save fact embeddings
    for (const [key, value] of Object.entries(facts)) {
      const vector = await this.embedder(`${key}: ${value}`);
      this.storage.saveEmbeddings({ [key]: vector });
    }
  }

  async search(query, topN = 5) {
    const queryVector = await this.embedder(query);
    return this.storage.hybridSearch(
      query,
      queryVector,
      this.storage.container,
      topN
    );
  }

  getFacts() {
    return this.storage.loadFacts();
  }

  clear() {
    this.storage.clear();
  }
}