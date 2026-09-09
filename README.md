# small-language-model-gate

[![CI](https://github.com/bronz3beard/small-language-model-gate/actions/workflows/ci.yml/badge.svg)](https://github.com/bronz3beard/small-language-model-gate/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![MCP Compatible](https://img.shields.io/badge/MCP-Compatible-green.svg)](https://modelcontextprotocol.io/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue.svg)](tsconfig.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/bronz3beard/small-language-model-gate/pulls)

`small-language-model-gate` (CLI: `slm-gate`) is a local AI routing and pre-processing layer designed to intercept easy, repetitive tasks with a small, free local model before they hit your expensive subscription or API-based cloud model. By compressing context, resolving simple prompts locally, and metering API usage, it dramatically reduces your cloud usage and protects your monthly quota.

> [!NOTE]
> **Related project **Tech-Lead-Stack** an agent-agnostic library of Markdown "skills" plus an MCP
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

`slm-gate` is downstream-agnostic. It works with **any** MCP server or toolbox (or none), and Tech-Lead-Stack is just one optional thing you can place behind it. Pick the path that matches how your editor connects:

### 1. `mcp-gate` in front of any MCP server (Primary, Subscription-Friendly Path)
This path sits between your IDE and **any** downstream MCP server. It intercepts tool payloads (like `read_file` or `execute_command`) and condenses them, so your editor's subscription model receives far less token spam. The downstream can be Tech-Lead-Stack, your own toolbox, or any third-party MCP server.

1. Have your downstream MCP server ready (its launch command or path).
2. Run `slm-gate serve --layer mcp`.
3. In your `.env`, point `DOWNSTREAM_MCP` at that server. Leave `TLS_ADAPTER=off` for a generic downstream (the distillation and compression apply to every downstream regardless).
4. Add `slm-gate` to your editor (see `configs/` for client-specific snippets).

> **Using Tech-Lead-Stack as the downstream?** It's fully optional, but if that's your setup: install and compile it first (`pnpm run mcp:build`), point `DOWNSTREAM_MCP` at the TLS build path, and set `TLS_ADAPTER=on` to enable handling tuned for TLS's payload shapes.

### 2. Standalone `mcp-gate` (Condition Prompt Only)
If you have no downstream MCP server, you can still use `mcp-gate` as a standalone MCP server that exposes a single `condition_prompt` tool.

1. Leave `DOWNSTREAM_MCP` blank in your `.env`.
2. Run `slm-gate serve --layer mcp`.
3. Add `slm-gate` as an MCP server to your editor.

### 3. `llm-gate` (Model Endpoint Override)
For clients that allow overriding the base URL of the model itself (like Cursor, Cline, or Claude Code via `ANTHROPIC_BASE_URL`), `llm-gate` can intercept the chat stream. This path operates at the model layer and is independent of MCP or any toolbox.

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

## Architecture & Documentation

- **[Context Distillation and Elision](./docs/architecture/context-distillation-and-elision.md)**: How the system safely drops old tool outputs to save tokens, and how the elision cache is managed.

---

## Environment Configuration Reference

### What this tool does
This software (the **gate**) sits *between* your AI coding assistant (in Cursor, Claude Code, and similar) and the powerful **paid AI in the cloud** Claude, GPT, or Gemini. It runs a **small, free AI on your own computer** and uses it two ways:

1. **It shrinks and cleans up** the large amounts of text your editor would otherwise send to the paid AI (big files, long logs), so you're not paying for content the AI doesn't actually need.
2. **It answers the easy requests itself**, locally and for free, so those never reach the paid AI at all.

The result is that your paid AI plan or pay-as-you-go budget lasts far longer, because you spend far fewer **tokens** the unit AI usage is billed in (roughly, one token is about three-quarters of a word).

### A few terms used throughout
- **Local model** a small AI that runs on *your* computer. It's free to run but less capable than the big cloud AIs. Sometimes called the "SLM" (small language model).
- **Cloud model** the powerful, paid AI you access over the internet (Claude, GPT, Gemini). Capable, but every request costs money.
- **Ollama** a free program that runs local AI models on your machine. It's the usual way this gate runs its local model.
- **Token** the billing/measurement unit for AI text. ~¾ of a word. Fewer tokens sent = less money spent.
- **Port** like an apartment number for network traffic on your computer; lets two programs find each other.

All variables below live in a file named `.env` and are **checked when the app starts** if a value is wrong, the app stops with a clear error instead of misbehaving quietly. The settings are grouped into steps that roughly follow setup order. Most have sensible defaults you can leave alone.

---

### Step 1 Local model (SLM) setup
*These control the small, free AI on your computer: where it runs, which models it uses, and how carefully it double-checks its own answers.*

- **`SLM_PROVIDER`** Where the local AI comes from. `ollama` runs it on your own machine for free (the normal choice). `openai` instead points it at a cheap *hosted* model, for computers that can't run a local AI.
- **`OLLAMA_HOST`** The address where your Ollama program is listening. The default is Ollama's standard address on your own computer; only change it if Ollama runs on a different machine or port. (Default: `http://localhost:11434`)
- **`OLLAMA_KEEP_ALIVE`** How long the local model stays loaded in memory after it's used. Keeping it loaded means it responds instantly next time instead of taking seconds to warm up; the trade-off is it holds onto memory. Lower it if your computer is short on memory. (Default: `12h`)
- **`SLM_BRAIN_MODEL`** The name of the *bigger, smarter* local model, used for harder jobs like drafting. Bigger local models are more capable but need more memory and are slower.
- **`SLM_GATE_MODEL`** The name of the *smaller, faster* local model, used for quick decisions like "can I handle this myself, or should I send it to the cloud?" Here, speed matters more than brilliance.
- **`SLM_GATE_TESTING_MODEL`** Only used when running the built-in benchmark tests. You can ignore it for normal use.
- **`NUM_CTX`** How much text the local model can consider at once its short-term memory, measured in tokens. Bigger lets it handle larger inputs but uses more of your graphics card's memory. Lower this if the app runs out of memory. (Default: `8192`, roughly 6,000 words at a time)
- **`TEMPERATURE`** How random or "creative" the local model's answers are, from `0` (always the most likely, most predictable answer) upward. It's set to `0` here on purpose, because this tool wants consistent, repeatable results, not creativity. (Default: `0`)
- **`SLM_TIMEOUT_MS`** The longest the app waits for the local model to answer before giving up, in milliseconds. Raise it if you have a slow computer and see timeouts. (Default: `120000`, i.e. 2 minutes)
- **`SELF_CONSISTENCY_K`** When the gate double-checks a local answer, this is how many times it quietly re-asks the same question. If the answers agree, the result is trusted; if they disagree, it's treated as unreliable and handed to the cloud AI instead. More re-asks = a more reliable check, but more local work. (Default: `3`)
- **`SELF_CONSISTENCY_TEMP`** The randomness used during those re-asks. It's deliberately above zero so the re-asks vary a little if the model gives the same answer even when nudged to differ, that's a strong sign the answer is solid. (Default: `0.7`)

### Step 2 Verifier settings
*After the local AI answers, a "verifier" grades whether the answer is good enough to trust. If it isn't, the request is escalated to the paid cloud AI. These control how strict that grading is.*

- **`STRICTNESS_LEVELS`** The list of available grading levels, from `0` (lenient) to `5` (very strict). You normally leave this as-is; it just defines the scale. (Default: `0,1,2,3,4,5`)
- **`HEADLINE_STRICTNESS`** Which grading level is *actually in use*. Higher means a local answer must be clearly good to be accepted, so more requests get sent to the paid cloud AI (safer, but costs more). Lower means local answers are trusted more easily (saves money, but risks weaker answers). (Default: `4`, fairly strict)

### Step 3 Cloud model and answer-reuse (semantic cache)
*These tell the gate how to reach your paid cloud AI, and let it remember past answers so it doesn't pay to answer the same question twice.*

- **`CLOUD_API_STYLE`** Which "dialect" your paid AI provider speaks: `openai` or `anthropic`. Pick the one matching your provider so the gate formats requests correctly.
- **`CLOUD_BASE_URL`** The web address of your paid AI provider's service (e.g. `https://api.openai.com/v1`).
- **`CLOUD_API_KEY`** Your secret key for the paid AI like a password that authorizes (and bills) your usage. Keep it private. You can leave it blank if you only use the gate's compression with an editor subscription rather than a pay-as-you-go key.
- **`CLOUD_MODEL`** The exact name of the paid model you want to use (e.g. a specific Claude or GPT version).
- **`SEMCACHE`** Turns on "answer reuse." When on, the gate remembers the answers to read-only questions and reuses them when you ask something nearly identical, so a repeat question costs nothing instead of a full paid round-trip. It's off by default because it changes behavior (answers can come from memory); turn it on once you're comfortable the reused answers are correct. Only read-only questions are ever remembered, and an entry is thrown away automatically if a file it depended on changes so you won't get a stale answer for edited code. (`on` / `off`)
- **`SEMCACHE_THRESHOLD`** How similar a new question must be to a remembered one before the old answer is reused, from `0` (anything counts) to `1` (must be word-for-word identical). `0.95` is quite strict, so only near-identical questions reuse an answer. Lower it to save more, at the risk of reusing an answer for a slightly different question. (Default: `0.95`)
- **`EMBED_MODEL`** The small local model used to measure that "how similar are these two questions?" comparison. It runs free on your machine. If you change it, clear the cache, because entries saved with the old model won't compare correctly. (Default: `nomic-embed-text`)

### Step 4 Server settings
*Network settings for the gate's two parts. You can usually leave these at their defaults.*

- **`LLM_GATE_PORT`** The port the local proxy listens on. Change it only if that number is already taken by another program. (Default: `8787`)
- **`LLM_GATE_EXPOSE`** Which request dialects the local proxy will accept. Leave as-is unless you specifically need to restrict it. (Default: `openai,anthropic`)
- **`DOWNSTREAM_MCP`** If you want the gate to sit in front of *another* tool server (such as Tech-Lead-Stack) and compress its output, put that server's launch details here as JSON. Leave it blank to run the gate on its own.
- **`MCP_GATE_TRANSPORT`** How the tool-compression part communicates: `stdio` (the standard when your editor launches it directly) or `http` (a network connection). Most setups use `stdio`.
- **`MCP_GATE_PORT`** The port used *only* if you chose the `http` option above. (Default: `8788`)

### Step 5 Logging and telemetry
*Where the gate records what it did how many tokens it saved, what it sent to the cloud so you can see it working.*

- **`LEDGER_PATH`** Where the local record-keeping database file is stored on your computer. This holds your usage and cost history.
- **`LANGFUSE_PUBLIC_KEY`**, **`LANGFUSE_SECRET_KEY`**, **`LANGFUSE_HOST`** An *optional* connection to Langfuse, an online dashboard for inspecting AI activity in more detail. Fill these in only if you use Langfuse; the gate works fine without it and always keeps the local record above.

**Time-saved-per-cycle window lengths.** Paid AI plans refresh your usage allowance on a repeating timer (a "usage window"). Because the gate answers some requests locally for free, you use up that allowance more slowly, so each window effectively lasts a little longer. These three values are the length of each provider's window in minutes; the dashboard and the leaderboard multiply your local deferral share (prompts passed locally / total prompts) by this window length to show the extra runway (bounded from 0 to the window length) for example, answering ~6% of prompts locally extends a 300-minute (5-hour) Claude window by ~18 minutes. Token savings on forwarded prompts (compression) are captured by Tokens Saved / Cost Saved instead, because a forwarded prompt still consumes a message from your quota. It's a ratio, so the figure stays roughly the same whether you send 100 requests or 900. Providers change these limits without notice, so verify the current window for your plan and model at the links below and set the value to match. Most plans also have a separate weekly cap, which this metric intentionally ignores (it models only the short refresh window).

- **`SUBSCRIPTION_PLAN`**: Set to one of the supported plans. This automatically configures the authoritative window length for your provider's rate limits. Valid values: `claude-pro`, `claude-max-5x`, `claude-max-20x`, `chatgpt-go`, `chatgpt-plus`, `chatgpt-pro-5x`, `chatgpt-pro-20x`, `gemini-plus`, `gemini-pro`, `gemini-ultra`.

Sources (verified 2026-09-09):
- Claude: <https://support.anthropic.com/en/articles/11014257-about-claude-max-plan-usage>
- ChatGPT: <https://help.openai.com>
- Gemini: <https://support.google.com/gemini/answer/16275805>

### Step 6 Clarification resolver and miscellaneous
*A grab-bag of toggles including a feature that lets the local AI ask the paid AI for help on genuinely ambiguous decisions, with a strict spending cap.*

- **`RESOLVER_CLOUD_TIER`** When the local AI hits a genuinely ambiguous decision it can't settle on its own, this lets it make a small, bounded call to the paid AI for help. (`on` / `off`)
- **`RESOLVER_CLOUD_BUDGET_USD`** A hard dollar limit on how much that help feature may spend in total. The default of `0` means it won't spend anything so the feature is effectively off until you give it a budget (for example, `5` allows up to $5). (Default: `0`)
- **`PROMPT_VERSION`** A label used to reset the gate's saved answers. If you change this string (say `v1` to `v2`), all previously saved answers are ignored and fresh ones are generated. Useful after you change how the gate's prompts work. (Default: `v1`)
- **`RAM_PRESET`** A convenience setting that auto-picks sensible local models for your computer's memory size: `ram-8` (8 GB), `ram-16`, `ram-32`, or `custom` to choose everything yourself.
- **`TLS_ADAPTER`** Turns on special handling for Tech-Lead-Stack, a companion tool. Leave it off unless you're running the gate in front of Tech-Lead-Stack. (`on` / `off`)

### Step 7 Shrinking tool output, and getting it back if needed
*When a tool returns something big (a large file, a long log), the gate shrinks it with the local model before it reaches your editor, so you don't pay cloud tokens for content the AI doesn't need. The original is stashed locally so the AI can cheaply get back anything that was trimmed.*

**Reading the token numbers below:** roughly **4 characters ≈ 1 token**. As a rule of thumb that's about **~10 tokens per line of code**, or **~750 words per 1,000 tokens** so the caps translate to a real amount of code or text.

- **`DISTILL_PRESERVE_PATH`** Points to a file listing text patterns that must **never** be shrunk or altered (for example, specific code markers or IDs you always want kept exactly as-is). Optional; leave blank to rely on the built-in list.
- **`DISTILL_PRESERVE_MODE`** Whether your custom "never shrink" patterns are *added to* the built-in ones (`extend`) or *replace* them entirely (`replace`). `extend` is the safe choice.
- **`DISTILL_MAX_TOKENS`** The **ceiling**: the most tokens a single tool result may take up *after* shrinking. This is a safety backstop the gate already keeps only the relevant parts; this just stops anything unusually huge from flooding the AI's memory. If a result is still over this after shrinking, the extra is trimmed and replaced with a marker the AI can expand on demand. **`2000` ≈ ~8,000 characters ≈ ~200 lines of code ≈ ~1,500 words.** *Example:* you read a 900-line file (~9,000 tokens); the gate keeps the ~20 lines around your search term plus the file's imports and function names about 180 lines (~1,800 tokens), under the ceiling, so nothing is trimmed. But a test that dumps a 6,000-line log, even after keeping the errors and the tail, might still be ~3,000 tokens, so this ceiling trims it back to ~2,000 and leaves an expandable marker for the rest. Lower it to save more tokens (but cause more "fetch the rest" round-trips); raise it to keep more in memory per turn (but pay more). (Default: `2000`)
- **`DISTILL_SKILLS`**: disable summarisation for tool outputs identified as skills.
- **`DISTILL_PRESERVE_PATH`**: point to a JSON file to define custom regex patterns that are never summarized. See `configs/preserve/README.md`.
- **`DISTILL_MIN_TOKENS`** The **floor**: any tool result *smaller* than this is left completely alone, because it's too small to be worth shrinking. Shrinking tiny outputs costs a local-model call and risks garbling a filename, for almost no saving. **`500` ≈ ~2,000 characters ≈ ~50 lines of code ≈ ~375 words.** *Example:* a directory listing of 15 files (~150 tokens), or a 40-line config file (~450 tokens), is under 500, so it passes through untouched. In short: under the floor = untouched; between the floor and the ceiling = shrunk to fit; over the ceiling after shrinking = trimmed. (Default: `500`)
- **`KEEP_RECENT_TOOL_TURNS`** The gate always keeps the *most recent* tool results in full, even if they're large, because whatever the AI just fetched is almost certainly still needed for its next step. Only *older* results become candidates for shrinking or removal. With `2`, the result from this step and the one before it stay complete; something fetched six steps ago (and untouched since) can be shrunk. Higher = safer but fewer savings; lower = more aggressive. (Default: `2`)
- **`ELISION_MAX_ENTRIES`** Whenever the gate shrinks or drops a tool result, it stashes the **original** in a small local database so the AI can retrieve exactly what was trimmed without re-running the tool. This is the maximum number of originals kept; past it, the oldest are deleted. Higher = more originals available for cheap retrieval (more disk used); lower = less disk, but retrieving an evicted original means re-running the original tool. (This stash only ever holds trimmed tool output never your usage or cost data.) (Default: `5000`)
- **`ELISION_RETENTION_DAYS`** How long a stashed original is kept before it's automatically deleted. `180` is about six months, which is deliberately generous in practice a stashed original is almost always re-fetched within minutes, so the disk limit below usually matters more. Lower it (e.g. `30`) if you'd rather rely mainly on the size limit. (Default: `180`)
- **`ELISION_MAX_MB`** The disk budget for that stash, in megabytes. When it's exceeded, the least-recently-used originals are deleted first. This is usually the limit that actually kicks in (before the six-month age). (Default: `500`)

### Step 8 Learning which requests to handle locally
*The gate can answer a request two ways: the free local AI, or the paid cloud AI. It tries local first, the verifier checks the answer, and it falls back to cloud only if the answer isn't good enough. These settings let the gate learn which kinds of requests the local AI is genuinely good at, so it stops wasting attempts on the kinds it usually fails while still occasionally re-testing.*

- **`ROUTING_TUNE`** Turns that learning on or off. `off` = always try local first, regardless of past results. `on` = skip local for categories of request the local AI has been failing, and send those straight to cloud. (`on` / `off`)
- **`ROUTING_TUNE_WINDOW`** How many recent requests (per category) it looks back over when measuring the local AI's success rate. Larger = a smoother, slower-to-change picture; smaller = adapts faster but is noisier (a couple of flukes sway it more). (Default: `20`)
- **`ROUTING_TUNE_MIN_SAMPLES`** The minimum number of past requests needed for a category before the gate is allowed to act on its success rate. This stops it deciding "local is bad at this" off one or two data points. (Default: `8`)
- **`ROUTING_TUNE_THRESHOLD`** The local success rate *below which* the gate stops trying local for a category and goes straight to cloud. `0.5` means: if the local AI succeeds less than half the time for this kind of request, skip it. Higher (e.g. `0.7`) = stricter, sends more to the paid cloud (more reliable, costs more); lower (e.g. `0.3`) = keeps trying local (cheaper, but more failed attempts that then escalate). (Default: `0.5`)
- **`ROUTING_TUNE_EXPLORE_RATE`** Even for categories it has learned to skip, the gate deliberately tries local this fraction of the time, to keep learning (a category might have improved, or was judged on stale data). This is the classic "explore vs. stick with what works" dial. `0.15` = it explores about 15% of the time. Higher = adapts faster but runs more risky trials; lower = more conservative and slower to adapt. (Default: `0.15`)

---

## Appendix C: RAM-by-Machine Model Table

Selecting the right local models is crucial for performance. As a rule of thumb, you should configure your `.env` models based on your available system RAM.

| RAM        | Recommended Presets | Example Brain Models               | Example Gate Models           |
| :--------- | :------------------ | :--------------------------------- | :---------------------------- |
| **16 GB**  | `ram-16`            | qwen2.5-coder:3b, tinyllama        | qwen2.5-coder:0.5b            |
| **24 GB**  | `ram-24`            | qwen3.5:4b, llama3.2:3b            | qwen2.5-coder:3b, phi3:mini   |
| **32 GB**  | `ram-32`            | qwen2.5:7b, mistral:7b             | qwen2.5-coder:3b, phi3:mini   |
| **64 GB**  | `ram-64`            | qwen3.5:9b, llama3:8b              | qwen3.5:4b, llama3.2:3b       |
| **128 GB** | `ram-128`           | qwen3:14b, llama3:70b (Q4)         | qwen3:7b, mistral:7b          |

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

### 🍏 Best Practices for macOS/Homebrew Users

When deploying Ollama on macOS via Homebrew (`brew install ollama`), developers face a severe configuration trap.

> [!WARNING]
> **The Configuration Trap:** Running `brew services restart ollama` aggressively overwrites the `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist` file. This silently deletes any custom `EnvironmentVariables` you have manually added, resulting in aggressive model swapping and context truncation. Furthermore, Homebrew's native `.env` injection (via `~/.config/homebrew/services/`) is frequently ignored by the macOS LaunchDaemon for the Ollama formula.

**The Solution:**
To persistently apply critical environment variables for high-performance SLM routing without them being overwritten by Homebrew:
1. Stop the brew service: `brew services stop ollama`
2. Manually add your `EnvironmentVariables` dictionary to `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist`.
3. Natively load the daemon: `launchctl load ~/Library/LaunchAgents/homebrew.mxcl.ollama.plist`

**Required Variables for this Repo:**
- `OLLAMA_CONTEXT_LENGTH="8192"` (Ensures Ollama's global context matches the app's `NUM_CTX`)
- `OLLAMA_KEEP_ALIVE="12h"` (Prevents unloaded models, ensuring warm latency)
- `OLLAMA_MAX_LOADED_MODELS="2"` (or `1`, depending on VRAM capacity to prevent model swapping)

*For further reading, refer to the [official Ollama FAQ on memory and concurrency](https://github.com/ollama/ollama/blob/main/docs/faq.md).*

### ⚠️ RAM Troubleshooting & Sizing Disclaimer: What to do if your RAM config is not working

If you experience high memory pressure, models being evicted (one model constantly unloading to make room for another), sluggish system responsiveness, or out-of-memory errors, the following **MUST** be considered:

#### The Memory Formula
```text
Memory = Model Weights + (NUM_CTX × KV-Cache) × Models Loaded
```

**Dropping the brain model to a 7B is exactly the right lever, and yes it'll cut RAM. But don't just hand-edit `NUM_CTX` to a smaller number and call it done memory is model weights + (`NUM_CTX` × KV-cache) × models loaded.**

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
