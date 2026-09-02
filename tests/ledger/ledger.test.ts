import { jest } from '@jest/globals';

const mockRun = jest.fn();
const mockGet = jest.fn();
const mockPrepare = jest.fn(() => ({
  run: mockRun,
  get: mockGet,
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
  }
}));

const { getDb, writeEvent, cacheGet, cacheSet, LangfuseSink } = await import('../../src/ledger/index.js');

describe('Ledger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
    mockGet.mockReturnValueOnce({ value: 'my_value' });
    cacheSet('my_key', 'my_value');
    expect(mockPrepare).toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith('my_key', 'my_value', expect.any(String));

    const val = cacheGet('my_key');
    expect(val).toBe('my_value');

    mockGet.mockReturnValueOnce(undefined);
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
});
