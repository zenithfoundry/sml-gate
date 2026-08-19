import { InternalRequest, InternalMessage } from './internal.js';

/**
 * Parses an incoming OpenAI-formatted chat completion request and translates it 
 * into the agnostic `InternalRequest` structure.
 * It also hoists the first "system" message out of the messages array for alignment.
 * 
 * @param body The raw JSON body of an OpenAI API request
 * @param modelFallback A default model to use if the request omits it
 */
export function parseOpenAIRequest(body: any, modelFallback: string): InternalRequest {
  const messages: InternalMessage[] = [];
  let system: string | undefined;

  for (const m of (body.messages || [])) {
    if (m.role === 'system') {
      system = m.content; // Grab the first system message
      // We still include it in messages so that when we serialize to OpenAI it remains
      messages.push({ role: 'system', content: m.content });
    } else if (m.role === 'tool' || m.role === 'function') {
      messages.push({ role: 'tool', content: m.content });
    } else if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
    }
  }

  return {
    system,
    messages,
    maxTokens: body.max_tokens,
    stream: !!body.stream,
    tools: body.tools,
    model: body.model || modelFallback
  };
}

export function buildOpenAIRequest(internal: InternalRequest): any {
  const req: any = {
    model: internal.model,
    messages: internal.messages.map(m => ({ role: m.role, content: m.content })),
  };
  
  if (internal.maxTokens !== undefined) {
    req.max_tokens = internal.maxTokens;
  }
  
  if (internal.tools && internal.tools.length > 0) {
    req.tools = internal.tools;
  }
  
  if (internal.stream) {
    req.stream = true;
    req.stream_options = { include_usage: true };
  }

  return req;
}

export function formatOpenAIStreamChunk(id: string, model: string, content: string, finishReason: string | null = null, usage: any = null): string {
  const chunk: any = {
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: []
  };

  if (content !== '' || finishReason !== null) {
    chunk.choices.push({
      index: 0,
      delta: content ? { content } : {},
      finish_reason: finishReason
    });
  }

  if (usage) {
    chunk.usage = usage;
  }

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export const OPENAI_STREAM_DONE = 'data: [DONE]\n\n';
