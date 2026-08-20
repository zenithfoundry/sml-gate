import { jest } from '@jest/globals';
import { CallToolRequestSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';

// Mock config
jest.unstable_mockModule('../../src/config.js', () => ({
  CONFIG: {
    DOWNSTREAM_MCP: { command: 'echo' },
    MCP_GATE_TRANSPORT: 'stdio'
  }
}));

// Mock pipeline
jest.unstable_mockModule('../../src/mcp-gate/pipeline.js', () => ({
  conditionPrompt: jest.fn(async (text: string, task: string, rootUri?: string) => {
    // Mock conditioning that adds Open questions and preserves MUST
    return text.replace('Long boring text', '') + '\n\n## Open questions\n- Question 1';
  })
}));

// Mock sdk client
const mockRequest = jest.fn<(...args: any[]) => Promise<any>>();
jest.unstable_mockModule('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn<() => Promise<void>>().mockResolvedValue(),
    request: mockRequest
  }))
}));

const { conditionPrompt } = await import('../../src/mcp-gate/pipeline.js');
const { createServer } = await import('../../src/mcp-gate/server.js');
const { CONFIG } = await import('../../src/config.js');

describe('mcp-gate server (proxy mode)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('intercepts get_skill, conditions RESULT text, and returns shorter output with MUST and Open questions', async () => {
    const { server } = await createServer();
    
    // Simulate fake downstream returning the original skill in RESULT
    const originalText = `Long boring text\nYou MUST do this.\nEnd of skill`;
    mockRequest.mockResolvedValueOnce({
      content: [{ type: "text", text: originalText }]
    });

    const req = {
      method: 'tools/call',
      params: {
        name: 'get_skill',
        arguments: { task: 'test task' }
      }
    };

    // Trigger the handler directly since we mocked the server
    const handler = (server as any)._requestHandlers.get(CallToolRequestSchema.shape.method.value);
    if (!handler) throw new Error("Handler not registered");

    const result = await handler(req as any, {} as any);

    expect(mockRequest).toHaveBeenCalledWith({
      method: "tools/call",
      params: req.params
    }, CallToolResultSchema);

    expect(conditionPrompt).toHaveBeenCalledWith(originalText, 'test task', undefined);

    const conditionedText = result.content[0].text;
    expect(conditionedText.length).toBeLessThan(originalText.length + 30); // account for Open questions
    expect(conditionedText).toContain('You MUST do this.');
    expect(conditionedText).toContain('## Open questions');
    expect(conditionedText).not.toContain('Long boring text');
  });
});
