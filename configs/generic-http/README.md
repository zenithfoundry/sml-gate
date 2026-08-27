# Generic HTTP MCP Configuration

For clients that connect via SSE/HTTP. Ensure you are running `slm-gate serve --layer mcp --transport http` in the background. Note: HTTP connections do not launch the process themselves, so you must start it manually.

**File Location:** Depends on your MCP client's configuration schema.

```json
{
  "mcpServers": {
    "slm-gate": {
      "url": "http://localhost:8788/sse",
      "serverUrl": "http://localhost:8788/sse"
    }
  }
}
```

After adding this, restart/refresh MCP servers and verify with `slm-gate doctor`.
