#!/usr/bin/env node
// Backs the /grey-forget command. forget() is destructive (soft-delete), so it is kept OFF
// the MCP surface (Claude can't auto-invoke it) and run manually via this CLI.
//   usage: node forget-cli.mjs <query words...>
import os from "node:os";
import path from "node:path";
import { getMemory } from "../lib/memory.mjs";
import { resolveContainer } from "../lib/container.mjs";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  process.stderr.write("usage: forget-cli.mjs <query>\n");
  process.exit(1);
}

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const dataDir =
  process.env.GREYMEMORY_DATA ||
  process.env.CLAUDE_PLUGIN_DATA ||
  path.join(os.homedir(), ".greymemory-cc");
const container = process.env.GREYMEMORY_CONTAINER || resolveContainer(cwd, dataDir);

const memory = await getMemory({ cwd, container, dataDir });
const forgotten = await memory.forget(query);
console.log(forgotten ? `Forgot: ${forgotten}` : "No matching memory found.");
process.exit(0);
