# Generic HTTP Configuration

If you're running `mcp-gate` as an HTTP server (`slm-gate serve --layer mcp --transport http`), you can connect any HTTP-compatible MCP client:

```json
{
  "mcpServers": {
    "slm-gate": {
      "url": "http://localhost:8788/mcp"
    }
  }
}
```
*(Note: Some clients, like Antigravity, use `serverUrl` instead of `url`)*

## Next Steps

1. Copy the `.env.16gb.example` or `.env.24gb.example` file to your project root as `.env`.
2. Configure your local models.
3. Restart your MCP client.
