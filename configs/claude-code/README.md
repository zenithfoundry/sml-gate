# Claude Code Configuration

To connect `small-language-model-gate` (mcp-gate) to Claude Code, you need to add it as an MCP server.

Run the following command in your terminal to register the server:

```bash
claude mcp add-json slm-gate '{"command":"node","args":["/absolute/path/to/small-language-model-gate/dist/mcp-gate/index.js"]}'
```

> [!NOTE] 
> **Windows Users**: You may need to prepend `cmd /c` to the command if running on Windows.

## LLM-Gate Setup

If you want to use `llm-gate` to route Claude Code's LLM requests, you must set the `ANTHROPIC_BASE_URL` environment variable to point to `http://localhost:8787` before starting Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
```

> [!WARNING]
> **Tool Search Limitation & Why You Should NOT Force It On**
> 
> Setting a custom `ANTHROPIC_BASE_URL` routes Claude Code through `llm-gate`, which disables Claude Code's native **Tool Search**.
> 
> **Do NOT use workarounds like `ENABLE_TOOL_SEARCH=true` with your SLM gate.**
> Anthropic's Tool Search is designed for Claude 3.5's 200k context window. Forcing it into an SLM leads to:
> 1. **Context Exhaustion:** Background tool catalogs and discovery prompts bloat the SLM's context.
> 2. **Tool Confusion (Hallucinations):** Small models struggle with large catalogs of tools and will hallucinate parameters or invoke wrong functions.
> 
> **The SLM Benefit:** Losing Tool Search is advantageous for SLMs. Sticking to a small, curated set of tools keeps the SLM fast, focused, and accurate.

## SLM Best Practices: Tightly Curated Tools

Because you are routing requests to an SLM, use the **manual curation method**:

* **Keep the Tool Count Low:** Provide only the 2 to 4 tools needed for the task. If it only has a few options, its accuracy in calling them correctly goes up significantly.
* **Use Project-Specific Configs:** Instead of adding tools globally (which forces Claude Code to load them into the prompt for *every* conversation), define them locally per project via `.claude.json`:

```json
{
  "mcpServers": {
    "local-file-reader": {
      "command": "npx",
      "args": ["-y", "some-file-reading-tool"]
    },
    "tech-lead-stack": {
      "command": "node",
      "args": ["/absolute/path/to/ai.tech-lead-stack/dist/mcp-server.mjs"]
    }
  }
}
```

By manually adding and removing tools based on the specific folder you are working in, you keep the SLM's context clean, focused, and fast.

## Next Steps

1. Copy the `.env.16gb.example` or `.env.24gb.example` file to your project root as `.env`.
2. Configure your local models.
3. Start the MCP server via Claude.
