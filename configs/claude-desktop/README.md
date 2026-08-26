# Claude Desktop Configuration

Claude Desktop manages MCP servers via its configuration file, typically located at `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows.

> [!IMPORTANT]
> Claude Desktop only supports the `stdio` transport.

Update the configuration file to include `slm-gate`:

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
3. Restart the Claude Desktop application.
