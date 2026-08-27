import ollama, { Ollama } from 'ollama';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { CONFIG } from '../config.js';
import { SlmFormatError } from './helpers.js';

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export class SLM {
  private client: Ollama;
  constructor(client?: Ollama) {
    this.client = client || new Ollama({ host: CONFIG.OLLAMA_HOST });
  }

  async generateJSON<T>(
    model: string,
    prompt: string,
    schema: z.ZodSchema<T>,
    temperature: number = CONFIG.TEMPERATURE
  ): Promise<T> {
    const attempt = async (temp: number) => {
      const jsonSchema = zodToJsonSchema(schema);
      let responseText = '';

      if (CONFIG.SLM_PROVIDER === 'ollama') {
        const response = await this.client.chat({
          model,
          messages: [{ role: 'user', content: prompt }],
          format: jsonSchema as any,
          options: {
            temperature: temp,
            num_ctx: CONFIG.NUM_CTX,
            think: false
          } as any
        });
        responseText = response.message.content;
      } else if (CONFIG.SLM_PROVIDER === 'openai') {
        // When SLM_PROVIDER='openai', we hit OLLAMA_HOST using the standard OpenAI Chat Completions API format.
        // This is used for local models that expose an OpenAI-compatible endpoint.
        const response = await fetch(`${CONFIG.OLLAMA_HOST}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(CONFIG.CLOUD_API_KEY && { 'Authorization': `Bearer ${CONFIG.CLOUD_API_KEY}` })
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: temp,
            response_format: { type: "json_schema", json_schema: { name: "response", schema: jsonSchema } }
          }),
          signal: AbortSignal.timeout(CONFIG.SLM_TIMEOUT_MS)
        });
        
        if (!response.ok) {
          throw new Error(`OpenAI API error: ${response.statusText}`);
        }
        
        const data = await response.json();
        responseText = data.choices[0].message.content;
      } else {
        throw new Error(`Unsupported SLM_PROVIDER: ${CONFIG.SLM_PROVIDER}`);
      }

      const stripped = stripThinkTags(responseText);
      
      try {
        const parsed = JSON.parse(stripped);
        return schema.parse(parsed);
      } catch (err) {
        throw new SlmFormatError(`Failed to parse or validate JSON: ${(err as Error).message}\nContent: ${stripped}`);
      }
    };

    try {
      return await attempt(temperature);
    } catch (err) {
      if (err instanceof SlmFormatError) {
        return await attempt(0);
      }
      throw err;
    }
  }

 /**
   * Generates a raw, unstructured text completion from the SLM.
   * 
   * Architectural Note: 
   * This maintains a deliberate separation of concerns between internal reasoning 
   * and external proxying. Unlike `generateJSON` (which is used strictly for internal, 
   * deterministic agentic logic and routing), `generateText` is used to directly proxy 
   * conversational responses back to the end-user/client. Bypassing schema enforcement 
   * here eliminates JSON formatting token overhead and allows for seamless real-time 
   * Markdown streaming via `streamText`.
   * 
   * @param model The ID of the model to execute
   * @param messages Array of history messages
   * @param temperature Generation temperature, default from CONFIG
   * @returns Raw text completion
   */
  async generateText(
    model: string,
    messages: { role: string, content: string }[],
    temperature: number = CONFIG.TEMPERATURE
  ): Promise<string> {
    if (CONFIG.SLM_PROVIDER === 'ollama') {
      const response = await this.client.chat({
        model,
        messages,
        options: {
          temperature,
          num_ctx: CONFIG.NUM_CTX,
          think: false
        } as any
      });
      return stripThinkTags(response.message.content);
    } else if (CONFIG.SLM_PROVIDER === 'openai') {
      const response = await fetch(`${CONFIG.OLLAMA_HOST}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(CONFIG.CLOUD_API_KEY && { 'Authorization': `Bearer ${CONFIG.CLOUD_API_KEY}` })
        },
        body: JSON.stringify({
          model,
          messages,
          temperature
        }),
        signal: AbortSignal.timeout(CONFIG.SLM_TIMEOUT_MS)
      });
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      const data = await response.json();
      return stripThinkTags(data.choices[0].message.content);
    }
    throw new Error(`Unsupported SLM_PROVIDER: ${CONFIG.SLM_PROVIDER}`);
  }

  /**
   * Generates a streaming text completion from the SLM.
   * 
   * Note on Syntax (`async *streamText`):
   * An asterisk (*) used with a function defines a generator function, which is a 
   * special function that can pause its work and resume it later. You usually write 
   * it as `function* myFunc()` or as a short method inside an object like `*myFunc()`.
   * By returning an AsyncGenerator, it yields content chunks iteratively as they 
   * are produced by the local model.
   * 
   * @param model The ID of the model to execute
   * @param messages Array of history messages
   * @param temperature Generation temperature, default from CONFIG
   * @returns AsyncGenerator yielding string chunks
   */
  async *streamText(
    model: string,
    messages: { role: string, content: string }[],
    temperature: number = CONFIG.TEMPERATURE
  ): AsyncGenerator<string, void, unknown> {
    if (CONFIG.SLM_PROVIDER === 'ollama') {
      const response = await this.client.chat({
        model,
        messages,
        stream: true,
        options: {
          temperature,
          num_ctx: CONFIG.NUM_CTX,
          think: false
        } as any
      });
      for await (const chunk of response) {
        yield chunk.message.content;
      }
    } else {
      // Fallback: just yield the whole text at once for non-streaming providers
      const text = await this.generateText(model, messages, temperature);
      yield text;
    }
  }
}
