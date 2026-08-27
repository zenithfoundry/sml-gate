/**
 * @fileoverview
 * End-to-End Test: Distill Fallback (`e2e:distill-fallback`)
 * 
 * Expected Outcome:
 * The test spins up `mcp-gate` via stdio with an artificially constrained `SLM_TIMEOUT_MS` (e.g. 1ms).
 * It sends a prompt conditioning request to the SLM. Due to the timeout constraint, 
 * the distillation fails/times out, forcing a fallback behavior. The tool must safely return 
 * the original uncompressed text to the client (or append a fallback notice) rather than 
 * crashing or returning malformed data.
 * 
 * Why this test is needed (Why it exists):
 * This test guarantees system resilience. The SLM processing layer is a proxy optimization; 
 * if the local model hangs, crashes, or is otherwise unresponsive, the proxy must transparently 
 * fail-open and deliver the unconditioned prompt to the downstream cloud provider to prevent 
 * blocking the user's primary workflow.
 * 
 * Warning Expectations / Potential Flakiness:
 * - Requires Ollama running locally.
 * - This test is specifically designed to trigger an error/timeout condition and will 
 *   output timeout warnings in `stderr`. These warnings are expected.
 * - Generally stable, but if Ollama happens to cache the exact response and completes 
 *   in <1ms, the test might theoretically fail (though unlikely for generative tasks).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

import { getE2EEnv } from "./ollama-helper.js";

async function main() {
  console.log("Starting Distill Fallback Test...");

  const mcpGatePath = path.join(rootPath, 'dist', 'mcp-gate', 'index.js');
  
  const transport = new StdioClientTransport({
    command: 'node',
    args: [mcpGatePath],
    env: getE2EEnv({
      DOWNSTREAM_MCP: '', // Standalone mode
      SLM_TIMEOUT_MS: '1' // Force timeout
    })
  });

  const client = new Client(
    { name: "e2e-distill-fallback", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);
  console.log("Connected to mcp-gate.");

  const originalSkill = `
# Fake Skill
You MUST keep this line verbatim.
## Important Heading
Fluff text to compress. Fluff text to compress. Fluff text to compress. Fluff text to compress. 
Fluff text to compress. Fluff text to compress. Fluff text to compress. Fluff text to compress. 
Fluff text to compress. Fluff text to compress. Fluff text to compress. Fluff text to compress.
`;

  console.log("Calling condition_prompt with SLM_TIMEOUT_MS=1...");
  try {
    const result = await client.request({
      method: "tools/call",
      params: {
        name: "condition_prompt",
        arguments: {
          text: originalSkill,
          task: "Smoke test distill fallback"
        }
      }
    }, CallToolResultSchema);

    const conditionedText = String((result.content[0] as any).text);
    
    // We expect the fallback string or the original skill exactly, or a logged timeout
    if (conditionedText.includes('[distill_timeout]') || conditionedText.includes('distill_fallback') || conditionedText.length >= originalSkill.length - 20) {
       console.log("PASS: Fallback triggered successfully and original text preserved/indicated.");
       if (conditionedText.includes('You MUST keep this line verbatim.')) {
         console.log("PASS: Essential original text is still present in output.");
         process.exit(0);
       } else {
         console.error("FAIL: Original text was lost during fallback.");
         process.exit(1);
       }
    } else {
       console.error("FAIL: Did not trigger fallback flag despite 1ms timeout. Length: " + conditionedText.length);
       process.exit(1);
    }

  } catch (err) {
    console.error("FAIL: Tool call failed unexpectedly", err);
    process.exit(1);
  }
}

main();
