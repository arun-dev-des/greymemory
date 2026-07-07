#!/usr/bin/env node
// Stdio MCP server: lets Claude ACTIVELY query/save memory (hooks are passive capture).
// Reuses lib/memory.mjs so it reads/writes the SAME per-project DB as the hooks. Handlers are
// registered with the SDK's request SCHEMAS (the older setRequestHandler("tools/list", ...)
// string form registers nothing on current SDK versions and leaves the tools dead).
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import os from "node:os";
import path from "node:path";
import { getMemory } from "../lib/memory.mjs";
import { resolveContainer } from "../lib/container.mjs";

const cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const dataDir =
  process.env.GREYMEMORY_DATA ||
  process.env.CLAUDE_PLUGIN_DATA ||
  path.join(os.homedir(), ".greymemory-cc");
const container = process.env.GREYMEMORY_CONTAINER || resolveContainer(cwd, dataDir);

const TOOLS = [
  {
    name: "grey_search",
    description:
      "Search this project's greymemory for relevant past memories (facts, preferences, episodes).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query" },
        topN: { type: "number", description: "Max results (default 8)" },
      },
      required: ["query"],
    },
  },
  {
    name: "grey_add",
    description:
      "Save an explicit memory (decision, preference, fact) to this project's greymemory.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "The memory text to store" } },
      required: ["text"],
    },
  },
  {
    name: "grey_profile",
    description:
      "Return this project's static + dynamic memory profile (preferences and recent facts).",
    inputSchema: {
      type: "object",
      properties: { q: { type: "string", description: "Optional query to focus the profile" } },
    },
  },
];

const renderResults = (results) =>
  results
    .map((r) => {
      const text = r.memory ?? r.chunk;
      return text ? `- (${r.memory_type ?? "context"}) ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");

const server = new Server(
  { name: "claude-greymemory", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  try {
    const memory = await getMemory({ cwd, container, dataDir });

    if (name === "grey_search") {
      const results = await memory.search(args.query, { topN: args.topN ?? 8 });
      const text = results.length ? renderResults(results) : "No matching memories.";
      return { content: [{ type: "text", text }] };
    }

    if (name === "grey_add") {
      const res = await memory.add([{ role: "user", content: args.text }]);
      return {
        content: [{ type: "text", text: `Stored ${res.factsStored} memories (${res.chunksStored} chunks).` }],
      };
    }

    if (name === "grey_profile") {
      const { profile } = await memory.getProfile(args.q ? { q: args.q } : {});
      const text =
        [...(profile.static ?? []), ...(profile.dynamic ?? [])].map((l) => `- ${l}`).join("\n") ||
        "Empty profile.";
      return { content: [{ type: "text", text }] };
    }

    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  } catch (err) {
    return { content: [{ type: "text", text: `greymemory error: ${err?.message}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
