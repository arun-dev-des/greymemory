import fs from "fs";
import path from "path";

export class Storage {
  constructor(dir = ".greymemory") {
    this.dir = dir;
    this.factsFile = path.join(dir, "facts.json");
    this.embeddingsFile = path.join(dir, "embeddings.json");

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  loadFacts() {
    if (!fs.existsSync(this.factsFile)) return {};
    return JSON.parse(fs.readFileSync(this.factsFile, "utf-8"));
  }

  saveFacts(facts) {
    fs.writeFileSync(this.factsFile, JSON.stringify(facts, null, 2));
  }

  loadEmbeddings() {
    if (!fs.existsSync(this.embeddingsFile)) return {};
    return JSON.parse(fs.readFileSync(this.embeddingsFile, "utf-8"));
  }

  saveEmbeddings(embeddings) {
    fs.writeFileSync(this.embeddingsFile, JSON.stringify(embeddings, null, 2));
  }

  clear() {
    if (fs.existsSync(this.factsFile)) fs.unlinkSync(this.factsFile);
    if (fs.existsSync(this.embeddingsFile)) fs.unlinkSync(this.embeddingsFile);
  }
}