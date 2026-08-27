# Cline / Continue / Opencode MCP Configuration

**File Location:** `cline_mcp.json` or `.continue/config.json` (depends on client, usually at the global or project root)

```json
{
  "mcpServers": {
    "slm-gate": {
      "command": "node",
      "args": [
        "<ABS_PATH>/dist/mcp-gate/index.js"
      ],
      "env": {
        "TLS_ADAPTER": "on",
        "DOWNSTREAM_MCP": "{\"command\":\"node\",\"args\":[\"<ABS_PATH_TO_TLS>/dist/mcp-server.mjs\"]}",
        "CLOUD_API_KEY": "${CLOUD_API_KEY}"
      }
    }
  }
}
```

After adding this, restart/refresh MCP servers and verify with `slm-gate doctor`.
