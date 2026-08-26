# Antigravity Configuration

Antigravity stores its MCP configuration in `~/.gemini/config/mcp_config.json`.

Update the configuration file to include `slm-gate`. Note that Antigravity uses `serverUrl` for HTTP endpoints and `command` for stdio.

### Stdio Configuration (Recommended)

```json
{
  "mcpServers": {
    "slm-gate": {
      "command": "node",
      "args": [
        "/absolute/path/to/small-language-model-gate/dist/mcp-gate/index.js"
      ]
    }
  }
}
```

### HTTP Configuration

If you're running the gate over HTTP (by passing `--transport http` to `serve`):

```json
{
  "mcpServers": {
    "slm-gate": {
      "serverUrl": "http://localhost:8788/mcp"
    }
  }
}
```

## Next Steps

1. Copy the `.env.16gb.example` or `.env.24gb.example` file to your project root as `.env`.
2. Configure your local models.
3. Restart Antigravity or trigger a tools reload.
