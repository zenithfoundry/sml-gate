# Antigravity MCP Configuration

Antigravity requires you to configure MCP servers in its global configuration file. Note that a REMOTE server (like HTTP) uses `serverUrl`, not `url`. Below is the configuration for `slm-gate` using `stdio`.

**File Location:** `~/.gemini/config/mcp_config.json`

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

After adding this, make sure to build TLS first by running `pnpm run mcp:build` in your TLS directory, then restart/refresh MCP servers and verify with `slm-gate doctor`.
