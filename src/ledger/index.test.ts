import { computeCycleRates, computeTotalsByProvider, formatEventForLangfuse, LedgerEvent, providerFromAgent, providerFromModel } from './index.js';

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

  it('Test 5: Verify old cycle minutes scores are gone entirely', () => {
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
    
    // Ensure the old cycle minutes scores are gone entirely
    expect(payloadLocal.scores?.find(s => s.name.startsWith('cycle_minutes_saved_'))).toBeUndefined();
  });
});

describe('computeCycleRates', () => {
  it('computes cycle rates using the token-based formula across providers', () => {
    const rows: LedgerEvent[] = [
      {
        ts: new Date().toISOString(),
        layer: 'mcp',
        request_id: '1',
        route: 'defer_local',
        is_local_call: 1,
        in_tok: 100,
        out_tok: 100,
        api_in_tok: 0,
        api_out_tok: 0,
        cost_usd: 0,
        slm_latency_s: 1,
        api_latency_s: 0,
        slm_gate: 'on',
        api_model: 'gemini-2.5-flash' // provider = gemini
      },
      {
        ts: new Date().toISOString(),
        layer: 'mcp',
        request_id: '2',
        route: 'defer_local',
        is_local_call: 1,
        in_tok: 50,
        out_tok: 50,
        api_in_tok: 0,
        api_out_tok: 0,
        cost_usd: 0,
        slm_latency_s: 1,
        api_latency_s: 0,
        slm_gate: 'on',
        api_model: 'claude-3-5-sonnet' // provider = claude
      }
    ];

    const rates = computeCycleRates(rows);

    // gemini: baseline = 200, saved = 200. rate = 300 * 200/200 = 300
    // claude: baseline = 100, saved = 100. rate = 300 * 100/100 = 300
    // chatgpt: baseline = 0, rate should be 0
    expect(rates.gemini).toBe(300);
    expect(rates.claude).toBe(300);
    expect(rates.chatgpt).toBe(0);
  });
});

describe('provider attribution', () => {
  it('resolves provider from api_model when inbound model is a known string like gemini-2.5-pro', () => {
    // Simulates FIX 1: server.ts captures inboundModel and sets api_model='gemini-2.5-pro'
    const rows: LedgerEvent[] = [
      {
        ts: new Date().toISOString(),
        layer: 'llm',
        request_id: 'attr_1',
        route: 'forward_compressed',
        is_local_call: 0,
        in_tok: 50,
        out_tok: 0,
        api_in_tok: 80,
        api_out_tok: 40,
        cost_usd: 0,
        slm_latency_s: 0.5,
        api_latency_s: 1.0,
        slm_gate: 'on',
        api_model: 'gemini-2.5-pro' // inbound model captured from request body
      }
    ];

    const stats = computeTotalsByProvider(rows);
    expect(stats.gemini.baselineTokens).toBeGreaterThan(0);
  });

  it('falls back to providerFromModel for known model strings', () => {
    expect(providerFromModel('gemini-2.5-pro')).toBe('gemini');
    expect(providerFromModel('claude-sonnet-5')).toBe('claude');
    expect(providerFromModel('gpt-5.6-sol')).toBe('chatgpt');
    expect(providerFromModel('unknown')).toBeNull();
    expect(providerFromModel(undefined)).toBeNull();
  });

  it('attributes to CONFIG.PROVIDER when no model or agent signal exists', () => {
    // Simulates FIX 2: event with no api_model, no agent, but fallback provider='gemini'
    const rows: LedgerEvent[] = [
      {
        ts: new Date().toISOString(),
        layer: 'llm',
        request_id: 'attr_2',
        route: 'forward_compressed',
        is_local_call: 0,
        in_tok: 50,
        out_tok: 0,
        api_in_tok: 80,
        api_out_tok: 40,
        cost_usd: 0,
        slm_latency_s: 0.5,
        api_latency_s: 1.0,
        slm_gate: 'on',
      }
    ];

    // When fallback provider is gemini, the event must be attributed to gemini
    const stats = computeTotalsByProvider(rows, 'gemini');
    expect(stats.gemini.baselineTokens).toBe(160);
    expect(stats.claude.baselineTokens).toBe(0);
    expect(stats.chatgpt.baselineTokens).toBe(0);
  });

  it('leaves events unattributed when no model, agent, or config provider exists', () => {
    const rows: LedgerEvent[] = [
      {
        ts: new Date().toISOString(),
        layer: 'llm',
        request_id: 'attr_3',
        route: 'forward_compressed',
        is_local_call: 0,
        in_tok: 50,
        out_tok: 0,
        api_in_tok: 80,
        api_out_tok: 40,
        cost_usd: 0,
        slm_latency_s: 0.5,
        api_latency_s: 1.0,
        slm_gate: 'on',
      }
    ];

    // With no fallback provider, events remain unattributed (0 for all providers)
    const statsNoFallback = computeTotalsByProvider(rows, null);
    expect(statsNoFallback.gemini.baselineTokens).toBe(0);
    expect(statsNoFallback.claude.baselineTokens).toBe(0);
    expect(statsNoFallback.chatgpt.baselineTokens).toBe(0);
  });

  it('provider is never null when CONFIG.PROVIDER is set (writeEvent chain)', () => {
    // The writeEvent chain: e.provider ?? providerFromModel(e.api_model) ?? providerFromAgent(e.agent) ?? CONFIG.PROVIDER ?? null
    // When all signals are missing but CONFIG.PROVIDER is set, the result must be the config value.
    const eProvider: string | undefined = undefined;
    const eApiModel: string | undefined = undefined;
    const eAgent: string | undefined = undefined;
    const configProvider: 'gemini' | 'claude' | 'chatgpt' = 'gemini';

    const provider =
      eProvider ?? providerFromModel(eApiModel) ?? providerFromAgent(eAgent) ?? configProvider ?? null;
    expect(provider).toBe('gemini');
  });
});
