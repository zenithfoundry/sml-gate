# Architecture

`small-language-model-gate` is a decoupled local-SLM pre-processing and routing layer that sits in front of a cloud LLM and works inside any MCP client.

## Core Components

The system consists of two independently-runnable middleware layers plus one shared ledger:

1. **Layer 1: `mcp-gate`**
   - A standard MCP proxy (supports stdio and HTTP transports).
   - A client connects to it, and it optionally forwards to a downstream MCP server.
   - It intercepts skill/prompt payloads and runs a local small model (SLM) to compress, ground, and disambiguate them before they reach the client's editor model.

2. **Layer 2: `llm-gate`**
   - An HTTP endpoint compatible with OpenAI and Anthropic API formats.
   - A client points its model base URL at it.
   - Per request, it makes a routing decision: defer locally (using SLM + verifier) or compress and forward to the cloud model, accurately metering the exact cloud token usage.

3. **Ledger**
   - Every request from either layer writes one SQLite row locally.
   - Optionally logs traces to Langfuse v4 if configured.

## The Two-Model Distinction

The system architecture explicitly distinguishes between two different models:

- **SUBSCRIPTION model:** The paid model inside your editor (e.g., Gemini Advanced, Claude Pro). This uses a flat monthly fee. `mcp-gate` conditions and compresses the prompts flowing to it to reduce token/turn usage, but this usage is **NOT** dollar-metered in our ledger.
- **API model (CLOUD_*):** A metered, pay-per-token endpoint (configured via `CLOUD_*` env vars). This is what `llm-gate` forwards to when it cannot answer locally, and what the resolver can optionally call. The ledger strictly records the API calls ($) and local calls ($0).

## Decoupling Contract

1. **Zero build-time dependency on `tech-lead-stack` (TLS).** All TLS knowledge resides exclusively in `src/adapters/tech-lead-stack.ts`, gated by `TLS_ADAPTER=on` + `DOWNSTREAM_MCP`, imported only via guarded dynamic import. Deleting this file leaves everything else compiling and passing tests.
2. **Each layer runs independently.** `llm-gate` operates without MCP; `mcp-gate` operates without a cloud endpoint and can act as a standalone tool provider.
3. **Single source of configuration truth.** All configurations are located in `src/config.ts`.
4. **Provider-agnostic.** The cloud model works with any provided endpoint/key, and the local model supports any Ollama tag.
