import { jest } from '@jest/globals';

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    readFile: jest.fn(),
  },
}));

jest.unstable_mockModule('../../src/config.js', () => ({
  CONFIG: {
    DISTILL_PRESERVE_MODE: 'extend',
    DISTILL_PRESERVE_PATH: null,
    TLS_ADAPTER: false,
  },
}));

// Removed adapter mock to let dynamic import load the real file (or fail in decoupling test)

const fsMock = await import('fs/promises');
const { CONFIG } = await import('../../src/config.js');
const { buildPreserveList, distill } = await import('../../src/mcp-gate/distill.js');

// Mock SLM behavior
const mockSlm = jest.fn(async (text: string) => {
  // A simple simulated SLM that returns whatever it receives (possibly modified for the fallback test)
  return text;
});

describe('distill module', () => {
  let originalConsoleError: any;
  let originalConsoleWarn: any;

  beforeEach(() => {
    jest.clearAllMocks();
    (CONFIG as any).DISTILL_PRESERVE_MODE = 'extend';
    (CONFIG as any).DISTILL_PRESERVE_PATH = null;
    (CONFIG as any).TLS_ADAPTER = false;

    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  });

  it('(a) generic requirement/heading/code lines are preserved with NO TLS patterns loaded', async () => {
    const patterns = await buildPreserveList();
    const text = `Some irrelevant text
# Main Heading
Another text
You MUST do this
Here is code: \`const a = 1;\`
End`;

    const result = await distill(mockSlm as any, text, undefined, patterns);
    
    // With our mockSLM, the text passes through.
    // We just verify it replaced lines with placeholders and restored them.
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_1]]'), undefined);
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_3]]'), undefined);
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_4]]'), undefined);
    expect(mockSlm).toHaveBeenCalledWith(expect.stringMatching(/Some irrelevant text/), undefined); // Not preserved
    expect(result).toBe(text);
  });

  it('(b) a user config pattern in extend mode is preserved alongside defaults', async () => {
    (CONFIG as any).DISTILL_PRESERVE_PATH = '/path/to/user.json';
    (fsMock.default.readFile as any).mockResolvedValueOnce(JSON.stringify({
      patterns: ['^USER_MAGIC_LINE']
    }));

    const patterns = await buildPreserveList();
    const text = `MUST keep this\nUSER_MAGIC_LINE here`;
    await distill(mockSlm as any, text, undefined, patterns);

    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_0]]'), undefined); // MUST line
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_1]]'), undefined); // USER line
  });

  it('(c) replace mode preserves ONLY user + adapter patterns', async () => {
    (CONFIG as any).DISTILL_PRESERVE_MODE = 'replace';
    (CONFIG as any).DISTILL_PRESERVE_PATH = '/path/to/user.json';
    (fsMock.default.readFile as any).mockResolvedValueOnce(JSON.stringify({
      patterns: ['^USER_MAGIC_LINE']
    }));

    const patterns = await buildPreserveList();
    const text = `MUST drop this\nUSER_MAGIC_LINE here`;
    await distill(mockSlm as any, text, undefined, patterns);

    // MUST line is not preserved because replace mode drops built-ins
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('MUST drop this'), undefined); 
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_1]]'), undefined); // USER line
  });

  it('(d) an invalid user regex is skipped with a warning and doesn\'t crash', async () => {
    (CONFIG as any).DISTILL_PRESERVE_PATH = '/path/to/user.json';
    (fsMock.default.readFile as any).mockResolvedValueOnce(JSON.stringify({
      patterns: ['[invalid regex', '^USER_MAGIC_LINE']
    }));

    const patterns = await buildPreserveList();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[distill] Warning: Skipping invalid regex pattern: [invalid regex'));
    
    // The valid one should still work
    const text = `USER_MAGIC_LINE here`;
    await distill(mockSlm as any, text, undefined, patterns);
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_0]]'), undefined);
  });

  it('(e) TLS-specific patterns are preserved only when TLS_ADAPTER=on', async () => {
    // State 1: OFF
    (CONFIG as any).TLS_ADAPTER = false;
    let patterns = await buildPreserveList();
    let text = `Phase 2`;
    await distill(mockSlm as any, text, undefined, patterns);
    // Not preserved
    expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('Phase 2'), undefined);

    jest.clearAllMocks();

    // State 2: ON
    (CONFIG as any).TLS_ADAPTER = true;
    patterns = await buildPreserveList();
    await distill(mockSlm as any, text, undefined, patterns);
    
    // In test:decoupling, the adapter is missing, so patterns will be empty
    const { existsSync } = await import('fs');
    const { fileURLToPath } = await import('url');
    const { resolve, dirname } = await import('path');
    const adapterPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/adapters/tech-lead-stack.ts');
    
    if (existsSync(adapterPath)) {
      // Preserved
      expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('[[PRESERVED_LINE_0]]'), undefined);
    } else {
      // Not preserved due to missing adapter (in decoupling mode)
      expect(mockSlm).toHaveBeenCalledWith(expect.stringContaining('Phase 2'), undefined);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to load TLS adapter patterns'), expect.anything());
    }
  });

  it('(f) the assert-fallback still returns original text when a protected line would be lost', async () => {
    const patterns = await buildPreserveList();
    const text = `Header
You MUST do this
Footer`;

    // Mock SLM that drops the placeholder entirely
    const destructiveSlm = jest.fn(async () => {
      return `Header\nFooter`; // placeholder dropped
    });

    const result = await distill(destructiveSlm as any, text, undefined, patterns);
    
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('distill_fallback'));
    expect(result).toBe(text); // Returned original text
  });

  it('logs greedy list warning if > 70% lines are preserved', async () => {
    const patterns = await buildPreserveList();
    const text = `MUST line 1\nMUST line 2\nMUST line 3\nNormal line`;
    await distill(mockSlm as any, text, undefined, patterns);

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('distill_low_yield'));
  });
});
