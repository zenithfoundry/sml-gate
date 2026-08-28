import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

// Load .env (if it exists) into process.env. Does not crash if missing.
config();

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const ROOT_DIR = path.resolve(dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');

// Zod pre-processors for env strings
const parseInteger = (fallback: number) => z.string().optional().transform(v => v ? parseInt(v, 10) : fallback);
const parseFloatNumber = (fallback: number) => z.string().optional().transform(v => v ? parseFloat(v) : fallback);
const parseBoolean = (fallback: boolean) => z.string().optional().transform(v => {
  if (!v) return fallback;
  return v.toLowerCase() === 'on' || v.toLowerCase() === 'true' || v === '1';
});
const parseNumberArray = (fallback: number[]) => z.string().optional().transform(v => v ? v.split(',').map(n => parseInt(n.trim(), 10)) : fallback);
const parseStringArray = (fallback: string[]) => z.string().optional().transform(v => v ? v.split(',').map(s => s.trim()) : fallback);
const parseDownstreamMcp = () => z.string().optional().transform(v => {
  if (!v) return null;
  try {
    const parsed = JSON.parse(v);
    if (parsed.command) {
      return { command: parsed.command, args: parsed.args, env: parsed.env } as any;
    }
    if (parsed.url) {
      return { url: parsed.url, headers: parsed.headers } as any;
    }
    return null;
  } catch {
    return null;
  }
});

const envSchema = z.object({
  // STEP 1
  SLM_PROVIDER: z.enum(['ollama', 'openai']).default('ollama'),
  OLLAMA_HOST: z.string().default('http://localhost:11434'),
  OLLAMA_KEEP_ALIVE: z.string().default('12h'),
  SLM_BRAIN_MODEL: z.string().optional(), // resolved below
  SLM_GATE_MODEL: z.string().optional(),  // resolved below
  NUM_CTX: parseInteger(8192),
  TEMPERATURE: parseFloatNumber(0),
  SLM_TIMEOUT_MS: parseInteger(120000),
  SELF_CONSISTENCY_K: parseInteger(3),
  SELF_CONSISTENCY_TEMP: parseFloatNumber(0.7),

  // STEP 2
  STRICTNESS_LEVELS: parseNumberArray([0, 1, 2, 3, 4, 5]),
  HEADLINE_STRICTNESS: parseInteger(4),

  // STEP 3
  CLOUD_API_STYLE: z.enum(['openai', 'anthropic']).default('openai'),
  CLOUD_BASE_URL: z.string().optional(),
  CLOUD_API_KEY: z.string().optional(),
  CLOUD_MODEL: z.string().optional(),

  // STEP 4
  LLM_GATE_PORT: parseInteger(8787),
  LLM_GATE_EXPOSE: parseStringArray(['openai', 'anthropic']),
  DOWNSTREAM_MCP: parseDownstreamMcp(),
  MCP_GATE_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_GATE_PORT: parseInteger(8788),

  // STEP 5
  LEDGER_PATH: z.string().default(path.join(OUTPUT_DIR, 'ledger.sqlite')),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_HOST: z.string().optional(),

  // STEP 6
  RESOLVER_CLOUD_TIER: parseBoolean(false),
  RESOLVER_CLOUD_BUDGET_USD: parseFloatNumber(0),
  PROMPT_VERSION: z.string().default('v1'),
  RAM_PRESET: z.enum(['ram-4', 'ram-8', 'ram-12', 'ram-16', 'ram-24', 'ram-32', 'custom']).default('custom'),
  TLS_ADAPTER: parseBoolean(false),
  DISTILL_PRESERVE_PATH: z.string().optional().transform(v => v?.trim() || null),
  DISTILL_PRESERVE_MODE: z.enum(['extend', 'replace']).default('extend'),
});

const parsedEnv = envSchema.parse(process.env);

const ramPresets: Record<string, { brain: string, gate: string }> = {
  'ram-4': { brain: 'qwen3.5:1.5b', gate: 'qwen3.5:0.5b' },
  'ram-8': { brain: 'qwen3.5:3b', gate: 'qwen3.5:0.5b' },
  'ram-12': { brain: 'qwen3:7b', gate: 'qwen3:1.7b' },
  'ram-16': { brain: 'qwen3:7b', gate: 'qwen3:1.7b' },
  'ram-24': { brain: 'qwen3:14b', gate: 'qwen3:1.7b' },
  'ram-32': { brain: 'qwen3:14b', gate: 'qwen3:1.7b' },
  'custom': { brain: 'qwen3:14b', gate: 'qwen3:1.7b' },
};

const preset = ramPresets[parsedEnv.RAM_PRESET] || ramPresets['custom'];

export const CONFIG = Object.freeze({
  ...parsedEnv,
  ROOT_DIR,
  OUTPUT_DIR,
  SLM_BRAIN_MODEL: parsedEnv.SLM_BRAIN_MODEL || preset.brain,
  SLM_GATE_MODEL: parsedEnv.SLM_GATE_MODEL || preset.gate,
});

/**
 * Validates that specific keys exist and are non-empty. Throws actionable errors if missing.
 * Called right before an operation that requires them, NOT on module boot.
 */
export function requireKeys(keys: Array<keyof typeof CONFIG>) {
  const missing = keys.filter(k => !CONFIG[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required configuration for this operation: ${missing.join(', ')}. Please update your .env file.`);
  }
}

// Config test script executed via `pnpm run config`
if (process.argv[1] && (import.meta.url === `file://${process.argv[1]}` || import.meta.url === `file://${path.resolve(process.argv[1])}`)) {
  console.log('=== SMALL-LANGUAGE-MODEL-GATE CONFIGURATION ===');
  
  const redactedConfig = { ...CONFIG } as any;
  if (redactedConfig.CLOUD_API_KEY) redactedConfig.CLOUD_API_KEY = '<SET>';
  else redactedConfig.CLOUD_API_KEY = '<UNSET>';
  
  if (redactedConfig.LANGFUSE_SECRET_KEY) redactedConfig.LANGFUSE_SECRET_KEY = '<SET>';
  else redactedConfig.LANGFUSE_SECRET_KEY = '<UNSET>';

  if (redactedConfig.LANGFUSE_PUBLIC_KEY) redactedConfig.LANGFUSE_PUBLIC_KEY = '<SET>';
  else redactedConfig.LANGFUSE_PUBLIC_KEY = '<UNSET>';

  console.log(JSON.stringify(redactedConfig, null, 2));

  console.log('\n--- Summary ---');
  console.log(`brain: ${CONFIG.SLM_BRAIN_MODEL} | gate: ${CONFIG.SLM_GATE_MODEL}`);
  
  const downstream = CONFIG.DOWNSTREAM_MCP ? (CONFIG.DOWNSTREAM_MCP.command ? `command: ${CONFIG.DOWNSTREAM_MCP.command}` : `url: ${CONFIG.DOWNSTREAM_MCP.url}`) : 'standalone';
  console.log(`downstream: ${downstream}`);
  
  const sinks = ['sqlite'];
  if (CONFIG.LANGFUSE_PUBLIC_KEY && CONFIG.LANGFUSE_SECRET_KEY && CONFIG.LANGFUSE_HOST) {
    sinks.push('langfuse');
  }
  console.log(`sinks: [${sinks.join(', ')}]`);
}
