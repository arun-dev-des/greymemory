export class Embeddings {
    constructor(model = "nomic-embed-text", ollamaUrl = "http://localhost:11434") {
      this.model = model;
      this.ollamaUrl = ollamaUrl;
    }
  
    async embed(text) {
      const response = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      const data = await response.json();
      if (!data.embedding) throw new Error(`Embedding failed: ${JSON.stringify(data)}`);
      return data.embedding;
    }
  
    cosineSimilarity(vecA, vecB) {
      const dot = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
      const magA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
      const magB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
      return dot / (magA * magB);
    }
  }