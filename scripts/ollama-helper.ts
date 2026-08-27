import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env explicitly for scripts
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

export const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
export const SLM_TIMEOUT_MS = process.env.SLM_TIMEOUT_MS || '60000';
export const SLM_GATE_MODEL = process.env.SLM_GATE_MODEL || 'qwen2.5-coder:3b';
export const SLM_BRAIN_MODEL = process.env.SLM_BRAIN_MODEL || 'qwen3.5:9b';
export const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || '12h';

/**
 * Checks if Ollama is running and warms up the specified models so they are
 * mounted into memory/VRAM before tests start, avoiding standby cold-start timeouts.
 *
 * @param {string[]} [models] - List of model names to check and warm up.
 * @param {number} [mountWaitMs=1000] - Additional buffer delay in ms after warmup to let model stabilize.
 * @returns {Promise<boolean>} True if Ollama is reachable and warmed up, false otherwise.
 */
export async function ensureOllamaReady(
  models: string[] = [SLM_GATE_MODEL, SLM_BRAIN_MODEL],
  mountWaitMs = 1000
): Promise<boolean> {
  console.log(`[ollama-helper] Checking Ollama reachability at ${OLLAMA_HOST}...`);

  let availableModels: string[] = [];
  try {
    const res = await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/tags`, {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) {
      console.warn(`[ollama-helper] Ollama responded with HTTP ${res.status}`);
      return false;
    }
    const data = await res.json() as { models?: Array<{ name: string; model?: string }> };
    availableModels = (data.models || []).map(m => m.name || m.model || '');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ollama-helper] Ollama is not reachable at ${OLLAMA_HOST}: ${msg}`);
    return false;
  }

  console.log(`[ollama-helper] Ollama is online. Available models: [${availableModels.join(', ')}]`);

  const uniqueModels = Array.from(new Set(models));
  for (const model of uniqueModels) {
    const isPresent = availableModels.some(m => m === model || m.startsWith(`${model}:`));
    if (!isPresent) {
      console.warn(`[ollama-helper] Warning: Model '${model}' not found in Ollama tags.`);
      continue;
    }

    console.log(`[ollama-helper] Warming up model '${model}' (mounting to memory)...`);
    const startMount = Date.now();
    try {
      await fetch(`${OLLAMA_HOST.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt: 'warmup',
          stream: false,
          keep_alive: OLLAMA_KEEP_ALIVE,
          options: { num_predict: 1 }
        }),
        signal: AbortSignal.timeout(parseInt(SLM_TIMEOUT_MS, 10))
      });
      const mountElapsed = ((Date.now() - startMount) / 1000).toFixed(1);
      console.log(`[ollama-helper] Model '${model}' ready in ${mountElapsed}s.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ollama-helper] Warmup request for '${model}' failed: ${msg}`);
    }
  }

  if (mountWaitMs > 0) {
    console.log(`[ollama-helper] Waiting ${mountWaitMs}ms for standby stabilization...`);
    await new Promise(resolve => setTimeout(resolve, mountWaitMs));
  }

  console.log(`[ollama-helper] Ollama preparation complete. Timeout set to ${SLM_TIMEOUT_MS}ms.`);
  return true;
}

/**
 * Returns an environment map configured with OLLAMA_HOST, SLM_TIMEOUT_MS,
 * and model names suitable for child process transports.
 *
 * @param {Record<string, string>} [overrides] - Specific environment overrides.
 * @returns {Record<string, string>} Complete environment dictionary for child processes.
 */
export function getE2EEnv(overrides: Record<string, string> = {}): Record<string, string> {
  const baseEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) {
      baseEnv[k] = v;
    }
  }

  return {
    ...baseEnv,
    OLLAMA_HOST,
    OLLAMA_KEEP_ALIVE,
    SLM_TIMEOUT_MS,
    SLM_GATE_MODEL,
    SLM_BRAIN_MODEL,
    ...overrides
  };
}
