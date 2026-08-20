import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  CallToolResultSchema
} from "@modelcontextprotocol/sdk/types.js";
import { CONFIG } from '../config.js';
import { conditionPrompt } from './pipeline.js';

export async function createServer() {
  const server = new Server(
    {
      name: "small-language-model-gate",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  let rootUri: string | undefined;
  let downstreamClient: Client | undefined;

  // We intercept initialize via transport.onmessage below to capture rootUri without breaking SDK logic.
  
  if (CONFIG.DOWNSTREAM_MCP) {
    // Proxy mode
    downstreamClient = new Client(
      { name: "mcp-gate-proxy", version: "1.0.0" },
      { capabilities: {} }
    );
    
    let transport;
    if (CONFIG.DOWNSTREAM_MCP.command) {
      transport = new StdioClientTransport({
        command: CONFIG.DOWNSTREAM_MCP.command,
        args: CONFIG.DOWNSTREAM_MCP.args || [],
        env: { ...process.env, ...(CONFIG.DOWNSTREAM_MCP.env || {}) }
      });
    } else if (CONFIG.DOWNSTREAM_MCP.url) {
      transport = new StreamableHTTPClientTransport(new URL(CONFIG.DOWNSTREAM_MCP.url));
    }

    if (transport) {
      await downstreamClient.connect(transport);
    }

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (!downstreamClient) return { tools: [] };
      const res = await downstreamClient.request({ method: "tools/list" }, ListToolsResultSchema);
      return res;
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (!downstreamClient) throw new Error("No downstream client");
      const name = request.params.name;
      // Intercept skill execution
      if (name.startsWith('get_skill') || name === 'condition_prompt') {
        const task = typeof request.params.arguments?.task === 'string' ? request.params.arguments.task : 'Unknown task';
        
        // Pass request unchanged downstream
        const result = await downstreamClient.request({
          method: "tools/call",
          params: request.params
        }, CallToolResultSchema);
        
        // Extract text from result content
        let skillText = '';
        if (result.content && Array.isArray(result.content)) {
          const textBlock = result.content.find((c: any) => c.type === 'text');
          if (textBlock && typeof (textBlock as any).text === 'string') {
            skillText = (textBlock as any).text;
          }
        }
        if (!skillText) {
          skillText = JSON.stringify(result.content);
        }
        
        // Condition the text
        const conditioned = await conditionPrompt(skillText, task, rootUri);
        
        // Return conditioned result
        return {
          content: [{ type: "text", text: conditioned }]
        };
      } else {
        // Transparent proxy
        return await downstreamClient.request({
          method: "tools/call",
          params: request.params
        }, CallToolResultSchema);
      }
    });

  } else {
    // Standalone mode
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "condition_prompt",
            description: "Condense and condition a prompt using a local SLM",
            inputSchema: {
              type: "object",
              properties: {
                text: { type: "string" },
                task: { type: "string" }
              },
              required: ["text", "task"]
            }
          }
        ]
      };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name === "condition_prompt") {
        const text = String(request.params.arguments?.text || '');
        const task = String(request.params.arguments?.task || '');
        const conditioned = await conditionPrompt(text, task, rootUri);
        return {
          content: [{ type: "text", text: conditioned }]
        };
      }
      throw new Error(`Tool not found: ${request.params.name}`);
    });
  }

  const start = async () => {
    if (CONFIG.MCP_GATE_TRANSPORT === 'stdio') {
      const originalStdoutWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = process.stderr.write.bind(process.stderr) as any;
      
      const transport = new StdioServerTransport();
      
      const origStart = transport.start.bind(transport);
      transport.start = async () => {
        const origOnmessage = transport.onmessage;
        if (origOnmessage) {
          transport.onmessage = (message: any) => {
            if (message?.method === 'initialize') {
              const rootsCap = message.params?.capabilities?.roots;
              // Check if roots is passed directly in capabilities (older clients)
              if (Array.isArray(rootsCap) && rootsCap.length > 0 && rootsCap[0]?.uri) {
                rootUri = rootsCap[0].uri;
              } else if (message.params?.rootUri) {
                // Fallback for non-compliant clients passing top-level rootUri
                rootUri = message.params.rootUri;
              }
              console.error(`[mcp-gate] rootUri: ${rootUri || 'none'}`);
            }
            origOnmessage(message);
          };
        }
        await origStart();
      };
      
      await server.connect(transport);
      
      process.stdout.write = originalStdoutWrite;
    } else {
      const http = await import('node:http');
      const { randomUUID } = await import('node:crypto');
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID()
      });
      await server.connect(transport);
      
      const httpServer = http.createServer((req, res) => {
        transport.handleRequest(req, res);
      });
      
      httpServer.listen(CONFIG.MCP_GATE_PORT, () => {
        console.error(`[mcp-gate] HTTP Streamable server running on port ${CONFIG.MCP_GATE_PORT}`);
      });
    }
  };

  return { server, start };
}
