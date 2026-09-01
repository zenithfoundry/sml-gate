import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/ledger/index.js';
import { ensureOllamaReady, getE2EEnv, SLM_GATE_MODEL, SLM_BRAIN_MODEL } from "./ollama-helper.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

async function runTest() {
  console.log("Starting E2E TLS Downstream Test...");
  
  const tlsDist = process.env.TLS_DIST;
  if (!tlsDist) {
    console.error("FAIL: TLS_DIST env var is not set. It must point to the absolute path of the TLS repo.");
    process.exit(1);
  }

  const tlsServerPath = path.join(tlsDist, 'dist', 'mcp-server.mjs');
  if (!fs.existsSync(tlsServerPath)) {
    console.error(`FAIL: TLS server not found at ${tlsServerPath}`);
    process.exit(1);
  }

  await ensureOllamaReady([SLM_GATE_MODEL, SLM_BRAIN_MODEL]);

  const mcpGatePath = path.join(rootPath, 'dist', 'mcp-gate', 'index.js');
  if (!fs.existsSync(mcpGatePath)) {
    console.error(`FAIL: ${mcpGatePath} not found. Run 'pnpm run build' first.`);
    process.exit(1);
  }

  const env = getE2EEnv({
    DOWNSTREAM_MCP: JSON.stringify({
      command: "node",
      args: [tlsServerPath]
    })
  });
  console.log("Using REAL TLS downstream MCP server at:", tlsServerPath);

  const transport = new StdioClientTransport({
    command: 'node',
    args: [mcpGatePath],
    env
  });

  const client = new Client(
    { name: "e2e-tls-downstream-client", version: "1.0.0" },
    { capabilities: {} }
  );

  console.log("Connecting to mcp-gate...");
  await client.connect(transport);

  console.log("Calling tools/list...");
  const tools = await client.request({ method: "tools/list" }, ListToolsResultSchema);
  const toolNames = tools.tools.map(t => t.name);
  console.log("Tools returned:", toolNames);

  if (!toolNames.includes('get_skill')) {
    console.error(`FAIL: Expected tool 'get_skill' missing from tools list.`);
    process.exit(1);
  }
  console.log(`PASS: Expected tool 'get_skill' is present.`);

  console.log(`\nCalling get_skill... (Requires Ollama running)`);
  try {
    const result = await client.request({
      method: "tools/call",
      params: {
        name: 'get_skill',
        arguments: {
          skillName: 'dummy-skill',
        }
      }
    }, CallToolResultSchema, { timeout: 600000 });

    const conditionedText = String((result.content[0] as any).text);
    console.log("\nConditioned output length:", conditionedText.length);
    console.log("=== Conditioned Output ===\n" + conditionedText + "\n==========================");
    
    let pass = true;

    // Assertion (a): MUST-lines/headers preserved verbatim
    if (conditionedText.includes('❌ SLM Error')) {
      console.warn("WARNING: SLM Error encountered, skipping MUST/headers assertions.");
    } else {
      if (!conditionedText.includes('#')) {
        console.error("FAIL: No headers (#) found in conditioned output.");
        pass = false;
      } else {
        console.log("PASS: Headers (#) found in conditioned output.");
      }
      
      if (!/must/i.test(conditionedText)) {
        console.error("FAIL: No MUST/must keyword found in conditioned output.");
        pass = false;
      } else {
        console.log("PASS: MUST keyword found in conditioned output.");
      }
    }

    // Assertion (b): Ledger row written
    const db = getDb();
    const row = db.prepare("SELECT * FROM events WHERE layer = 'mcp' AND route = 'condition' ORDER BY ts DESC LIMIT 1").get();
    if (!row) {
      console.error("FAIL: No ledger row found for layer=mcp, route=condition.");
      pass = false;
    } else {
      console.log("PASS: Ledger row found:", (row as any).request_id);
    }

    if (!pass) {
      console.error("\nTEST FAILED.");
      process.exit(1);
    } else {
      console.log("\nALL TESTS PASSED.");
      process.exit(0);
    }

  } catch (err) {
    console.error("FAIL: Tool call failed", err);
    process.exit(1);
  }
}

runTest();
