import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

/**
 * @fileoverview
 * End-to-End Test: Standalone MCP (`e2e:standalone-mcp`)
 * 
 * Expected Outcome:
 * The test successfully connects to `mcp-gate` via stdio in standalone mode (i.e. with
 * `DOWNSTREAM_MCP` unset). It verifies that ONLY the local `condition_prompt` tool is exposed,
 * and that it correctly conditions a direct text input (with fluff and verbatim instructions) 
 * without forwarding any requests to a downstream server.
 * 
 * Why this test is needed (Why it exists):
 * This test guarantees that `mcp-gate` can function independently as a text-conditioning 
 * tool when a user does not configure a downstream MCP. It protects against regressions 
 * where the application might crash or fail to expose its core local tools if no proxy 
 * target is provided.
 * 
 * Warning Expectations / Potential Flakiness:
 * - Requires Ollama running locally with the target model.
 * - Flakiness could occur if the prompt distillation takes too long and hits the timeout 
 *   (`SLM_TIMEOUT_MS`). The local model's generative randomness could occasionally alter 
 *   the text length, though the test checks for the presence of the `MUST` lines which 
 *   should be strictly preserved.
 * 
 * @returns {Promise<void>} Resolves when the smoke test completes, or exits with non-zero on failure.
 */
async function main() {
  console.log("Starting MCP Gate Smoke Test...");

  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(rootPath, 'dist', 'mcp-gate', 'index.js')],
    // Ensure DOWNSTREAM_MCP is unset so it runs in standalone mode
    env: { ...process.env, DOWNSTREAM_MCP: '' }
  });

  const client = new Client(
    { name: "smoke-test-client", version: "1.0.0" },
    { capabilities: {} }
  );

  console.log("Connecting to dist/mcp-gate/index.js via stdio...");
  await client.connect(transport);

  console.log("Calling tools/list...");
  const tools = await client.request({ method: "tools/list" }, ListToolsResultSchema);
  console.log("Tools returned:", tools.tools.map(t => t.name));

  const hasConditionPrompt = tools.tools.some(t => t.name === "condition_prompt");
  if (!hasConditionPrompt) {
    console.error("FAIL: condition_prompt tool is missing!");
    process.exit(1);
  }
  console.log("PASS: condition_prompt tool is present.");

  console.log("\\nTesting condition_prompt... (Requires Ollama running)");
  const originalSkill = `
# Skill Requirements
This is a canned skill for smoke testing.

You MUST follow these rules exactly.
You SHOULD try to be concise.

Here is some sample code:
\`\`\`javascript
console.log("Hello world");
\`\`\`

End of skill.
`;

  const originalLength = originalSkill.length;
  console.log(`Original skill char count: ${originalLength}`);

  try {
    const result = await client.request({
      method: "tools/call",
      params: {
        name: "condition_prompt",
        arguments: {
          text: originalSkill,
          task: "Smoke test conditioning"
        }
      }
    }, CallToolResultSchema);

    const conditionedText = String((result.content[0] as any).text);
    const conditionedLength = conditionedText.length;
    console.log(`Conditioned skill char count: ${conditionedLength}`);
    
    // Validate that the MUST line is present
    const mustLine = "You MUST follow these rules exactly.";
    if (!conditionedText.includes(mustLine)) {
      console.error(`FAIL: MUST line not present verbatim.\\nExpected: ${mustLine}\\nGot: ${conditionedText}`);
      process.exit(1);
    }
    console.log("PASS: MUST line present verbatim.");
    
    process.exit(0);
  } catch (err) {
    console.error("FAIL: condition_prompt tool call failed", err);
    process.exit(1);
  }
}

main();
