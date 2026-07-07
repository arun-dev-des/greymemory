---
description: Forget (soft-delete) a memory matching a query
allowed-tools: Bash(node:*)
---

Forget the memory best matching: "$ARGUMENTS"

Run:

```
node ${CLAUDE_PLUGIN_ROOT}/mcp/forget-cli.mjs "$ARGUMENTS"
```

Report which memory was forgotten, or that none matched. This is a soft-delete: the row is
excluded from all future results but preserved in the DB for audit.
