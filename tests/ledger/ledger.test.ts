import { jest } from '@jest/globals';

const mockRun = jest.fn();
const mockGet = jest.fn();
const mockAll = jest.fn();
const mockPrepare = jest.fn(() => ({
  run: mockRun,
  get: mockGet,
  all: mockAll,
}));
const mockExec = jest.fn();
const mockPragma = jest.fn();
const mockClose = jest.fn();

const MockDatabase = jest.fn(() => ({
  prepare: mockPrepare,
  exec: mockExec,
  pragma: mockPragma,
  close: mockClose,
}));

jest.unstable_mockModule('better-sqlite3', () => ({
  default: MockDatabase,
}));

jest.unstable_mockModule('../../src/config.js', () => ({
  CONFIG: {
    LEDGER_PATH: ':memory:',
    LANGFUSE_PUBLIC_KEY: '',
    LANGFUSE_SECRET_KEY: '',
    LANGFUSE_HOST: '',
    RESOLVED_PLAN_CLAUDE: { windowMinutes: 300, plan: 'claude-pro' },
    RESOLVED_PLAN_CHATGPT: { windowMinutes: 180, plan: 'chatgpt-plus' },
    RESOLVED_PLAN_GEMINI: { windowMinutes: 300, plan: 'gemini-ultra' }
  }
}));

const { getDb, writeEvent, cacheGet, cacheSet, LangfuseSink } = await import('../../src/ledger/index.js');

describe('Ledger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getDb(); // Initialize DB once per test to consume the policy table init query
    LangfuseSink.__resetForTests();
  });

  afterAll(() => {
    // Ensure DB is closed if needed, but in memory should be fine.
    const db = getDb();
    db.close();
  });

  test('writes event successfully', () => {
    const event = {
      ts: new Date().toISOString(),
      layer: 'llm' as const,
      request_id: 'req_123',
      route: 'defer_local' as const,
      is_local_call: 1,
      in_tok: 10,
      out_tok: 20,
      api_in_tok: 0,
      api_out_tok: 0,
      cost_usd: 0.001,
      slm_latency_s: 0.5,
      api_latency_s: 0,
      slm_gate: 'on' as const,
    };

    writeEvent(event);

    expect(mockPrepare).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith(expect.objectContaining({ request_id: 'req_123' }));
  });

  test('cache set and get', () => {
    mockGet.mockReturnValue({ value: 'my_value' });
    cacheSet('my_key', 'my_value');
    expect(mockPrepare).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith('my_key', 'my_value', expect.any(String));

    const val = cacheGet('my_key');
    expect(val).toBe('my_value');

    mockGet.mockReturnValue(undefined);
    const missing = cacheGet('not_exist');
    expect(missing).toBeNull();
  });

  test('langfuse disabled no-op path', () => {
    // Langfuse properties are empty in the mock, so hasValidConfig() should return false
    const valid = LangfuseSink.hasValidConfig();
    expect(valid).toBe(false);

    // Invoking writeEvent shouldn't crash
    const event = {
      ts: new Date().toISOString(),
      layer: 'llm' as const,
      request_id: 'req_langfuse_test',
      route: 'defer_local' as const,
      is_local_call: 0,
      in_tok: 0,
      out_tok: 0,
      api_in_tok: 0,
      api_out_tok: 0,
      cost_usd: 0,
      slm_latency_s: 0,
      api_latency_s: 0,
      slm_gate: 'off' as const,
    };

    expect(() => writeEvent(event)).not.toThrow();
  });

  test('publishCycleRates computes correctness and respects throttle', async () => {
    // 1. Mock DB data for computeTotals when no stats provided
    mockAll.mockReturnValue([
      { route: 'defer_local', is_local_call: 1, in_tok: 100, out_tok: 50, api_in_tok: 0, api_out_tok: 0, verifier_flags: '', request_id: '1', api_model: 'gemini-2.5-flash' },
      { route: 'escalate', is_local_call: 0, in_tok: 0, out_tok: 0, api_in_tok: 50, api_out_tok: 200, verifier_flags: '["escalate"]', request_id: '2', api_model: 'claude-3-5-sonnet' }
    ]);

    // Mock fetch for publishCycleRates
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve(''), json: () => Promise.resolve({}) } as any));

    const { CONFIG } = await import('../../src/config.js');

    // Temporarily enable config for LangfuseSink
    const origKey = CONFIG.LANGFUSE_PUBLIC_KEY;
    Object.assign(CONFIG, {
      LANGFUSE_PUBLIC_KEY: 'test',
      LANGFUSE_SECRET_KEY: 'test',
      LANGFUSE_HOST: 'http://test'
    });

    // Call it first time
    await LangfuseSink.publishCycleRates();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    
    // Call it immediately again (should throttle)
    await LangfuseSink.publishCycleRates();
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Call it with force: true (bypasses throttle)
    await LangfuseSink.publishCycleRates({ force: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);

    // Restore
    Object.assign(CONFIG, {
      LANGFUSE_PUBLIC_KEY: origKey,
      LANGFUSE_SECRET_KEY: '',
      LANGFUSE_HOST: ''
    });
    delete (global as any).fetch;
  });
});
