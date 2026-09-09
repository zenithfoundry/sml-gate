import { jest } from '@jest/globals';
import { formatEventForLangfuse, LedgerEvent } from './index.js';

describe('formatEventForLangfuse', () => {
  const baseEvent: LedgerEvent = {
    ts: new Date().toISOString(),
    layer: 'mcp',
    request_id: 'req_123',
    route: 'defer_local',
    is_local_call: 1,
    in_tok: 100,
    out_tok: 50,
    api_in_tok: 0,
    api_out_tok: 0,
    cost_usd: 0,
    slm_latency_s: 1.5,
    api_latency_s: 0,
    slm_gate: 'on'
  };

  it('Test 1: Given quality_score = 0.8, expect accuracy_rate_pct = 80', () => {
    const event: LedgerEvent = { ...baseEvent, quality_score: 0.8 };
    const payload = formatEventForLangfuse(event);
    const accuracyScore = payload.scores?.find(s => s.name === 'accuracy_rate_pct');
    expect(accuracyScore).toBeDefined();
    expect(accuracyScore?.value).toBe(80);
  });

  it('Test 2: Given quality_score undefined, SLM hit, and route = local, expect accuracy_rate_pct = 100 (accepted)', () => {
    const event: LedgerEvent = { ...baseEvent, route: 'defer_local', quality_score: undefined, is_local_call: 1 };
    const payload = formatEventForLangfuse(event);
    const accuracyScore = payload.scores?.find(s => s.name === 'accuracy_rate_pct');
    expect(accuracyScore).toBeDefined();
    expect(accuracyScore?.value).toBe(100);
  });

  it('Test 3: Given quality_score undefined, SLM hit, and route = cloud, expect accuracy_rate_pct = 0 (rejected)', () => {
    const event: LedgerEvent = { 
      ...baseEvent, 
      route: 'escalate', 
      is_local_call: 1, 
      quality_score: undefined,
      verifier_flags: '["some_flag"]'
    };
    const payload = formatEventForLangfuse(event);
    const accuracyScore = payload.scores?.find(s => s.name === 'accuracy_rate_pct');
    expect(accuracyScore).toBeDefined();
    expect(accuracyScore?.value).toBe(0);
  });

  it('Test 4: Given SLM not hit, expect NO accuracy_rate_pct score in the payload', () => {
    const event: LedgerEvent = { 
      ...baseEvent, 
      route: 'forward_raw', 
      is_local_call: 0, 
      quality_score: undefined 
    };
    const payload = formatEventForLangfuse(event);
    const accuracyScore = payload.scores?.find(s => s.name === 'accuracy_rate_pct');
    expect(accuracyScore).toBeUndefined();
  });

  it('Test 5: Verify cycle summary scores emit ONLY IF tokensSaved > 0', () => {
    // With tokensSaved = 0 (forward_raw)
    const eventNoSavings: LedgerEvent = { 
      ...baseEvent, 
      route: 'forward_raw', 
      is_local_call: 0,
      api_in_tok: 100,
      api_out_tok: 50,
      in_tok: 0,
      out_tok: 0
    };
    const payloadNo = formatEventForLangfuse(eventNoSavings);
    expect(payloadNo.scores?.find(s => s.name.startsWith('cycle_minutes_saved_'))).toBeUndefined();

    // With tokensSaved > 0 (defer_local)
    const eventWithSavings: LedgerEvent = { 
      ...baseEvent, 
      route: 'defer_local', 
      in_tok: 100,
      out_tok: 50
    };
    const payloadYes = formatEventForLangfuse(eventWithSavings);
    expect(payloadYes.scores?.find(s => s.name === 'cycle_minutes_saved_chatgpt')).toBeDefined();
    expect(payloadYes.scores?.find(s => s.name === 'cycle_minutes_saved_claude')).toBeDefined();
    expect(payloadYes.scores?.find(s => s.name === 'cycle_minutes_saved_gemini')).toBeDefined();
  });
});
