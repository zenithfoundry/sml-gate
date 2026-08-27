import { CONFIG } from '../config.js';
import { handleSlmError } from '../models/helpers.js';
import { LedgerEvent } from '../ledger/index.js';
import { classify } from '../models/reasoning.js';
import { SLM } from '../models/slm.js';
import { calculateCostUsd } from '../pricing/index.js';
import { compressContext } from '../utils/compression.js';
import { isLatestInstructionFromTool } from '../utils/safety.js';
import { verify } from '../verifier/index.js';
import { buildAnthropicRequest } from './formats/anthropic.js';
import { InternalMessage, InternalRequest } from './formats/internal.js';
import { buildOpenAIRequest } from './formats/openai.js';

export interface PipelineOptions {
  routePolicy: 'raw' | 'auto' | 'force-local';
}

export interface PipelineResult {
  body: any;
  route: LedgerEvent['route'];
  isLocal: boolean;
  model: string;
  inTok: number;
  outTok: number;
  apiInTok: number;
  apiOutTok: number;
  costUsd: number;
  slmLatency: number;
  apiLatency: number;
  verifierFlags: string[];
}

// Very basic token estimator. A real implementation would use a proper tokenizer like tiktoken.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function countMessagesTokens(messages: InternalMessage[], system?: string): number {
  let text = system || '';
  for (const m of messages) {
    text += '\n' + m.content;
  }
  return estimateTokens(text);
}

/**
 * The core orchestration pipeline for a single LLM Gate request.
 * 
 * Pipeline flow:
 * 1. Derives the core task from the last user message.
 * 2. If routePolicy allows local deferral and heuristics approve (no tool injection), 
 *    classifies the task with the SLM.
 * 3. If the task type is simple enough, generates an answer locally.
 * 4. Verifies the local answer against rigorous constraints.
 * 5. If verified and safe, returns the local answer (deferring the cloud call entirely).
 * 6. If it escalates or is forced, compresses the context and calls the upstream Cloud API.
 * 
 * @param reqId A unique request identifier
 * @param internalReq The internal request representation
 * @param options Routing configurations
 * @returns A fully constructed response payload and detailed token/cost analytics
 */
export async function processPipeline(
  reqId: string,
  internalReq: InternalRequest,
  options: PipelineOptions
): Promise<PipelineResult> {
  console.info('LLM Gate Pipeline: Started');

  const t0 = Date.now();
  const slm = new SLM();
  const messages = internalReq.messages;

  const result: PipelineResult = {
    body: null,
    route: 'forward_raw',
    isLocal: false,
    model: '',
    inTok: countMessagesTokens(messages, internalReq.system),
    outTok: 0,
    apiInTok: 0,
    apiOutTok: 0,
    costUsd: 0,
    slmLatency: 0,
    apiLatency: 0,
    verifierFlags: []
  };

  const isSafeForLocal = !isLatestInstructionFromTool(messages);
  const routePolicy = options.routePolicy;

  let localDeferred = false;
  let localAnswer = '';
  let localModel = CONFIG.SLM_BRAIN_MODEL;

  // Derive task (last user message)
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const taskText = lastUserMsg ? lastUserMsg.content : '';

  if (routePolicy === 'force-local' || (routePolicy === 'auto' && isSafeForLocal)) {
    // Attempt local classification
    let category = 'other';
    try {
      if (taskText) {
        category = await classify(slm, taskText);
      }
    } catch (e) {
      // Classification failed, default to 'other'
    }

    const allowList = ['classify', 'extract', 'format', 'boolean', 'short_factual', 'trivial_edit'];
    
    if (routePolicy === 'force-local' || allowList.includes(category)) {
      // Try local answer
      try {
        let answer = '';
        let samples: string[] = [];
        
        if (CONFIG.HEADLINE_STRICTNESS >= 4) {
          // Just run it 3 times sequentially to simulate generating samples
          // A proper selfConsistency requires structured outputs, but for text we can do it here:
          const k = CONFIG.SELF_CONSISTENCY_K;
          const promises = Array.from({ length: k }).map(() =>
            slm.generateText(localModel, messages, CONFIG.SELF_CONSISTENCY_TEMP)
          );
          samples = await Promise.all(promises);
          answer = samples[0]; // Simplified: just pick first or we could use checkAgreement if we lifted it
        } else {
          answer = await slm.generateText(localModel, messages, CONFIG.TEMPERATURE);
        }

        const vResult = verify(answer, samples, { nonEmpty: true }, CONFIG.HEADLINE_STRICTNESS);
        result.verifierFlags = vResult.flags;

        if (!vResult.escalate || routePolicy === 'force-local') {
          localDeferred = true;
          localAnswer = answer;
        }
      } catch (e: any) {
        if (e.name === 'SlmTimeoutError' || e.message?.includes('fetch failed') || e.code === 'ECONNREFUSED' || e.message?.includes('ECONNREFUSED')) {
          handleSlmError(e, 'llm-gate:generate', localModel);
        } else {
          handleSlmError(e, 'llm-gate:generate', localModel);
        }
        // Local generation failed, fall through to escalate
      }
    }
  }

  result.slmLatency = (Date.now() - t0) / 1000;

  if (localDeferred) {
    result.route = 'defer_local';
    result.isLocal = true;
    result.model = localModel;
    result.outTok = estimateTokens(localAnswer);
    result.costUsd = calculateCostUsd(localModel, result.inTok, result.outTok);

    // Format local answer as a standard completion in the internal format
    // Since we stream in the server based on the return format, here we just return the full response.
    // Streaming wrapper is handled outside if internalReq.stream is true.
    result.body = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: localAnswer
          }
        }
      ]
    };
    return result;
  }

  // Fallthrough: Escalate to Cloud
  const t1 = Date.now();
  let compressedReq = { ...internalReq };
  
  if (routePolicy !== 'raw') {
    compressedReq.messages = compressContext(messages);
    result.route = 'forward_compressed';
  } else {
    result.route = 'forward_raw';
  }

  // Format the request for the cloud provider
  let fetchUrl = CONFIG.CLOUD_BASE_URL;
  let fetchHeaders: any = {
    'Content-Type': 'application/json'
  };
  let fetchBody: any;

  if (CONFIG.CLOUD_API_STYLE === 'anthropic') {
    fetchUrl = fetchUrl || 'https://api.anthropic.com/v1/messages';
    fetchHeaders['x-api-key'] = CONFIG.CLOUD_API_KEY;
    fetchHeaders['anthropic-version'] = '2023-06-01';
    fetchBody = buildAnthropicRequest(compressedReq);
  } else {
    // openai style
    fetchUrl = fetchUrl || 'https://api.openai.com/v1/chat/completions';
    fetchHeaders['Authorization'] = `Bearer ${CONFIG.CLOUD_API_KEY}`;
    fetchBody = buildOpenAIRequest(compressedReq);
  }

  result.apiInTok = countMessagesTokens(compressedReq.messages, compressedReq.system);

  // Perform API request
  try {
    console.log('DEBUG FETCH:', { fetchUrl, fetchHeaders: {...fetchHeaders, Authorization: `${fetchHeaders.Authorization.slice(7, 10)}***`}, fetchBody: JSON.stringify(fetchBody, null, 2) });
    const apiRes = await fetch(fetchUrl!, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify(fetchBody),
      signal: AbortSignal.timeout(30000)
    });

    if (!apiRes.ok) {
      throw new Error(`Cloud API Error: ${apiRes.statusText}`);
    }

    if (internalReq.stream) {
      // In stream mode, we return the stream to the caller
      result.body = apiRes.body; // Pass the readable stream
    } else {
      const data = await apiRes.json();
      result.body = data;
      
      // Token counting
      if (CONFIG.CLOUD_API_STYLE === 'anthropic') {
        result.apiOutTok = data.usage?.output_tokens || 0;
        result.apiInTok = data.usage?.input_tokens || result.apiInTok;
      } else {
        result.apiOutTok = data.usage?.completion_tokens || 0;
        result.apiInTok = data.usage?.prompt_tokens || result.apiInTok;
      }
    }
  } catch (err: any) {
    throw new Error(`Cloud request failed: ${err.message}`);
  }

  result.apiLatency = (Date.now() - t1) / 1000;
  result.model = CONFIG.CLOUD_MODEL || 'unknown';
  result.outTok = result.apiOutTok;
  result.costUsd = calculateCostUsd(result.model, result.apiInTok, result.apiOutTok);

  return result;
}
