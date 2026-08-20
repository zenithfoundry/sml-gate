import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListToolsResultSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

/**
 * Executes a smoke test for the MCP gate to ensure it can successfully connect, 
 * expose the expected tools, and process a standard prompt conditioning task.
 * 
 * This test runs the `mcp-gate` in standalone mode (no downstream MCP) and verifies
 * that the `condition_prompt` tool is available and functioning correctly, including
 * the preservation of critical 'MUST' instructions during distillation.
 * 
 * @returns {Promise<void>} Resolves when the smoke test completes, or exits the process with a non-zero status on failure.
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
