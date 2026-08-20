import { SLM } from '../models/slm.js';
import { CONFIG } from '../config.js';
import { buildPreserveList, distill } from './distill.js';
import { scan } from './ground.js';
import { resolveAmbiguities } from '../resolver/index.js';
import { cacheGet, cacheSet, writeEvent } from '../ledger/index.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { z } from 'zod';

let slmClient: ReturnType<typeof createSlmClient>;
/**
 * Creates and initializes a new instance of the Small Language Model (SLM) client.
 * @returns {SLM} A new SLM client instance.
 */
function createSlmClient() {
  return new SLM();
}

let cachedPreserveList: RegExp[] | null = null;
/**
 * Retrieves the compiled list of regular expressions used to identify text blocks 
 * that must be preserved verbatim during the distillation process. Results are cached.
 * @returns {Promise<RegExp[]>} A promise resolving to an array of preservation regular expressions.
 */
async function getPreserveList(): Promise<RegExp[]> {
  if (!cachedPreserveList) {
    cachedPreserveList = await buildPreserveList();
  }
  return cachedPreserveList;
}

/**
 * The main entry point for the MCP gate pipeline. Processes an incoming prompt by checking the cache, 
 * optionally distilling (compressing) the text, grounding it with workspace context, and resolving 
 * ambiguities using a small language model. 
 * 
 * @param {string} text - The raw skill/prompt text received from the client.
 * @param {string} task - A description of the current task for context during distillation and resolution.
 * @param {string} [rootUri] - Optional URI of the workspace root to enable grounding and file context extraction.
 * @returns {Promise<string>} The conditioned and enriched prompt ready for the cloud model.
 */
export async function conditionPrompt(text: string, task: string, rootUri?: string): Promise<string> {
  const startTime = Date.now();
  
  if (!slmClient) {
    slmClient = createSlmClient();
  }

  // 1. Cache Check
  const hash = crypto.createHash('sha256').update(text + '||' + task + '||' + (rootUri || '')).digest('hex');
  const cacheKey = `condition_${hash}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }

  const preserveList = await getPreserveList();

  // 2. Distill
  const slmFunc = async (t: string, taskDesc?: string) => {
    // Generate text completion for compression
    const prompt = `Task: ${taskDesc || 'None'}\\nCompress this content while keeping instructions clear:\\n${t}`;
    return slmClient.generateText(CONFIG.SLM_GATE_MODEL, [{ role: 'user', content: prompt }]);
  };
  
  const startDistill = Date.now();
  let conditioned = text;
  let distillTimeoutFlag = false;
  try {
    conditioned = await distill(slmFunc, text, task, preserveList);
  } catch (err: any) {
    if (err.name === 'SlmTimeoutError' || err.message?.includes('fetch failed')) {
      console.warn(`[pipeline] Warning: distill_timeout`);
      distillTimeoutFlag = true;
      conditioned = text;
    } else {
      console.warn(`[pipeline] Warning: distill failed -`, err);
    }
  }
  console.error(`[pipeline] distill ${((Date.now() - startDistill) / 1000).toFixed(1)}s`);

  // 3. Ground
  let groundCtx = '';
  if (rootUri) {
    groundCtx = await scan(rootUri);
  }

  // 4. Clarify (Resolver)
  let fsReadFn = async (pattern: string) => [] as string[];
  if (rootUri) {
    let rootPath = rootUri;
    if (rootUri.startsWith('file://')) {
       try { rootPath = fileURLToPath(rootUri); } catch { rootPath = rootUri.substring(7); }
    }
    fsReadFn = async (pattern: string) => {
      try {
        const content = await fs.readFile(path.join(rootPath, pattern), 'utf-8');
        return content.split('\\n').slice(0, 50); // limit lines
      } catch {
        return [];
      }
    };
  }

  const startResolver = Date.now();
  let resolveOut = { autoApplied: [] as any[], askUser: [] as any[] };
  let resolverTimeoutFlag = false;
  try {
    resolveOut = await resolveAmbiguities(slmClient, fsReadFn, {
      skillText: text,
      task,
      repoRoot: rootUri ? (rootUri.startsWith('file://') ? fileURLToPath(rootUri) : rootUri) : undefined
    });
  } catch (err: any) {
    if (err.name === 'SlmTimeoutError' || err.message?.includes('fetch failed')) {
      console.warn(`[pipeline] Warning: resolver_timeout`);
      resolverTimeoutFlag = true;
    } else {
      console.warn(`[pipeline] Warning: resolver failed -`, err);
    }
  }
  console.error(`[pipeline] resolver ${((Date.now() - startResolver) / 1000).toFixed(1)}s`);

  // Append findings to the conditioned output
  if (groundCtx) {
    conditioned += `\\n\\n# Environment Context\\n${groundCtx}`;
  }
  
  if (resolveOut.autoApplied.length > 0) {
    conditioned += `\\n\\n# Auto-Resolved Decisions\\n`;
    for (const res of resolveOut.autoApplied) {
      conditioned += `- **${res.question}**: ${res.answer}\\n`;
    }
  }

  if (resolveOut.askUser.length > 0) {
    conditioned += `\\n\\n# Pending Clarifications (Ask User)\\n`;
    for (const ask of resolveOut.askUser) {
      conditioned += `- **${ask.question}** (Recommendation: ${ask.recommendedAnswer || 'None'})\\n`;
    }
  }
  
  if (distillTimeoutFlag) {
    conditioned += `\\n\\n# Note\\n[distill_timeout] Skill text compression timed out.`;
  }
  if (resolverTimeoutFlag) {
    conditioned += `\\n\\n# Note\\n[resolver_timeout] Ambiguity resolution timed out.`;
  }

  // 5. Ledger
  const latency = (Date.now() - startTime) / 1000;
  writeEvent({
    ts: new Date().toISOString(),
    layer: 'mcp',
    request_id: `cond_${Date.now()}_${Math.random().toString(36).substring(7)}`,
    route: 'condition',
    is_local_call: 1,
    slm_model: CONFIG.SLM_GATE_MODEL,
    in_tok: Math.round(text.length / 4),
    out_tok: Math.round(conditioned.length / 4),
    api_in_tok: 0,
    api_out_tok: 0,
    cost_usd: 0,
    slm_latency_s: latency,
    api_latency_s: 0,
    slm_gate: 'on'
  });

  // 6. Cache Set
  cacheSet(cacheKey, conditioned);

  return conditioned;
}
