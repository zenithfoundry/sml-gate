import { InternalRequest, InternalMessage } from './internal.js';

/**
 * Parses an incoming Anthropic-formatted messages request and translates it 
 * into the agnostic `InternalRequest` structure.
 * Anthropic uses a top-level `system` field, which seamlessly maps to our internal structure.
 * 
 * @param body The raw JSON body of an Anthropic API request
 * @param modelFallback A default model to use if the request omits it
 */
export function parseAnthropicRequest(body: any, modelFallback: string): InternalRequest {
  const messages: InternalMessage[] = [];
  let system: string | undefined;

  if (body.system) {
    if (typeof body.system === 'string') {
      system = body.system;
    } else if (Array.isArray(body.system)) {
      system = body.system.map((b: any) => b.text || '').join('\n');
    }
  }

  for (const m of (body.messages || [])) {
    let content = '';
    if (typeof m.content === 'string') {
      content = m.content;
    } else if (Array.isArray(m.content)) {
      content = m.content.map((b: any) => b.text || JSON.stringify(b)).join('\n');
    }
    messages.push({ role: m.role, content });
  }

  return {
    system,
    messages,
    maxTokens: body.max_tokens,
    stream: !!body.stream,
    tools: body.tools, // If Anthropic native tools are sent
    model: body.model || modelFallback
  };
}

export function buildAnthropicRequest(internal: InternalRequest): any {
  // Strip out any internal system messages from the messages array
  const cleanMessages = internal.messages.filter(m => m.role !== 'system');
  
  const req: any = {
    model: internal.model,
    messages: cleanMessages.map(m => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
    max_tokens: internal.maxTokens || 4096, // REQUIRED for Anthropic
  };
  
  if (internal.system) {
    req.system = internal.system;
  }
  
  if (internal.tools && internal.tools.length > 0) {
    req.tools = internal.tools;
  }
  
  if (internal.stream) {
    req.stream = true;
  }

  return req;
}

export function formatAnthropicStreamChunk(content: string, isFirst: boolean = false, isLast: boolean = false, usage: any = null): string {
  let chunks = '';

  if (isFirst) {
    chunks += `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: 'local', content: [] } })}\n\n`;
    chunks += `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`;
  }

  if (content) {
    chunks += `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: content } })}\n\n`;
  }

  if (isLast) {
    chunks += `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`;
    chunks += `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage })}\n\n`;
    chunks += `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`;
  }

  return chunks;
}
