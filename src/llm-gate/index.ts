import { server } from './server.js';
import { CONFIG } from '../config.js';
import { LangfuseSink } from '../ledger/index.js';

/**
 * Entry point for the `llm-gate` layer.
 * 
 * Can be imported as a module (`export { server }`) for integration testing,
 * or executed directly via CLI to boot the standalone HTTP proxy server.
 */

if (import.meta.url === `file://${process.argv[1]}`) {
  const sinks = ['sqlite'];
  if (CONFIG.LANGFUSE_PUBLIC_KEY && CONFIG.LANGFUSE_SECRET_KEY && CONFIG.LANGFUSE_HOST) {
    sinks.push('langfuse');
  }

  server.listen(CONFIG.LLM_GATE_PORT, () => {
    console.error(`LLM Gate running on port ${CONFIG.LLM_GATE_PORT} (inbound: ${CONFIG.LLM_GATE_EXPOSE.join(', ')}). sinks: [${sinks.join(', ')}]`);
  });

  // Start background flush for Langfuse offline queue
  setInterval(() => {
    LangfuseSink.flushQueue().catch(err => console.error('[llm-gate] Langfuse flush error:', err));
  }, 5 * 60 * 1000);
}

export { server };
