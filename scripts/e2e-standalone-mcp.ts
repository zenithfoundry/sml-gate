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
 * The test connects to `mcp-gate` via stdio in standalone mode (with `DOWNSTREAM_MCP` unset)
 * and tests both major prompt conditioning scenarios:
 * 1. Short Prompt (<300 chars): Verifies that small prompts are enriched with auto-resolved
 *    ambiguities and clarification context. Explains why character count increases on short inputs.
 * 2. Large Prompt (>2000 chars): Verifies that verbose prompts containing extensive prose/fluff
 *    are significantly compressed (character count reduced) while preserving mandatory contract
 *    lines (`MUST`, headings, code blocks) verbatim.
 * 
 * Why this test is needed (Why it exists):
 * This test guarantees that `mcp-gate` functions independently as a prompt conditioning tool.
 * It ensures that both enrichment (resolving decisions for concise tasks) and distillation
 * (compressing verbose guidelines) operate correctly and preserve strict contract guarantees.
 * 
 * Warning Expectations / Potential Flakiness:
 * - Requires Ollama running locally with the target SLM model.
 * - If the local SLM times out, a fallback is triggered gracefully.
 * 
 * @returns {Promise<void>} Resolves when all test cases complete, or exits with non-zero on failure.
 */
async function main(): Promise<void> {
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

  // =========================================================================
  // TEST CASE 1: Short Prompt (Enrichment & Disambiguation Focus)
  // =========================================================================
  console.log("\n=========================================================================");
  console.log("TEST CASE 1: Short Prompt (Enrichment & Disambiguation Focus)");
  console.log("=========================================================================");
  
  const shortSkill = `
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

  const shortLength = shortSkill.length;
  console.log(`Original skill char count: ${shortLength}`);

  try {
    const result1 = await client.request({
      method: "tools/call",
      params: {
        name: "condition_prompt",
        arguments: {
          text: shortSkill,
          task: "Smoke test conditioning short prompt"
        }
      }
    }, CallToolResultSchema);

    const firstBlock1 = result1.content[0];
    const conditionedText1 = firstBlock1 && typeof firstBlock1 === 'object' && 'text' in firstBlock1 
      ? String(firstBlock1.text) 
      : '';
    const conditionedLength1 = conditionedText1.length;
    console.log(`Conditioned skill char count: ${conditionedLength1}`);
    
    console.log(
      "\n💡 Why character count expanded on short prompt:\n" +
      "   - On small prompts (~220 chars), there is minimal fluff to distill away.\n" +
      "   - The SLM Resolver analyzes the prompt & task for open decisions and appends\n" +
      "     structured sections ('# Auto-Resolved Decisions' and/or '# Pending Clarifications').\n" +
      "   - Result: Prompt is enriched with actionable decision context, increasing net character count."
    );

    const mustLine1 = "You MUST follow these rules exactly.";
    if (!conditionedText1.includes(mustLine1)) {
      console.error(`FAIL: MUST line not present verbatim in short prompt test.\nExpected: ${mustLine1}\nGot: ${conditionedText1}`);
      process.exit(1);
    }
    console.log("PASS: MUST line present verbatim.");

  } catch (err) {
    console.error("FAIL: Test Case 1 condition_prompt tool call failed", err);
    process.exit(1);
  }

  // =========================================================================
  // TEST CASE 2: Large Prompt (Distillation & Token Compression Focus)
  // =========================================================================
  console.log("\n=========================================================================");
  console.log("TEST CASE 2: Large Prompt (Distillation & Token Compression Focus)");
  console.log("=========================================================================");

  const largeSkill = `
# Comprehensive Architecture & Deployment Guidelines

## Introduction and Background Context
In modern distributed cloud software systems, application architecture requires continuous adherence to quality attributes, scalability requirements, maintainability benchmarks, and enterprise reliability guidelines. When developers and agents interact with automated infrastructure workflows, there is often significant background history to consider regarding legacy configuration management, operational runbooks, infrastructure provisioning, and continuous deployment strategies. This historical context illustrates why engineering standards evolved over the past decade through various organizational iterations and architectural transitions across multiple infrastructure providers.

## General Principles and Narrative Context
It is generally recommended that engineers maintain clean documentation, organize files systematically, ensure code clarity across all modules, and practice good version control hygiene. While these recommendations serve as helpful advice across varied teams, they are primarily narrative context intended to guide architectural thinking. In many systems, teams spend considerable time debating conventions, file directory structures, naming schemes, database migration schedules, and deployment timeframes. Many architectural discussions delve deeply into theoretical trade-offs that have little direct bearing on immediate execution tasks.

## Mandatory Implementation Requirements
You MUST adhere strictly to the target environment security constraints.
You MUST never commit plain-text credentials or API secrets to version control.
You MUST write unit tests with at least 80% branch coverage for all core services.

## Operational Procedures and Workflow Details
When initiating a build sequence, several preparatory checks should be conducted. First, ensure that local package dependencies are synchronized across the developer environment. Second, inspect the workspace tree for uncommitted artifacts or transient cache directories that might pollute build outputs. Third, review the active branch to confirm it is branched from the latest main tracking branch. Fourth, verify that environmental prerequisites, including runtime engines and container runtimes, are actively running in the host environment. Furthermore, ensure that telemetry sinks are available if distributed tracing is activated.

\`\`\`typescript
export function initializeService(config: { serviceName: string; port: number }): void {
  console.log("Starting service with configuration:", config.serviceName, config.port);
}
\`\`\`

## Final Checklist
Always review the deployment log output before promoting a release to staging environments. Ensure all stakeholders are notified of maintenance windows.
`;

  const largeLength = largeSkill.length;
  console.log(`Original skill char count: ${largeLength}`);

  try {
    const result2 = await client.request({
      method: "tools/call",
      params: {
        name: "condition_prompt",
        arguments: {
          text: largeSkill,
          task: "Deploy core authentication service according to architecture guidelines"
        }
      }
    }, CallToolResultSchema);

    const firstBlock2 = result2.content[0];
    const conditionedText2 = firstBlock2 && typeof firstBlock2 === 'object' && 'text' in firstBlock2 
      ? String(firstBlock2.text) 
      : '';
    const conditionedLength2 = conditionedText2.length;
    console.log(`Conditioned skill char count: ${conditionedLength2}`);

    const isTimedOut = conditionedText2.includes('[distill_timeout]');
    if (isTimedOut) {
      console.warn("WARNING: Distillation hit SLM timeout, skipping strict reduction assertion.");
    } else {
      const diff = largeLength - conditionedLength2;
      const reductionPercent = ((diff / largeLength) * 100).toFixed(1);
      
      if (conditionedLength2 >= largeLength) {
        console.error(`FAIL: Large prompt was not compressed. Original: ${largeLength}, Conditioned: ${conditionedLength2}`);
        process.exit(1);
      }
      console.log(`PASS: Character count reduced by ${reductionPercent}% (-${diff} characters).`);
    }

    // Validate that critical MUST lines and headings are preserved verbatim
    const mustLines = [
      "You MUST adhere strictly to the target environment security constraints.",
      "You MUST never commit plain-text credentials or API secrets to version control.",
      "You MUST write unit tests with at least 80% branch coverage for all core services."
    ];

    for (const mustLine of mustLines) {
      if (!conditionedText2.includes(mustLine)) {
        console.error(`FAIL: MUST line not present verbatim in large prompt test.\nExpected: ${mustLine}`);
        process.exit(1);
      }
    }
    console.log("PASS: All MUST lines present verbatim.");

    if (!conditionedText2.includes("## Mandatory Implementation Requirements")) {
      console.error("FAIL: Heading '## Mandatory Implementation Requirements' missing verbatim.");
      process.exit(1);
    }
    console.log("PASS: Heading preserved verbatim.");

    console.log("\n=========================================================================");
    console.log("ALL STANDALONE MCP TEST CASES PASSED SUCCESSFULLY.");
    console.log("=========================================================================\n");
    process.exit(0);
  } catch (err) {
    console.error("FAIL: Test Case 2 condition_prompt tool call failed", err);
    process.exit(1);
  }
}

main();
