import Anthropic from "@anthropic-ai/sdk";
import { Storage } from "./storage.js";
import { Embeddings } from "./embeddings.js";

export class Memory {
  constructor(options = {}) {
    this.storage = new Storage(options.dir || ".greymemory");
    this.embeddings = new Embeddings(
      options.model || "nomic-embed-text",
      options.ollamaUrl || "http://localhost:11434"
    );
    this.client = new Anthropic({
      apiKey: options.apiKey || process.env.ANTHROPIC_API_KEY
    });
    this.facts = this.storage.loadFacts();
  }

  // PUBLIC API 1 — add a conversation
  async add(messages) {
    const existingFacts = this.storage.loadFacts();
    const updatedFacts = await this._extractFacts(messages, existingFacts);
    this.storage.saveFacts(updatedFacts);
    this.facts = updatedFacts;
    await this._rebuildEmbeddings(updatedFacts);
    return updatedFacts;
  }

  // PUBLIC API 2 — search relevant facts
  async search(query, topN = 3) {
    const stored = this.storage.loadEmbeddings();
    if (Object.keys(stored).length === 0) return {};

    const queryVector = await this.embeddings.embed(query);

    const scored = Object.entries(stored).map(([key, { text, vector }]) => ({
      key,
      text,
      score: this.embeddings.cosineSimilarity(queryVector, vector),
    }));

    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topN)
        .reduce((acc, f) => ({ ...acc, [f.key]: f.text.split(": ").slice(1).join(": ") }), {});
  }

  // PUBLIC API 3 — clear everything
  clear() {
    this.storage.clear();
    this.facts = {};
  }

  // PUBLIC API 4 — get all facts
  getFacts() {
    return this.storage.loadFacts();
  }

  // PRIVATE — extract facts using Claude
  async _extractFacts(messages, existingFacts) {
    const response = await this.client.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 512,
      system: `You are a fact extractor. Extract key facts about the user from this conversation.
Return ONLY a valid JSON object. No explanation. No markdown. No backticks.
If a new fact contradicts an existing one, the NEW one wins.
If no new facts, return existing facts unchanged.
Only store facts ABOUT THE USER.`,
      messages: [{
        role: "user",
        content: `Existing facts: ${JSON.stringify(existingFacts)}
Conversation:
${messages
  .filter(m => typeof m.content === "string")
  .map(m => `${m.role}: ${m.content}`)
  .join("\n")}
Extract updated facts:`,
      }],
    });

    try {
      return JSON.parse(response.content[0].text);
    } catch {
      return existingFacts;
    }
  }

  // PRIVATE — rebuild embeddings when facts change
  async _rebuildEmbeddings(facts) {
    const embeddings = {};
    for (const [key, value] of Object.entries(facts)) {
      const text = `${key}: ${value}`;
      embeddings[key] = {
        text,
        vector: await this.embeddings.embed(text),
      };
    }
    this.storage.saveEmbeddings(embeddings);
  }
}