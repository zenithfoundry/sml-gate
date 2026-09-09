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

  it('Test 5: Verify baseline_tokens score is emitted ONLY IF baselineTokens > 0', () => {
    // Escalate event (no savings, but HAS cloud baseline)
    const eventCloudTokens: LedgerEvent = { 
      ...baseEvent, 
      route: 'escalate', 
      is_local_call: 0,
      api_in_tok: 100,
      api_out_tok: 50,
      in_tok: 0,
      out_tok: 0,
      verifier_flags: '["escalate"]'
    };
    const payloadCloud = formatEventForLangfuse(eventCloudTokens);
    expect(payloadCloud.scores?.find(s => s.name === 'baseline_tokens')?.value).toBe(150);

    // Defer local event (has savings and local baseline)
    const eventLocalTokens: LedgerEvent = { 
      ...baseEvent, 
      route: 'defer_local', 
      api_in_tok: 0,
      api_out_tok: 0,
      in_tok: 100,
      out_tok: 50
    };
    const payloadLocal = formatEventForLangfuse(eventLocalTokens);
    expect(payloadLocal.scores?.find(s => s.name === 'baseline_tokens')?.value).toBe(150);

    // No tokens event (e.g. error before any model call)
    const eventNoTokens: LedgerEvent = { 
      ...baseEvent, 
      route: 'condition', 
      api_in_tok: 0,
      api_out_tok: 0,
      in_tok: 0,
      out_tok: 0
    };
    const payloadNoTokens = formatEventForLangfuse(eventNoTokens);
    expect(payloadNoTokens.scores?.find(s => s.name === 'baseline_tokens')).toBeUndefined();
    
    // Ensure the old cycle minutes scores are gone entirely
    expect(payloadLocal.scores?.find(s => s.name.startsWith('cycle_minutes_saved_'))).toBeUndefined();
  });
});
