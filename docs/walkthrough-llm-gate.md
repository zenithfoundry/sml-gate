# Walkthrough: Using the LLM Gate with your Chat Client

> [!NOTE]
> **Is this guide for me?**
> This guide is **ONLY** for people who:
> 1. Have a paid API key set in their `.env` file under the `CLOUD_*` values.
> 2. Use a chat client that allows you to point it at a custom model address (such as Claude Code, Cursor, or Cline).
>
> If you only use a subscription model inside an editor like Antigravity, **skip this guide**. You already get the benefit from Layer 1 (the MCP gate) and should refer to the main README instead.

### What is `llm-gate`?
The `llm-gate` is a small program that runs on your own computer. Instead of sending every request straight to an expensive paid API model, your chat client sends requests to `llm-gate` first. It answers the easy questions locally for free using your local model, and only forwards the hard ones to the paid model — saving you money.

### What you'll need before starting
- [x] Ollama is installed and running on your machine.
- [x] The models specified in your `.env` (like `qwen3:14b` and `qwen3:1.7b`) are already pulled in Ollama.
- [x] The `CLOUD_*` values are filled out in your `.env` file with a valid API key.
- [x] The project is built (you have run `pnpm run build`).
- [x] `npx slm-gate doctor` shows all green.

---

## Step 1: Start the LLM Gate

**Terminal 1**
Open a terminal and run the following command to start the gate server:

```bash
npx slm-gate serve --layer llm
```

**What you should see:**
The server will start up and print a message indicating it is listening on a port.
```text
Starting llm-gate...
Listening on http://0.0.0.0:8787
```

**If it didn't work:**
Run `npx slm-gate doctor` to diagnose configuration or missing dependencies.

*What just happened: You launched a local HTTP server on port `8787` (the "route"). This server is now waiting to intercept messages from your chat client before they reach the cloud.*

---

## Step 2: Connect your Chat Client

Leave Terminal 1 running. Open a second terminal window (**Terminal 2**) or open your chat client's settings. 
The custom address you need to provide is called an **endpoint override** or **Base URL**. We will use `http://localhost:8787/v1`.

### Option A: Claude Code
Claude Code uses environment variables to configure its endpoint. 

In Terminal 2, set the environment variable and run Claude Code:
```bash
export ANTHROPIC_BASE_URL="http://localhost:8787/v1"
claude
```
*Now, try asking Claude Code a simple question like "What is 2+2?"*

### Option B: Cursor
1. Open Cursor Settings.
2. Navigate to the **Models** section.
3. Find the **Override Base URL** or **OpenAI Base URL** setting.
4. Paste the local address exactly as: `http://localhost:8787/v1`

*Now, open the chat panel in Cursor and ask it to write a simple "Hello World" function.*

### Option C: Cline
1. Open Cline Settings.
2. Select your API Provider (e.g., OpenAI Compatible).
3. Paste the local address into the **Base URL** field: `http://localhost:8787/v1`

*Now, ask Cline to perform a simple task in your codebase.*

*What just happened: You told your chat client to stop talking directly to the paid cloud API. Instead, it sent its latest request to the local `llm-gate` you started in Step 1.*

---

## Step 3: Verify the Ledger

Every request that passes through the gate is logged in a local logbook called the **ledger**. Let's check it.

**Terminal 2**
Run the following SQLite command to read the ledger and see what happened to your requests:

```bash
sqlite3 ./output/ledger.sqlite "SELECT route, cost_usd, in_tok, out_tok FROM events;"
```

**What you should see:**
```text
defer_local|0.0|45|12
forward_raw|0.024|1200|450
```

**How to read this:**
- `defer_local`: The local `llm-gate` decided the question was easy, answered it using your free local model, and charged you $0.00.
- `forward_raw`: The question was too hard, so `llm-gate` decided to **escalate** it and forwarded the exact original text to the paid API model. This cost you money, which is shown in the `cost_usd` column.

*What just happened: You verified that the local gate is successfully intercepting requests, grading their difficulty, and saving you API costs by handling simple questions locally.*

---

## Troubleshooting

- **Connection Refused:** Ensure `npx slm-gate serve --layer llm` is still running in Terminal 1 without errors.
- **No rows appearing in the ledger:** Your chat client is still bypassing the gate. Double-check that your Base URL is exactly `http://localhost:8787/v1`.
- **"It went to the paid model every time!":** Your questions might have been genuinely complex. Try asking a trivially simple question like "Say hi." If it still forwards, check if your local Ollama server is running out of memory.
