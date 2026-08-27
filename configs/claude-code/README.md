# Claude Code MCP Configuration

**File Location:** `.mcp.json` (in your project root)

You can add this manually, or run the following one-liner (Note: on Windows, use `cmd /c` to run this properly if not in bash):

```bash
claude mcp add-json slm-gate '{"command":"node","args":["<ABS_PATH>/dist/mcp-gate/index.js"],"env":{"TLS_ADAPTER":"on","DOWNSTREAM_MCP":"{\\"command\\":\\"node\\",\\"args\\":[\\"<ABS_PATH_TO_TLS>/dist/mcp-server.mjs\\"]}","CLOUD_API_KEY":"${CLOUD_API_KEY}"}}'
```

Alternatively, here is the raw JSON:

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
