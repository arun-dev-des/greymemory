// User configuration for greymemory-cc.
//
// Default behaviour is CONVERSATIONAL capture (tool plumbing dropped). The user OPTS IN to
// coding-agent capture by naming the tools whose results should be folded into memory --
// mirroring Supermemory's captureTools allowlist (Edit/Write/Bash/Task).
//
// Resolution (lowest -> highest priority):
//   1. defaults                            -> captureTools: []   (off)
//   2. <dataDir>/settings.json             -> { "captureTools": ["Edit","Write","Bash","Task"] }
//   3. env GREYMEMORY_CAPTURE_TOOLS=Edit,Write,Bash,Task
//        (comma-separated; "off" / "none" / "" explicitly disables, overriding settings.json)
import fs from "node:fs";
import path from "node:path";

const DEFAULTS = { captureTools: [] };

const parseList = (s) => String(s).split(",").map((x) => x.trim()).filter(Boolean);

/** Load user config for a data dir. Best-effort: a missing/malformed settings.json is ignored. */
export function loadConfig(dataDir) {
  const cfg = { ...DEFAULTS };

  try {
    const json = JSON.parse(fs.readFileSync(path.join(dataDir, "settings.json"), "utf8"));
    if (Array.isArray(json.captureTools)) {
      cfg.captureTools = json.captureTools.filter((x) => typeof x === "string");
    }
  } catch { /* no / invalid settings.json -> keep defaults */ }

  const env = process.env.GREYMEMORY_CAPTURE_TOOLS;
  if (env != null) {
    cfg.captureTools = /^(off|none|false)?$/i.test(env.trim()) ? [] : parseList(env);
  }

  return cfg;
}
