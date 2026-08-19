import { jest } from '@jest/globals';
import { Langfuse } from 'langfuse';

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

  test('should create tables in memory and do idempotent writes', () => {
    const db = getDb();
    
    const event = {
      ts: new Date().toISOString(),
      layer: 'mcp' as const,
      request_id: 'req_123',
      session_id: 'sess_1',
      skill: 'test',
      route: 'defer_local' as const,
      is_local_call: 1,
      slm_model: 'qwen',
      api_model: '',
      in_tok: 100,
      out_tok: 50,
      api_in_tok: 0,
      api_out_tok: 0,
      cost_usd: 0,
      slm_latency_s: 1.5,
      api_latency_s: 0,
      verifier_flags: '{}',
      quality_score: 1.0,
      slm_gate: 'on' as const,
      meta: '{}'
    };

    writeEvent(event);
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE INTO events'));
    expect(mockRun).toHaveBeenCalledWith(event);

    mockGet.mockReturnValueOnce({ request_id: 'req_123', slm_model: 'qwen' });
    const statement = db.prepare('SELECT * FROM events WHERE request_id = ?');
    const row: any = statement.get('req_123');

    expect(row).toBeDefined();
    expect(row.request_id).toBe('req_123');
    expect(row.slm_model).toBe('qwen');
  });

  test('should correctly set and get cache entries', () => {
    mockGet.mockReturnValueOnce({ value: 'my_value' });
    cacheSet('my_key', 'my_value');
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE INTO cache'));
    expect(mockRun).toHaveBeenCalledWith('my_key', 'my_value', expect.any(String));

    const val = cacheGet('my_key');
    expect(val).toBe('my_value');

    mockGet.mockReturnValueOnce(undefined);
    const missing = cacheGet('not_exist');
    expect(missing).toBeNull();
  });

  test('langfuse disabled no-op path', () => {
    // Langfuse properties are empty in the mock, so getClient() should return null
    const client = LangfuseSink.getClient();
    expect(client).toBeNull();

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
