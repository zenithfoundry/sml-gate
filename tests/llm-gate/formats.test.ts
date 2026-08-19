import { parseOpenAIRequest, buildOpenAIRequest } from '../../src/llm-gate/formats/openai.js';
import { parseAnthropicRequest, buildAnthropicRequest } from '../../src/llm-gate/formats/anthropic.js';

describe('OpenAI Format', () => {
  it('parses inbound and serializes outbound with stream usage flag', () => {
    const raw = {
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are an AI.' },
        { role: 'user', content: 'Hello!' }
      ],
      stream: true,
      max_tokens: 100
    };

    const internal = parseOpenAIRequest(raw, 'fallback');
    expect(internal.system).toBe('You are an AI.');
    expect(internal.messages.length).toBe(2);
    expect(internal.stream).toBe(true);

    const outbound = buildOpenAIRequest(internal);
    expect(outbound.model).toBe('gpt-4o');
    expect(outbound.messages).toEqual([
      { role: 'system', content: 'You are an AI.' },
      { role: 'user', content: 'Hello!' }
    ]);
    expect(outbound.stream_options).toEqual({ include_usage: true });
    expect(outbound.max_tokens).toBe(100);
  });
});

describe('Anthropic Format', () => {
  it('parses inbound system hoist and serializes outbound with max_tokens enforcement', () => {
    const raw = {
      model: 'claude-3',
      system: 'Top level system',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' }
      ]
    };

    const internal = parseAnthropicRequest(raw, 'fallback');
    expect(internal.system).toBe('Top level system');
    expect(internal.messages.length).toBe(2);

    // If an internal request somehow had a system message in the array, it gets stripped out and placed at top
    internal.messages.unshift({ role: 'system', content: 'Should be stripped' });
    
    const outbound = buildAnthropicRequest(internal);
    expect(outbound.system).toBe('Top level system');
    expect(outbound.messages.length).toBe(2);
    expect(outbound.max_tokens).toBe(4096); // default enforced
    expect(outbound.messages[0].role).toBe('user');
  });
});
