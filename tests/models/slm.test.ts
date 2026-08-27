import { z } from 'zod';
import { SLM } from '../../src/models/slm.js';
import { SlmFormatError } from '../../src/models/helpers.js';
import { checkAgreement, selfConsistency } from '../../src/models/reasoning.js';
import { Ollama } from 'ollama';
import { jest, describe, it, expect, beforeEach } from '@jest/globals';

describe('SLM Client', () => {
  let mockOllama: jest.Mocked<Ollama>;

  beforeEach(() => {
    mockOllama = {
      chat: jest.fn(),
      list: jest.fn(),
    } as any;
  });

  it('strips <think> tags before parsing JSON', async () => {
    const slm = new SLM(mockOllama);
    
    mockOllama.chat.mockResolvedValue({
      model: 'qwen',
      created_at: new Date(),
      message: { role: 'assistant', content: '<think>thinking process</think>\n{"result":"success"}' },
      done: true
    } as any);

    const schema = z.object({ result: z.string() });
    const res = await slm.generateJSON('qwen', 'prompt', schema);
    expect(res).toEqual({ result: 'success' });
  });

  it('throws SlmFormatError on invalid JSON after retry', async () => {
    const slm = new SLM(mockOllama);
    
    mockOllama.chat.mockResolvedValue({
      model: 'qwen',
      created_at: new Date(),
      message: { role: 'assistant', content: 'not json' },
      done: true
    } as any);

    const schema = z.object({ result: z.string() });
    
    await expect(slm.generateJSON('qwen', 'prompt', schema)).rejects.toThrow(SlmFormatError);
    expect(mockOllama.chat).toHaveBeenCalledTimes(2); // Initial try + 1 retry at temp=0
  });

  it('checkAgreement normalizes strings and finds majority', () => {
    const samples = [
      'TRUE.',
      'true',
      ' false '
    ];
    expect(checkAgreement(samples)).toBe('TRUE.'); // First encountered that meets majority
  });
  
  it('checkAgreement returns null on tie', () => {
    const samples = [
      'true',
      'false'
    ];
    expect(checkAgreement(samples)).toBeNull();
  });
});
