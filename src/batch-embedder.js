/**
 * createBatchEmbedder
 *
 * Wraps a batch embedding function into a single-text embedder interface.
 * Collects individual embed() calls within a time window and sends them
 * as one batched API request — transparently to the caller.
 *
 * If the batch request fails, each item is retried individually so a
 * single API error never silently drops an entire batch.
 *
 * @param {Function} batchFn  async (texts: string[]) => number[][]
 * @param {object}   opts
 * @param {number}   opts.windowMs   how long to collect requests (default: 20ms)
 * @param {number}   opts.maxBatch   max texts per batch request (default: 128)
 *
 * @returns {Function} async (text: string) => number[]
 *
 * @example
 * const embedder = createBatchEmbedder(async (texts) => {
 *   const res = await fetch('https://api.voyageai.com/v1/embeddings', {
 *     method:  'POST',
 *     headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
 *     body:    JSON.stringify({ model: 'voyage-3', input: texts }),
 *   })
 *   const data = await res.json()
 *   return data.data.map(d => d.embedding)
 * })
 *
 * // now use as a normal single-text embedder
 * const vector = await embedder('hello world')
 */
export function createBatchEmbedder(batchFn, opts = {}) {
  const windowMs = opts.windowMs ?? 20
  const maxBatch = opts.maxBatch ?? 128

  let queue = []   // { text, resolve, reject }
  let timer = null

  async function flush() {
    timer = null
    if (queue.length === 0) return

    // take current queue — more may arrive while we await
    const batch = queue.splice(0, maxBatch)
    const texts = batch.map(item => item.text)

    try {
      const embeddings = await batchFn(texts)

      batch.forEach((item, i) => {
        if (embeddings[i]) {
          item.resolve(embeddings[i])
        } else {
          item.reject(new Error(`[batch-embedder] no embedding returned for index ${i}`))
        }
      })
    } catch (err) {
      // batch failed — retry each item individually so one error doesn't drop the whole batch
      // slower but safe — a transient API error won't silently lose memories
      console.warn(`[batch-embedder] batch of ${batch.length} failed, retrying individually: ${err.message}`)

      for (const item of batch) {
        try {
          const result = await batchFn([item.text])
          if (result[0]) {
            item.resolve(result[0])
          } else {
            item.reject(new Error(`[batch-embedder] individual retry returned no embedding`))
          }
        } catch (retryErr) {
          item.reject(retryErr)
        }
      }
    }

    // if more arrived while we were awaiting — flush again immediately
    if (queue.length > 0) flush()
  }

  // Accepts an optional `context` arg (e.g. { phase }) to match the EmbedderFn
  // type used by the library. Batching mixes phases, so context is intentionally
  // ignored here — consumers that want per-phase metering should wrap the
  // returned function.
  return function embedder(text, _context) {
    return new Promise((resolve, reject) => {
      queue.push({ text, resolve, reject })

      // flush immediately if batch is full
      if (queue.length >= maxBatch) {
        if (timer) { clearTimeout(timer); timer = null }
        flush()
        return
      }

      // otherwise set/reset the window timer
      if (!timer) {
        timer = setTimeout(flush, windowMs)
      }
    })
  }
}