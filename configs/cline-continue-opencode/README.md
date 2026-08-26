# Cline / Continue / OpenCode Configuration

These clients typically manage MCP configurations in a central `mcp_settings.json` or similar configuration file (e.g., `~/.config/cline/mcp_settings.json`).

Update the configuration file to include `slm-gate`:

```json
{
  "mcpServers": {
    "slm-gate": {
      "command": "node",
      "args": [
        "/absolute/path/to/small-language-model-gate/dist/mcp-gate/index.js"
      ],
      "env": {}
    }
  }
}
```

## LLM-Gate Setup

To use `llm-gate` as the primary LLM provider for these clients:
1. In the client's provider settings, select "OpenAI Compatible" or custom endpoint.
2. Set the Base URL to `http://localhost:8787`.
3. Provide any dummy API key if required.

## Next Steps

1. Copy the `.env.16gb.example` or `.env.24gb.example` file to your project root as `.env`.
2. Configure your local models.
3. Restart the client extension.
