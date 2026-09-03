# small-language-model-gate

[![CI](https://github.com/bronz3beard/small-language-model-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/bronz3beard/small-language-model-gate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](tsconfig.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/bronz3beard/small-language-model-gate/pulls)

`small-language-model-gate` (CLI: `slm-gate`) is a local AI routing and pre-processing layer designed to intercept easy, repetitive tasks with a small, free local model before they hit your expensive subscription or API-based cloud model. By compressing context, resolving simple prompts locally, and metering API usage, it dramatically reduces your cloud usage and protects your monthly quota.

> [!NOTE]
> **Related project — **Tech-Lead-Stack** — an agent-agnostic library of Markdown "skills" plus an MCP
> server that turns Claude, Gemini, or GPT into a full software-delivery team (planning,
> building, review, security, release), organized around a nine-phase lifecycle. Its
> self-correcting Reflexion loop grades implementation plans against four engineering
> pillars before any code is written.**
>
> <a href="https://github.com/bronz3beard/ai.tech-lead-stack" target="_blank" rel="noopener noreferrer">Explore tech-lead-stack on GitHub →</a>


## Intended Use

This software runs locally and drives third-party AI tools and models that **you** install and
authenticate. You are responsible for complying with the terms of any tool, model, or subscription
you connect to it. It is designed for single-user, local use with your own accounts; it does not
proxy or share third-party credentials between users. Provided "as is" under the MIT License,
without warranty of any kind.

## Prerequisites

- **Ollama**: This project does not ship or maintain an install script for Ollama, as system dependencies vary. Please install Ollama from [ollama.com](https://ollama.com/) and ensure it is running at `http://localhost:11434`.
- **Local Models**: You must manually pull the models suitable for your system's RAM. Refer to [Appendix C: RAM-by-Machine Model Table](#appendix-c-ram-by-machine-model-table) to choose your `SLM_BRAIN_MODEL` and `SLM_GATE_MODEL`.
  - _Example:_ `ollama pull qwen3.5:0.5b`

> **Architectural Warning for Contributors:** This project strictly uses **Native Structured Outputs** (`format: jsonSchema` / `response_format: { type: "json_schema" }`) for all deterministic agentic logic. Do **NOT** use prompt engineering to request JSON in markdown blocks or use regex extraction. Doing so causes severe rambling and timeout flakes on Apple Silicon (`llama.cpp`) due to models failing to emit stop tokens.

## The Two Cloud Models

This tool distinguishes explicitly between two different downstream LLM layers you might use:

1. **Subscription Model (Your Editor):**
   - This is the model you pay a flat monthly or per-seat subscription for (e.g., **Claude Pro / Max / Team / Enterprise** in Claude Code & Claude Desktop, **Google One AI Premium / Gemini Advanced / Antigravity**, **Cursor Pro / Pro+ / Teams / Enterprise**, **GitHub Copilot Individual / Business / Enterprise**, or **ChatGPT Plus / Pro / Team / Enterprise** in Cline / Continue).
   - `slm-gate` intercepts prompts bound for this model, compresses them, and answers basic tool usages locally to save you quota and turns. This usage is _not_ dollar-metered because you already pay a flat fee.
2. **API Model (Metered):**
   - A pay-per-token endpoint you define via `CLOUD_*` environment variables.
   - Used as a fallback when `llm-gate` encounters a complex prompt that the local model cannot confidently handle. Cost is metered to the penny in the local ledger.

---

## Quick Starts

### 1. `mcp-gate` in front of Tech-Lead-Stack (Primary, Subscription-Friendly Path)

This path sits between your IDE and the tech-lead-stack server. It intercepts tool payloads (like `read_file` or `execute_command`) and condenses them, meaning your Editor's subscription model receives far less token spam.

1. Install tech-lead-stack and compile it (`pnpm run mcp:build`).
2. Run `slm-gate serve --layer mcp`.
3. In your `.env`, set `TLS_ADAPTER=on` and point `DOWNSTREAM_MCP` to the TLS build path.
4. Add `slm-gate` to your editor (see `configs/` for client-specific snippets).

### 2. Standalone `mcp-gate` (Condition Prompt Only)

If you don't use tech-lead-stack, you can still use `mcp-gate` as a standalone MCP server that exposes a single `condition_prompt` tool.

1. Leave `DOWNSTREAM_MCP` blank in your `.env`.
2. Run `slm-gate serve --layer mcp`.
3. Add `slm-gate` as an MCP server to your editor.

### 3. `llm-gate` (Model Endpoint Override)

For clients that allow overriding the base URL of the model itself (like Cursor, Cline, or Claude Code via `ANTHROPIC_BASE_URL`), `llm-gate` can intercept the chat stream.

1. Run `slm-gate serve --layer llm`.
2. Set your editor's API Base URL to `http://localhost:8787`.
3. `llm-gate` will answer easy questions locally and route hard ones to your `CLOUD_MODEL`.

---

## Client Compatibility Matrix

Understanding which layer to use with your editor:

- **Layer 1 (`mcp-gate`)**: Operates as a **Model Context Protocol (MCP) server** between your client and downstream tools/skills. It intercepts large tool responses, skills, and prompts, running a small local SLM to compress and distill them before they enter your editor's context window.
- **Layer 2 (`llm-gate`)**: Operates as a **local LLM proxy server** (OpenAI and Anthropic API compatible) listening on `http://localhost:8787`. Your client points its model base URL at it; `llm-gate` answers easy questions locally for free and only routes complex tasks to your paid cloud model.

| Client               | Layer 1 (`mcp-gate`) | Layer 2 (`llm-gate`) | Notes & Key References                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| :------------------- | :------------------: | :------------------: | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Antigravity**      |     ✅ Supported     |    ❌ Unsupported    | **Layer 1:** Configured via `~/.gemini/config/mcp_config.json` (stdio/HTTP) to compress tool & skill payloads.<br>**Layer 2:** Unsupported because Antigravity uses a locked internal Gemini routing pipeline with no user-configurable base URL override.<br>📚 _References:_ [Antigravity MCP Documentation](https://antigravity.google/docs/mcp/) • [MCP Protocol Spec](https://modelcontextprotocol.io/)                                                                                                                       |
| **Claude Code**      |     ✅ Supported     |     ✅ Supported     | **Layer 1:** Added via `.mcp.json` or `claude mcp add-json`.<br>**Layer 2:** Enabled by exporting `ANTHROPIC_BASE_URL=http://localhost:8787`. _Note:_ Pointing to a custom base URL causes Claude Code to disable server-side MCP Tool Search (it inlines tool schemas instead).<br>📚 _References:_ [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp) • [Claude Code Env Vars](https://code.claude.com/docs/en/env-vars) • [Tool Search Guide](https://code.claude.com/docs/en/agent-sdk/tool-search)                   |
| **Cursor**           |     ✅ Supported     |     ✅ Supported     | **Layer 1:** Configured via `.cursor/mcp.json` or Cursor Settings > MCP.<br>**Layer 2:** Enabled under Cursor Settings > Models by checking "Override OpenAI Base URL" (`http://localhost:8787/v1`) with a custom API key.<br>📚 _References:_ [Cursor Models Settings & Base URL](https://forum.cursor.com/t/openai-api-and-override-base-url-values/148140) • [LiteLLM Cursor Integration](https://docs.litellm.ai/docs/tutorials/cursor_integration)                                                                            |
| **Cline / Continue** |     ✅ Supported     |     ✅ Supported     | **Layer 1:** Added via `cline_mcp.json` or `.continue/config.yaml`.<br>**Layer 2:** Full native support for custom OpenAI-compatible providers (`apiBase: http://localhost:8787/v1`).<br>📚 _References:_ [Cline OpenAI Provider](https://docs.cline.bot/provider-config/openai-compatible) • [Continue Custom Base URL](https://docs.continue.dev/customize/model-providers/top-level/openai) • [Continue MCP Guide](https://docs.continue.dev/customize/deep-dives/mcp)                                                          |
| **Claude Desktop**   |     ✅ Supported     |    ❌ Unsupported    | **Layer 1:** Configured via `claude_desktop_config.json` using local `stdio` transport.<br>**Layer 2:** Unsupported because Claude Desktop connects strictly to Anthropic's hosted API with no endpoint override setting.<br>📚 _References:_ [Anthropic Local MCP on Claude Desktop](https://support.anthropic.com/en/articles/10949351-getting-started-with-model-context-protocol-mcp-on-claude-for-desktop) • [MCP Connect Local Servers Guide](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers) |

---

### Client Setup & Compatibility Deep Dive

#### 1. Google Antigravity

- **Beginner Summary:** Google Antigravity connects directly to external tools using the open Model Context Protocol standard. You can add `slm-gate` as an MCP server to automatically shrink bulky tool outputs and skills before they reach the model.
- **Why Layer 1 Works:** Antigravity reads MCP server definitions from `~/.gemini/config/mcp_config.json` (globally) or `.agents/mcp_config.json` (workspace-level). `mcp-gate` runs as a standard stdio/HTTP MCP proxy.
- **Why Layer 2 is Blocked:** Antigravity manages its own internal inference engine (Gemini 3.7 / Cloud) and does not provide an option to redirect chat completions to a custom HTTP proxy URL.
- **Config Template:** See [`configs/antigravity/README.md`](file:///Users/bz3b/Desktop/repos/small-language-model-gate/configs/antigravity/README.md).
- **Official Docs:** [Google Antigravity MCP Guide](https://antigravity.google/docs/mcp/)

#### 2. Claude Code

- **Beginner Summary:** Anthropic's CLI agent (`claude`) allows configuring both external MCP tools and overriding the main Anthropic API endpoint.
- **Why Layer 1 Works:** Claude Code supports project-level and global MCP configuration via `.mcp.json` or the CLI command `claude mcp add-json slm-gate '{...}'`.
- **Why Layer 2 Works (and the Tool Search caveat):** You can redirect all model calls to `llm-gate` by setting `export ANTHROPIC_BASE_URL="http://localhost:8787"`. When `ANTHROPIC_BASE_URL` points to a non-Anthropic endpoint, Claude Code automatically falls back from server-side Tool Search (`tool_reference` blocks) to inlining tool schemas in context.
- **Config Template:** See [`configs/claude-code/README.md`](file:///Users/bz3b/Desktop/repos/small-language-model-gate/configs/claude-code/README.md).
- **Official Docs:** [Claude Code MCP Docs](https://code.claude.com/docs/en/mcp) | [Claude Code Environment Variables](https://code.claude.com/docs/en/env-vars)

#### 3. Cursor

- **Beginner Summary:** Cursor is an AI-first IDE that supports custom MCP servers and lets you route AI requests through your own custom API proxy endpoint.
- **Why Layer 1 Works:** Add `slm-gate` to `.cursor/mcp.json` in your workspace or project root.
- **Why Layer 2 Works:** In Cursor, navigate to **Settings > Models**, enable **Override OpenAI Base URL**, and set it to `http://localhost:8787/v1`. All Chat and Composer queries will route through `llm-gate`, resolving simple tasks locally and forwarding hard tasks to your cloud API model.
- **Config Template:** See [`configs/cursor/README.md`](file:///Users/bz3b/Desktop/repos/small-language-model-gate/configs/cursor/README.md).
- **Official Docs:** [Cursor Custom Models & Base URL Forum Guide](https://forum.cursor.com/t/openai-api-and-override-base-url-values/148140)

#### 4. Cline & Continue

- **Beginner Summary:** Both Cline and Continue are open-architecture VS Code / JetBrains extensions designed for full provider and tool flexibility.
- **Why Layer 1 Works:** Both extensions support MCP server definitions (e.g., in `cline_mcp.json` or `.continue/config.yaml`).
- **Why Layer 2 Works:** Select the **OpenAI-Compatible** provider in Cline/Continue settings and enter `http://localhost:8787/v1` as the Base URL (`apiBase`).
- **Config Template:** See [`configs/cline-continue-opencode/README.md`](file:///Users/bz3b/Desktop/repos/small-language-model-gate/configs/cline-continue-opencode/README.md).
- **Official Docs:** [Cline OpenAI-Compatible Settings](https://docs.cline.bot/provider-config/openai-compatible) | [Continue Configuration Reference](https://docs.continue.dev/customize/model-providers/top-level/openai)

#### 5. Claude Desktop

- **Beginner Summary:** Anthropic's official desktop application supports local MCP tool integrations via stdio, but locks its core chat model to Anthropic's cloud.
- **Why Layer 1 Works:** Add `slm-gate` to your `claude_desktop_config.json` (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows).
- **Why Layer 2 is Blocked:** Claude Desktop is strictly bound to Anthropic's hosted infrastructure and provides no setting or environment variable to redirect its chat stream to a local endpoint proxy.
- **Config Template:** See [`configs/claude-desktop/README.md`](file:///Users/bz3b/Desktop/repos/small-language-model-gate/configs/claude-desktop/README.md).
- **Official Docs:** [Anthropic Desktop MCP Setup](https://support.anthropic.com/en/articles/10949351-getting-started-with-model-context-protocol-mcp-on-claude-for-desktop)

---

## Verification & Day-to-Day Use (All Clients)

**Cloud API Keys:**
When using `mcp-gate` (Layer 1) alongside your IDE's built-in subscription tier (e.g., **Claude Pro / Max / Team / Enterprise**, **Google One AI Premium / Gemini Advanced / Antigravity**, **Cursor Pro / Pro+ / Teams / Enterprise**, **GitHub Copilot Individual / Business / Enterprise**, or **ChatGPT Plus / Pro / Team / Enterprise**), you **do not** need a `CLOUD_API_KEY` in your `.env`. The `CLOUD_*` variables are only required if you use Layer 2 (`llm-gate`) or run the offline testing harness (`slm-gate bench`). For Layer 1, the proxy relies 100% on the local Ollama models (`SLM_BRAIN_MODEL` and `SLM_GATE_MODEL`) to compress and filter payloads before they reach your editor. You can safely leave the cloud keys blank.

**Build Readiness:**
Out of the box (or after running `pnpm run test:e2e`), the build script runs automatically and `/dist/mcp-gate/index.js` is ready to use. _Note: If you modify the `.ts` source files, you must run `pnpm run build` again so your connected clients pick up the changes._

**How to verify the bridge is working day-to-day:**

1. **Ledger Metrics (Universal):** Run `pnpm run slm-gate metrics` in your terminal anytime. Because `LEDGER_PATH` is set, every interception is recorded, showing exactly how many tokens the SLM stripped out.
2. **Visual Clues (Universal):** When your client triggers a tool (like `get_skill`), the returned payload in the editor will be drastically shorter, but it will still explicitly contain the mandatory guidelines (e.g., lines starting with `MUST`, or YAML frontmatter).
3. **MCP Server Logs (Client-Specific):** Look for `[pipeline] distill` in your client's MCP logs to confirm the local model is actively processing payloads:
   - **Antigravity:** View the internal MCP logs via the Antigravity output tab.
   - **Cursor:** Open the Output panel (`Ctrl/Cmd+Shift+U`) and select "MCP" or "Cursor" from the dropdown.
   - **Claude Desktop:**
     - Mac: `tail -f ~/Library/Logs/Claude/mcp*.log`
     - Windows: `type "%APPDATA%\Claude\logs\mcp*.log"`
   - **Cline / VSCode:** Open the VSCode Output panel and select the "Cline" extension or the specific MCP server from the dropdown.
   - **Claude Code:** Start Claude Code with the `--mcp-debug` flag to view detailed server communication in the terminal.

---

## Measurement & Telemetry

The core promise of this tool is **cost-at-equal-quality**.

To prove this, `small-language-model-gate` logs every decision to a local SQLite ledger (and optionally Langfuse). You can view the true impact at any time using:

```bash
pnpm run slm-gate metrics
```

This commands reads the local ledger and prints an offline comparison showing exactly how much quota/dollars you saved when the gate was ON vs OFF. It requires no API keys and is the source of truth for subscription users.

_(For developers wanting to run systematic benchmarks, see `harness/README.md` and use `slm-gate bench`. The harness evaluates `SLM_GATE_TESTING_MODEL`, defaulting to `SLM_GATE_MODEL`, and requires a funded `CLOUD_API_KEY`.)_

---

## No-Ollama / Cloud Fallback

If your machine cannot run Ollama, you can change `SLM_PROVIDER=openai` in your `.env`. This allows you to point `SLM_BRAIN_MODEL` and `SLM_GATE_MODEL` to a cheap, hosted model (e.g., `gpt-5.6-luna` or `gemini-1.5-flash`).

_Caveat: Because hosted "small" models still cost money and incur network latency, the deferral savings are significantly lower than running locally, though compression will still save tokens._

---

## Appendix C: RAM-by-Machine Model Table

Selecting the right local models is crucial for performance. As a rule of thumb, you should configure your `.env` models based on your available system RAM.

| RAM        | Recommended Presets | Example Brain Models               | Example Gate Models           |
| :--------- | :------------------ | :--------------------------------- | :---------------------------- |
| **4 GB**   | `ram-4`             | qwen3.5:1.5b, phi3:mini, gemma2:2b | qwen3.5:0.5b, tinyllama       |
| **8 GB**   | `ram-8`             | qwen3.5:3b, llama3.2:3b            | qwen3.5:0.5b, phi3:mini       |
| **16 GB**  | `ram-16`            | qwen3:7b, llama3:8b, mistral:7b    | qwen3:1.7b, phi3:mini         |
| **24 GB**  | `ram-24`            | qwen3.5:9b, qwen3:14b              | qwen2.5-coder:3b, llama3.2:3b |
| **32 GB**  | `ram-32`            | qwen3:14b, deepseek-coder:33b      | qwen3:1.7b, llama3:8b         |
| **64 GB**  | `ram-64`            | qwen3:32b, llama3:70b (Q4)         | qwen3:7b, mistral:7b          |
| **128 GB** | `ram-128`           | qwen3:72b, command-r-plus:104b     | qwen3:14b, llama3:8b          |

### Dual-Model Concurrency (`OLLAMA_MAX_LOADED_MODELS`)

When running different models for the Gate (e.g. 3B) and Brain (e.g. 9B), configure Ollama to keep both models in memory concurrently to eliminate model swapping latency:

```bash
# macOS (persistent)
launchctl setenv OLLAMA_MAX_LOADED_MODELS 2

# Linux / Terminal
export OLLAMA_MAX_LOADED_MODELS=2
```

> **Note on Hardware Limits:** When loading two models simultaneously, Ollama must allocate VRAM for both models' KV caches. On Apple Silicon, GPU memory allocation is strictly capped. If you experience models being evicted (one model unloading to make room for another), you must lower your `NUM_CTX` in your `.env`.
>
> - **24GB Mac**: `NUM_CTX=8192` is recommended to fit both models.
> - **16GB Mac**: `NUM_CTX=4096` is recommended to fit both models.

### ⚠️ RAM Troubleshooting & Sizing Disclaimer: What to do if your RAM config is not working

If you experience high memory pressure, models being evicted (one model constantly unloading to make room for another), sluggish system responsiveness, or out-of-memory errors, the following **MUST** be considered:

#### The Memory Formula
```text
Memory = Model Weights + (NUM_CTX × KV-Cache) × Models Loaded
```

**Dropping the brain model to a 7B is exactly the right lever, and yes it'll cut RAM. But don't just hand-edit `NUM_CTX` to a smaller number and call it done — memory is model weights + (`NUM_CTX` × KV-cache) × models loaded.**

While this example shows dropping from a 9B (or 14B) model to a 7B model, this principle is a general rule that applies to all RAM capacities:

1. **Check your pulled tags:**
   ```bash
   ollama list        # see which qwen tags are pulled
   ```
2. **Pick a smaller brain:**
   e.g. `qwen2.5:7b` (pull it if needed: `ollama pull qwen2.5:7b`).
   Keep the small gate model (`qwen2.5-coder:3b`) as-is; it's already tiny (~2GB).
3. **Set it in your active environment (NOT just a template file):**
   - **For Antigravity:** The config Antigravity actually uses is the JSON block in `~/.gemini/config/mcp_config.json` (under `mcpServers.slm-gate.env`). The `.env.24gb.example` file is just a reference. Add these to your `slm-gate` → `env`:
     ```json
     "SLM_BRAIN_MODEL": "qwen2.5:7b",
     "SLM_GATE_MODEL": "qwen2.5-coder:3b",
     "OLLAMA_MAX_LOADED_MODELS": "2",
     "NUM_CTX": "4096"
     ```
   - **For Standalone / CLI / Stdio / HTTP:** Ensure these are in your active `.env` file or exported in your shell.
4. **Shrink `NUM_CTX`:**
   Lowering `NUM_CTX` from `8192` → `4096` is where a lot of the RAM savings actually comes from (the KV cache shrinks with it), and it's the single biggest knob after model size.
5. **Fallback to Single-Model Mode if still heavy:**
   If memory is still heavy, `OLLAMA_MAX_LOADED_MODELS="1"` forces one model in memory at a time (slower switching between gate and brain, but uses much less RAM).
6. **Confirm exact variable names:**
   Verify against `configs/antigravity/.env.24gb.example` that the gate reads:
   - `SLM_BRAIN_MODEL`
   - `SLM_GATE_MODEL`
   - `SLM_GATE_TESTING_MODEL`
   - `NUM_CTX`
   - `OLLAMA_MAX_LOADED_MODELS`
7. **Use doctor to sanity-check:**
   Run `slm-gate doctor` to sanity-check the fit for your RAM:
   ```bash
   pnpm run dev doctor   # or: node dist/cli.js doctor
   ```

_Note: You must pull these models via `ollama pull <model_name>` before running `slm-gate serve`. Run `slm-gate doctor` to verify your environment!_
