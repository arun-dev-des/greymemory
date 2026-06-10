import { Memory } from "./memory.js";

export default Memory;  // default export
export { Memory };  // named export

export { buildAnsweringPrompt, formatForReading, formatForReadingV2, formatRetrievedContext } from './answering.js'

// Extraction prompt + its stable static prefix. Exposed so consumers can send
// the prefix as an Anthropic prompt-cache block (split the returned prompt on
// EXTRACTOR_STATIC_PREFIX, which is always a strict prefix of it).
export { buildExtractorPrompt, EXTRACTOR_STATIC_PREFIX } from './prompts.js'