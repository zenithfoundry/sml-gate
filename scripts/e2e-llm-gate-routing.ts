/**
 * @fileoverview
 * End-to-End Test: LLM Gate Routing (`e2e:llm-gate-routing`)
 * 
 * Expected Outcome:
 * The test spins up `llm-gate` and a mock cloud HTTP server along with a mock Ollama server.
 * It sends an OpenAI-compatible payload to `/v1/chat/completions`. It verifies that the verifier 
 * successfully evaluates the prompt and forwards the request to the mock cloud model,
 * returning the expected response format.
 * 
 * Why this test is needed (Why it exists):
 * This ensures the core routing logic of `llm-gate` is functional. It validates that the
 * application can properly parse incoming chat completion requests, pass them through the
 * local verification layer, and seamlessly fallback/forward to an upstream provider when
 * necessary without mutating the OpenAI protocol contract.
 * 
 * Warning Expectations / Potential Flakiness:
 * - Does NOT require Ollama running (mocks the Ollama API).
 * - Test runs on dynamic ports to prevent collisions.
 * - Stable, does not rely on real LLM generation.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootPath = path.resolve(__dirname, '..');

async function main() {
  console.log("Starting LLM Gate Routing Test...");

  // Mock cloud server
  const mockCloud = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`[mockCloud] received request: ${req.url}`);
      if (req.url === '/v1/chat/completions') {
        const payload = JSON.parse(body);
        const hasSystemPrompt = payload.messages.some((m: any) => 
          m.role === 'system' && m.content.includes('[ARCHITECTURE CONTEXT:')
        );
        
        if (!hasSystemPrompt) {
           console.error('[mockCloud] FAIL: Missing injected SLM Gate system prompt context!');
           res.writeHead(400);
           return res.end();
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          created: Date.now(),
          model: 'gemini-2.5-flash',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'Mock cloud response' },
            finish_reason: 'stop'
          }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });

  await new Promise<void>(resolve => mockCloud.listen(0, resolve));
  const cloudPort = (mockCloud.address() as any).port;
  console.log(`Mock cloud server listening on port ${cloudPort}`);

  // Mock Ollama API Server for Verifier
  const mockOllama = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      console.log(`[mockOllama] received request: ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Verifier/Classify expects a JSON response
      const mockVerifierOutput = { category: 'other' };
      res.end(JSON.stringify({
        model: "gemini-2.5-flash",
        message: { role: "assistant", content: JSON.stringify(mockVerifierOutput) },
        response: JSON.stringify(mockVerifierOutput),
        done: true
      }));
    });
  });

  await new Promise<void>(resolve => mockOllama.listen(0, resolve));
  const ollamaPort = (mockOllama.address() as any).port;
  console.log(`Mock Ollama server listening on port ${ollamaPort}`);

  // Spawn llm-gate
  const llmGatePort = cloudPort + 2; 
  const llmGate = spawn('npx', ['tsx', path.join(rootPath, 'src', 'llm-gate', 'index.ts')], {
    env: {
      ...process.env,
      LLM_GATE_PORT: String(llmGatePort),
      CLOUD_BASE_URL: `http://127.0.0.1:${cloudPort}/v1/chat/completions`,
      CLOUD_API_KEY: 'mock-key',
      CLOUD_MODEL: 'gemini-2.5-flash',
      OLLAMA_HOST: `http://127.0.0.1:${ollamaPort}`,
      VERIFIER_OLLAMA_MODEL: 'gemini-2.5-flash'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  // Wait for it to boot
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      llmGate.kill();
      mockCloud.close();
      mockOllama.close();
      reject(new Error('llm-gate boot timeout'))
    }, 10000);
    
    llmGate.stdout.on('data', d => console.log('[llm-gate stdout]', d.toString().trim()));
    
    llmGate.stderr.on('data', (data) => {
      console.log('[llm-gate stderr]', data.toString().trim());
      if (data.toString().includes('LLM Gate running on port')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  console.log(`LLM Gate started on port ${llmGatePort}. Sending request...`);

  const response = await fetch(`http://127.0.0.1:${llmGatePort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' },
    body: JSON.stringify({
      model: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Say hello!' }]
    })
  });

  if (!response.ok) {
    console.error(`FAIL: Request failed with status ${response.status}`);
    mockCloud.close();
    mockOllama.close();
    llmGate.kill();
    process.exit(1);
  }

  const data = await response.json();
  
  if (data.choices && data.choices[0] && data.choices[0].message.content) {
    console.log(`PASS: Received response content: "${data.choices[0].message.content}"`);
  } else {
    console.error('FAIL: Malformed response');
    mockCloud.close();
    mockOllama.close();
    llmGate.kill();
    process.exit(1);
  }

  mockCloud.close();
  mockOllama.close();
  llmGate.kill();
  process.exit(0);
}

main().catch(err => {
  console.error("FAIL:", err);
  process.exit(1);
});
