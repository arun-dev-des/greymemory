import { Memory } from "./memory.js";

export default Memory;            // default export
export { Memory };                // named export
export { Memory as GreyMemory }; // alias

export { formatForReading, parseReadingAnswer } from "./reading.js";

// Extraction prompt + its stable static prefix. Exposed so consumers can send
// the prefix as an LLM-provider prompt-cache block (split the returned prompt
// on EXTRACTOR_STATIC_PREFIX, which is always a strict prefix of it), or build
// their own extractor prompt on top of it.
export { buildExtractorPrompt, EXTRACTOR_STATIC_PREFIX } from "./prompts.js";

export { createBatchEmbedder } from "./batch-embedder.js";
