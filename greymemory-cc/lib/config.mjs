// User configuration for greymemory-cc.
//
// Default behaviour is CONVERSATIONAL capture (tool plumbing dropped). The user OPTS IN to
// coding-agent capture by naming the tools whose calls should be folded into memory --
// mirroring Supermemory's captureTools allowlist (Edit/Write/Bash/Task).
//
// Knobs (all optional):
//   captureTools        string[]  tool names to capture (coding-agent mode). Default [] (off).
//   maxContextMemories  int       memories searched + injected per prompt. Default 8.
//   maxProfileItems     int       profile lines injected at SessionStart. Default 0 = all.
//
// Resolution (lowest -> highest priority):
//   1. defaults
//   2. <dataDir>/settings.json   { "captureTools": [...], "maxContextMemories": 8, "maxProfileItems": 0 }
//   3. env: GREYMEMORY_CAPTURE_TOOLS=Edit,Write,Bash,Task ("off"/"none"/"" disables),
//           GREYMEMORY_MAX_CONTEXT_MEMORIES=8, GREYMEMORY_MAX_PROFILE_ITEMS=0
import fs from "node:fs";
import path from "node:path";

const DEFAULTS = { captureTools: [], maxContextMemories: 8, maxProfileItems: 0 };

const parseList = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);
const parseIntOr = (v, fallback) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** Load user config for a data dir. Best-effort: a missing/malformed settings.json is ignored. */
export function loadConfig(dataDir) {
  const cfg = { ...DEFAULTS };

  try {
    const json = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));
    if (Array.isArray(json.captureTools)) {
      cfg.captureTools = json.captureTools.filter((x) => typeof x === "string");
    }
    if (Number.isInteger(json.maxContextMemories) && json.maxContextMemories >= 0) {
      cfg.maxContextMemories = json.maxContextMemories;
    }
    if (Number.isInteger(json.maxProfileItems) && json.maxProfileItems >= 0) {
      cfg.maxProfileItems = json.maxProfileItems;
    }
  } catch { /* no / invalid settings.json -> keep defaults */ }

  const ct = process.env.GREYMEMORY_CAPTURE_TOOLS;
  if (ct != null) cfg.captureTools = /^(off|none|false)?$/i.test(ct.trim()) ? [] : parseList(ct);
  if (process.env.GREYMEMORY_MAX_CONTEXT_MEMORIES != null) {
    cfg.maxContextMemories = parseIntOr(process.env.GREYMEMORY_MAX_CONTEXT_MEMORIES, cfg.maxContextMemories);
  }
  if (process.env.GREYMEMORY_MAX_PROFILE_ITEMS != null) {
    cfg.maxProfileItems = parseIntOr(process.env.GREYMEMORY_MAX_PROFILE_ITEMS, cfg.maxProfileItems);
  }

  return cfg;
}
