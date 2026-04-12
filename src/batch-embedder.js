/**
 * createBatchEmbedder
 *
 * Wraps a batch embedding function into a single-text embedder interface.
 * Collects individual embed() calls within a time window and sends them
 * as one batched API request — transparently to the caller.
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

  let queue    = []   // { text, resolve, reject }
  let timer    = null

  async function flush() {
    timer = null
    if (queue.length === 0) return

    // take current queue — more may arrive while we await
    const batch = queue.splice(0, maxBatch)

    const texts = batch.map(item => item.text)

    try {
      const embeddings = await batchFn(texts)

      // resolve each promise with its corresponding embedding
      batch.forEach((item, i) => {
        if (embeddings[i]) {
          item.resolve(embeddings[i])
        } else {
          item.reject(new Error(`batch embedder: no embedding returned for index ${i}`))
        }
      })
    } catch (err) {
      // reject all in this batch
      batch.forEach(item => item.reject(err))
    }

    // if more arrived while we were awaiting — flush again immediately
    if (queue.length > 0) flush()
  }

  return function embedder(text) {
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