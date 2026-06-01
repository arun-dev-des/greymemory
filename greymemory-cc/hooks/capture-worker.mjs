#!/usr/bin/env node
// Detached worker spawned by capture.mjs. Reads the transcript entries appended since the
// last watermark, maps them to structured greymemory Message[], and ingests them. Advances
// the cursor only after a successful add() so a crash mid-add re-sends the batch next time —
// dedupBySession then suppresses the duplicate rounds (belt-and-suspenders with the cursor).
import { getMemory } from "../lib/memory.mjs";
import { resolveContainer } from "../lib/container.mjs";
import { readNewEntries, advanceCursor } from "../lib/cursor.mjs";
import { entriesToMessages } from "../lib/transcript.mjs";

const payload = JSON.parse(process.argv[2] ?? "{}");
const { session_id, transcript_path, cwd, dataDir } = payload;

if (!session_id || !transcript_path || !dataDir) process.exit(0);

try {
  const { entries, lastUuid } = readNewEntries(transcript_path, session_id, dataDir);
  if (entries.length === 0) process.exit(0);

  const messages = entriesToMessages(entries);
  if (messages.length > 0) {
    const container = resolveContainer(cwd, dataDir);
    const memory = await getMemory({ cwd, container, dataDir });
    // sessionId = provenance + dedup key; dedupBySession skips rounds already ingested under
    // this session, so re-reading a growing transcript never reprocesses old turns.
    await memory.add(messages, { sessionId: session_id, dedupBySession: true });
  }

  advanceCursor(session_id, lastUuid, dataDir);
} catch (err) {
  process.stderr.write(`[greymemory-cc] capture-worker failed: ${err?.message}\n`);
}

process.exit(0);
