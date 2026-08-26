# Claude Code Configuration

To connect `small-language-model-gate` (mcp-gate) to Claude Code, you need to add it as an MCP server.

Run the following command in your terminal to register the server:

```bash
claude mcp add-json slm-gate '{"command":"node","args":["/absolute/path/to/small-language-model-gate/dist/mcp-gate/index.js"]}'
```

> [!NOTE] 
> **Windows Users**: You may need to prepend `cmd /c` to the command if running on Windows.

## LLM-Gate Setup

If you want to use `llm-gate` to route Claude Code's LLM requests, you must set the `ANTHROPIC_BASE_URL` environment variable to point to `http://localhost:8787` before starting Claude Code.

```bash
export ANTHROPIC_BASE_URL=http://localhost:8787
```

> [!WARNING]
> **Tool Search Limitation (Please Read)**
> Setting a custom `ANTHROPIC_BASE_URL` changes where Claude Code gets its "brainpower," which currently disables a native feature called **Tool Search**. 
> 
> **What does this mean for me?**
> * **What are Tools?** Tools are the abilities Claude Code uses to interact with your computer (like reading files, running terminal commands, or editing code).
> * **What is Tool Search?** Normally, Claude Code has a feature that lets it dynamically search for and discover new tools when it gets stuck on a complex problem.
> * **Why does it break?** By using `llm-gate` and changing the `ANTHROPIC_BASE_URL`, you are routing Claude Code through a custom local server instead of Anthropic's official servers. Because of this detour, Claude Code automatically disables its native Tool Search feature. 
> 
> **The Benefit for SLMs:** You gain the flexibility to route LLM requests through your own setup (`llm-gate`). More importantly, for Small Language Models, losing Tool Search is actually a **benefit**. SLMs struggle with huge context windows (Context Exhaustion) and can easily get confused when presented with hundreds of tools at once (Tool Hallucinations). Sticking to the standard tools Claude Code already has loaded keeps the SLM fast, focused, and accurate.

## SLM Best Practices: Tightly Curated Tools

Because you are routing requests to an SLM, you want to stick exclusively to the **Manual Method** of managing tools. You need to act as the "search engine" by curating the exact tools the SLM has access to, especially when working with external tools like the `tech-lead-stack` (TLS).

Here is how to optimize Claude Code to play nicely with your SLM:

* **Keep the Tool Count Low:** Only give the SLM the 2 to 4 tools it absolutely needs for the current task. If it only has a few options, its accuracy in calling them correctly goes up significantly.
* **Use Project-Specific Configs:** Instead of adding tools globally (which forces Claude Code to load them into the prompt for *every* conversation), define tools locally.

Create a `.claude.json` file in your specific project directory to manually configure tools just for that project:

```json
{
  "mcpServers": {
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
