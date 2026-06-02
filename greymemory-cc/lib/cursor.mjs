// Per-session UUID watermark — lets a Stop hook that re-reads a growing transcript
// process only the entries appended since last capture. This is the client-side half of
// "don't reprocess"; the library's planned `dedupBySession` is the server-side safety net.
import fs from "node:fs";
import path from "node:path";
import { readJsonl } from "./io.mjs";

const trackerDir = (dataDir) => path.join(dataDir, "trackers");
const trackerFile = (dataDir, sessionId) => path.join(trackerDir(dataDir), `${sessionId}.txt`);

/**
 * Return the conversational entries appended after the stored watermark, plus the uuid to
 * advance to. `lastUuid` is taken from the last CONVERSATIONAL entry with a stable uuid —
 * never a trailing bookkeeping line (queue-operation, ai-title, …) that may lack a uuid or
 * get rewritten.
 */
export function readNewEntries(transcriptPath, sessionId, dataDir) {
  const all = readJsonl(transcriptPath);

  let cursor = null;
  try {
    cursor = fs.readFileSync(trackerFile(dataDir, sessionId), "utf8").trim() || null;
  } catch { /* no tracker yet */ }

  let startIdx = 0;
  if (cursor) {
    const i = all.findIndex((e) => e.uuid === cursor);
    if (i >= 0) startIdx = i + 1; // everything AFTER the watermark
  }

  const entries = all
    .slice(startIdx)
    .filter((e) => e.type === "user" || e.type === "assistant");

  let lastUuid = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].uuid) { lastUuid = entries[i].uuid; break; }
  }

  return { entries, lastUuid };
}

/** Persist the watermark. No-op if uuid is falsy. */
export function advanceCursor(sessionId, uuid, dataDir) {
  if (!uuid) return;
  fs.mkdirSync(trackerDir(dataDir), { recursive: true });
  fs.writeFileSync(trackerFile(dataDir, sessionId), uuid);
}
