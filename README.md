# Small Language Model Gate

`small-language-model-gate` is a decoupled local-SLM pre-processing and routing layer that sits in front of a cloud LLM and works inside any MCP client. 

It provides two independently-runnable middleware layers plus one shared ledger:

1. **`mcp-gate`**: A standard MCP proxy. A client connects to it; it optionally forwards to a downstream MCP server. It intercepts skill/prompt payloads and runs a local small model to **compress, ground, and disambiguate** them before they reach the cloud model.
2. **`llm-gate`**: An OpenAI and Anthropic-compatible HTTP endpoint. A client points its model base URL at it. Per request, it **defers locally** (using the SLM + verifier) or **compresses and forwards** to the cloud, metering exact cloud token usage.
3. **Ledger**: Every request from either layer writes one SQLite row and (optionally) one Langfuse v4 trace.

## The Value Proposition: Beating Subscription Rate Limits

The headline metric of this project is **cost-at-equal-quality**. On API keys, cost is measured in dollars. However, on subscription plans (like ChatGPT Plus, Claude Pro, or Gemini Advanced), cost is measured in **tokens and turns**.

All major providers impose strict message or token limits over rolling 3-4 hour windows. When you are writing code or engaging in complex multi-turn chats, hitting this usage cap effectively halts your workflow. 

By routing "easy" tasks (like simple formatting, extraction, and boolean checks) to a local Small Language Model (SLM) running on your machine, `small-language-model-gate` shields your precious cloud tokens. 

**Real-World Impact (As of August 21, 2026):**
If this gateway reduces your cloud token usage by **10%**, it effectively extends your active coding time by 10%. On a typical 4-hour rolling limit, that equates to gaining an extra **~24 minutes** of workflow time before you hit the provider's cap.

### Provider Limit Research (August 2026)
To illustrate this value, we actively track the rolling constraints of major subscription providers. Higher tiers (like Pro/Max/Ultra) increase the total *absolute* capacity of messages you can send, but they are all still strictly governed by rolling 3 to 5 hour blocks.

* **ChatGPT (OpenAI)**:
  * **Plans:** Plus, Go
  * **Constraint Window:** 3 hours
  * **Limits:** 160 messages (using GPT-5.5 Instant) every 3 hours.
* **Claude (Anthropic)**:
  * **Plans:** Pro, Max (5x), Max (20x)
  * **Constraint Window:** 5 hours
  * **Limits:** Base Pro is ~45 messages every 5 hours. Max plans multiply this capacity (~225 to ~900 messages) but operate on the exact same 5-hour rolling reset window.
* **Gemini (Google AI)**:
  * **Plans:** Plus, Pro, Ultra
  * **Constraint Window:** 5 hours (compute-based, factoring in prompt complexity)
  * **Limits:** Refreshes every 5 hours until a weekly limit cap is reached. Prompts per day scale by tier (e.g., 100 for Pro, 500 for Ultra).

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for a deep dive into the routing logic, verifier system, and decoupling constraints.

## Offline Evaluation Harness

To ensure the router maintains high quality, this project includes a benchmark suite. The offline evaluation harness runs a dataset of tasks against three arms:
- **Arm 1 (All SLM):** Forces local answers.
- **Arm 2 (Arm A - All Cloud):** The baseline. Forces API cloud answers.
- **Arm 3 (Arm B - Router):** The actual router logic (defers locally if confident, escalates if not).

Run the benchmark to generate a Leaderboard report:
```bash
pnpm run bench
```
*(You can also use `pnpm run bench:reset` to clear the cache and force a fresh run).*

## Free Measurement Path

The offline harness and Langfuse metrics integrations allow you to measure the cost and token reduction of the `slm-gate` using this "free" measurement path:
1. Route the Tech Lead Stack (TLS) through `mcp-gate`.
2. Re-run `TLS scripts/calibrate-skill-costs.ts`.
3. Observe the per-skill p50 token drop, which occurs because `slm_gate` traces effectively compress `AnalyticsEvent.totalTokens`.
