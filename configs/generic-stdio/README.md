# Generic Stdio Configuration

If your client supports MCP over standard input/output (stdio), you can configure `slm-gate` as follows:

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

## Next Steps

1. Copy the `.env.16gb.example` or `.env.24gb.example` file to your project root as `.env`.
2. Configure your local models.
3. Restart your MCP client.
