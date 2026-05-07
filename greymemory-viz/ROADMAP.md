# Roadmap

## v0.1 (this commit)

Working:

- Express backend that reads from `.greymemory/greymemory.db` and exposes the graph as JSON
- React + Vite frontend with one canvas, four mode toggles
- **Explore mode**: pan, zoom, click any node for full detail (value, chunk, version chain, extensions, derivations)
- **Debug retrieval mode**: live `memory.search()` against the real DB. Highlights seeds / EXTENDS expansion / version history on the graph. Click any result to jump to its node.
- **Time scrubber**: drag a slider over the date range to replay the graph's growth. Uses `asOf` semantics consistent with `search()`'s time travel.
- **Showcase mode**: locks interaction off for a clean static render
- Always-visible search bar with `⌘K` focus shortcut
- Inspect panel with full metadata, chunk content, history, successors, extends, derivations
- Stats panel mirroring the supermemory legend layout

## v0.2 — proposed

- **Retrieval score breakdown**: show BM25 score, vector cosine, RRF total per result. Surface which channel (fact-bm25, fact-vector, chunk-bm25, chunk-vector) contributed most. Currently the backend returns `_sources` but the frontend doesn't render it yet — easy follow-up.
- **Hover trails**: hover a node, draw faint trails to all related nodes by relation type. Useful in dense clusters where edges blend together.
- **Cluster grouping**: detect document boundaries (groups of facts sharing the same `document_date`) and render faint cluster rings, like the supermemory screenshot. Currently nodes are positioned only by force layout.
- **Filter chips**: above the graph, toggle visibility by memory_type, by source_role (user/assistant), by date range. Cheap, high-value.
- **Confidence visualization**: nodes scale by `confidence` so reinforced preferences appear larger.

## v0.3 — bigger ideas

- **A/B retrieval**: type two queries, see which nodes overlap and which are unique to each. Useful for tuning prompts.
- **Add-flow replay**: when a new fact gets added, animate it landing on the graph with its UPDATES/EXTENDS edges materializing. Requires backend to emit a websocket event from `Memory.add()` — a small hook in user code.
- **Embedding space view**: project all embeddings to 2D (UMAP/t-SNE on the server, cached). Toggle between graph layout (force-directed) and semantic layout (UMAP). Bret-Victor-grade.
- **Retrieval simulator**: replay a real conversation message-by-message and watch which memories light up at each turn — useful for debugging "why didn't it remember X?"

## Not planned

- Editing memories from the UI. GreyMemory's mutations go through `add()` / `forget()` and that's the right surface; the viz should stay read-only to avoid drift.
- Multi-container view in a single canvas. Different containers are different memory spaces — mixing them confuses the mental model. Use the `GREYMEMORY_CONTAINER` env var to switch.
