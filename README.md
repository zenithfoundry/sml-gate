# small-language-model-gate

`small-language-model-gate` (CLI: `slm-gate`) is a local AI routing and pre-processing layer designed to intercept easy, repetitive tasks with a small, free local model before they hit your expensive subscription or API-based cloud model. By compressing context, resolving simple prompts locally, and metering API usage, it dramatically reduces your cloud usage and protects your monthly quota.

## The Two Cloud Models

This tool distinguishes explicitly between two different downstream LLM layers you might use:

1. **Subscription Model (Your Editor):** 
   - This is the model you pay a flat monthly fee for (e.g., Claude Pro in Claude Code, Gemini Advanced in Antigravity/Cursor). 
   - `slm-gate` intercepts prompts bound for this model, compresses them, and answers basic tool usages locally to save you quota and turns. This usage is *not* dollar-metered because you already pay a flat fee.
   
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

| Client | Layer 1 (`mcp-gate`) | Layer 2 (`llm-gate`) | Notes |
| :--- | :---: | :---: | :--- |
| **Antigravity** | ✅ | ❌ | Antigravity uses a locked internal model; use mcp-gate. |
| **Claude Code** | ✅ | ✅ | `ANTHROPIC_BASE_URL=http://localhost:8787`. Disables native Tool Search. |
| **Cursor** | ✅ | ✅ | Override Base URL in Settings > Models. |
| **Cline / Continue** | ✅ | ✅ | Configure via OpenAI-compatible endpoint. |
| **Claude Desktop** | ✅ | ❌ | Stdio only for MCP. Cannot override internal Claude model. |

---

## Verification & Day-to-Day Use (All Clients)

**Cloud API Keys:** 
When using `mcp-gate` (Layer 1) alongside your IDE's built-in subscription model (e.g., Claude Pro, Gemini Advanced, Cursor Pro), you **do not** need a `CLOUD_API_KEY` in your `.env`. The `CLOUD_*` variables are only required if you use Layer 2 (`llm-gate`) or run the offline testing harness (`slm-gate bench`). For Layer 1, the proxy relies 100% on the local Ollama models (`SLM_BRAIN_MODEL` and `SLM_GATE_MODEL`) to compress and filter payloads before they reach your editor. You can safely leave the cloud keys blank.

**Build Readiness:**
Out of the box (or after running `pnpm run test:e2e`), the build script runs automatically and `/dist/mcp-gate/index.js` is ready to use. *Note: If you modify the `.ts` source files, you must run `pnpm run build` again so your connected clients pick up the changes.*

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

*(For developers wanting to run systematic benchmarks, see `harness/README.md` and use `slm-gate bench`. Note: The harness requires a funded `CLOUD_API_KEY`.)*

---

## No-Ollama / Cloud Fallback

If your machine cannot run Ollama, you can change `SLM_PROVIDER=openai` in your `.env`. This allows you to point `SLM_BRAIN_MODEL` and `SLM_GATE_MODEL` to a cheap, hosted model (e.g., `gpt-4o-mini` or `gemini-1.5-flash`). 

*Caveat: Because hosted "small" models still cost money and incur network latency, the deferral savings are significantly lower than running locally, though compression will still save tokens.*

---

## Appendix C: RAM-by-Machine Model Table

Selecting the right local models is crucial for performance. As a rule of thumb, you should configure your `.env` models based on your available system RAM.

| RAM | Recommended Presets | Example Brain Models | Example Gate Models |
| :--- | :--- | :--- | :--- |
| **4 GB** | `ram-4` | qwen3.5:1.5b, phi3:mini, gemma2:2b | qwen3.5:0.5b, tinyllama |
| **8 GB** | `ram-8` | qwen3.5:3b, llama3.2:3b | qwen3.5:0.5b, phi3:mini |
| **16 GB** | `ram-16` | qwen3:7b, llama3:8b, mistral:7b | qwen3:1.7b, phi3:mini |
| **24 GB** | `ram-24` | qwen3.5:9b, qwen3:14b | qwen2.5-coder:3b, llama3.2:3b |
| **32 GB** | `ram-32` | qwen3:14b, deepseek-coder:33b | qwen3:1.7b, llama3:8b |
| **64 GB** | `ram-64` | qwen3:32b, llama3:70b (Q4) | qwen3:7b, mistral:7b |
| **128 GB** | `ram-128` | qwen3:72b, command-r-plus:104b | qwen3:14b, llama3:8b |

### Dual-Model Concurrency (`OLLAMA_MAX_LOADED_MODELS`)
When running different models for the Gate (e.g. 3B) and Brain (e.g. 9B), configure Ollama to keep both models in memory concurrently to eliminate model swapping latency:
```bash
# macOS (persistent)
launchctl setenv OLLAMA_MAX_LOADED_MODELS 2

# Linux / Terminal
export OLLAMA_MAX_LOADED_MODELS=2
```

*Note: You must pull these models via `ollama pull <model_name>` before running `slm-gate serve`. Run `slm-gate doctor` to verify your environment!*
