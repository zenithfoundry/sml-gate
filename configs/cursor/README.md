# Cursor Configuration

Cursor uses a `.cursor/mcp.json` file to manage MCP servers.

Create or update the `.cursor/mcp.json` file in your workspace:

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

## LLM-Gate Setup

If you are using `llm-gate` to intercept Cursor's model calls:
1. Go to Cursor Settings > Models.
2. Override the Base URL to `http://localhost:8787`.
3. Provide a dummy API key if required by the UI.

## Next Steps

1. Copy the `.env.16gb.example` or `.env.24gb.example` file to your project root as `.env`.
2. Configure your local models.
3. Reload Cursor to apply the new MCP server.
