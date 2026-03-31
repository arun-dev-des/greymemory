import GreyMemory, { Message, SearchResult, GreyMemoryOptions } from './src/index.js'

const options: GreyMemoryOptions = {
  extractor: async (messages: Message[]) => {
    return { name: "Arun" }
  },
  embedder: async (text: string) => {
    return [0.1, 0.2, 0.3]
  },
  dir: ".greymemory",
  container: "work"
}

const memory = new GreyMemory(options)
const result: Promise<void> = memory.add([{ role: "user", content: "hello" }])
const results: Promise<SearchResult[]> = memory.search("query")
const facts = memory.getFacts()
memory.clear()