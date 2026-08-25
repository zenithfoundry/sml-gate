import { CONFIG } from '../config.js';
import { createServer } from './server.js';
import { LangfuseSink } from '../ledger/index.js';

async function main() {
  console.error(`[mcp-gate] Starting up...`);
  console.error(`[mcp-gate] Mode: ${CONFIG.DOWNSTREAM_MCP ? 'Proxy' : 'Standalone'}`);
  console.error(`[mcp-gate] Transport: ${CONFIG.MCP_GATE_TRANSPORT}`);
  console.error(`[mcp-gate] Models -> Brain: ${CONFIG.SLM_BRAIN_MODEL} | Gate: ${CONFIG.SLM_GATE_MODEL}`);

  // Start background flush for Langfuse offline queue
  setInterval(() => {
    LangfuseSink.flushQueue().catch(err => console.error('[mcp-gate] Langfuse flush error:', err));
  }, 5 * 60 * 1000);

  try {
    const { start } = await createServer();
    await start();
    console.error(`[mcp-gate] Server is running and listening for messages.`);
  } catch (err) {
    console.error(`[mcp-gate] Fatal error during startup:`, err);
    process.exit(1);
  }
}

main();
