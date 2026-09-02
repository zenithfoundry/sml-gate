# Antigravity MCP Configuration

Antigravity requires you to configure MCP servers in its global configuration file. Note that a REMOTE server (like HTTP) uses `serverUrl`, not `url`. Below is the configuration for `slm-gate` using `stdio`.

**File Location:** `~/.gemini/config/mcp_config.json`

```json
{
  "mcpServers": {
    "slm-gate": {
      "command": "node",
      "args": [
        "<ABS_PATH>/dist/mcp-gate/index.js"
      ],
      "env": {
        "TLS_ADAPTER": "on",
        "DOWNSTREAM_MCP": "{\"command\":\"node\",\"args\":[\"<ABS_PATH_TO_TLS>/dist/mcp-server.mjs\"]}",
        "CLOUD_API_KEY": "${CLOUD_API_KEY}",
        "SLM_BRAIN_MODEL": "qwen2.5:7b",
        "SLM_GATE_MODEL": "qwen2.5-coder:3b",
        "OLLAMA_MAX_LOADED_MODELS": "2",
        "NUM_CTX": "4096"
      }
    }
  }
}
```

> **IMPORTANT:** Antigravity reads its configuration directly from the `"env"` JSON block in `mcp_config.json` shown above. The template files (`.env.16gb.example`, `.env.24gb.example`, `.env.32gb.example`) in this directory are reference templates. Setting variables in a template file does not affect Antigravity unless you add them to the `slm-gate` -> `env` block in `mcp_config.json`.

---

### ⚠️ RAM Sizing & Troubleshooting Disclaimer: If Your RAM Config Is Not Working

If your models are getting evicted, Ollama is thrashing/swapping back and forth between disk and memory, or your Mac is experiencing high memory pressure, the following **MUST** be considered:

#### The Memory Formula
```text
Memory = Model Weights + (NUM_CTX × KV-Cache) × Models Loaded
```

**Dropping the brain model to a 7B is exactly the right lever, and yes it'll cut RAM. But don't just hand-edit `NUM_CTX` to a smaller number and call it done — memory is model weights + (`NUM_CTX` × KV-cache) × models loaded.**

While this example shows dropping from a 9B (or 14B) to a 7B model, this principle is a general rule that applies to all RAM capacities:

1. **Check your pulled tags:**
   ```bash
   ollama list        # see which qwen tags are pulled
   ```
2. **Pick a smaller brain:**
   e.g. `qwen2.5:7b` (pull it if needed: `ollama pull qwen2.5:7b`).
   Keep the small gate model (`qwen2.5-coder:3b`) as-is; it's already tiny (~2GB).
3. **Set it in your Antigravity `slm-gate` env (NOT a template file):**
   Add these directly to `mcpServers.slm-gate.env` in `~/.gemini/config/mcp_config.json`:
   ```json
   "SLM_BRAIN_MODEL": "qwen2.5:7b",
   "SLM_GATE_MODEL": "qwen2.5-coder:3b",
   "OLLAMA_MAX_LOADED_MODELS": "2",
   "NUM_CTX": "4096"
   ```
4. **Shrink `NUM_CTX`:**
   Lowering `NUM_CTX` from `8192` → `4096` is where a lot of the RAM savings actually comes from (the KV cache shrinks with it), and it's the single biggest knob after model size.
5. **Fallback to Single-Model Mode if still heavy:**
   If memory is still heavy, set `"OLLAMA_MAX_LOADED_MODELS": "1"`. This forces one model in memory at a time (slower switching between gate and brain, but drastically reduces RAM usage).
6. **Confirm exact variable names:**
   Verify against `.env.24gb.example` that the gate reads:
   - `SLM_BRAIN_MODEL`
   - `SLM_GATE_MODEL`
   - `NUM_CTX`
   - `OLLAMA_MAX_LOADED_MODELS`
7. **Use doctor to sanity-check:**
   Run `slm-gate doctor` to sanity-check the fit for your RAM:
   ```bash
   pnpm run dev doctor   # or: node dist/cli.js doctor
   ```

After updating `mcp_config.json`, restart/refresh MCP servers in Antigravity and verify with `slm-gate doctor`.
