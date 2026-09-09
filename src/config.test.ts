import { jest } from '@jest/globals';

describe('Config Plan Precedence', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('Test 6: Verify planId precedence (ENV PLAN overrides SUBSCRIPTION_PLAN)', async () => {
    // We isolate imports inside the test since config.js evaluates at import time.
    
    // 1. Base case: default plan
    delete process.env.SUBSCRIPTION_PLAN;
    delete process.env.PLAN_CLAUDE;
    
    // @ts-ignore
    let module = await import('./config.js?t=1');
    expect(module.CONFIG.RESOLVED_PLAN_CLAUDE.plan).toBe('claude-pro');

    // 2. SUBSCRIPTION_PLAN overrides default
    process.env.SUBSCRIPTION_PLAN = 'claude-max-20x';
    // @ts-ignore
    module = await import('./config.js?t=2');
    expect(module.CONFIG.RESOLVED_PLAN_CLAUDE.plan).toBe('claude-max-20x');

    // 3. PLAN_CLAUDE overrides SUBSCRIPTION_PLAN
    process.env.PLAN_CLAUDE = 'claude-max-5x';
    // @ts-ignore
    module = await import('./config.js?t=3');
    expect(module.CONFIG.RESOLVED_PLAN_CLAUDE.plan).toBe('claude-max-5x');
  });
});
