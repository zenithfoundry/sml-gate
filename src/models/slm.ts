import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { SlmFormatError } from './types.js';
import { CONFIG } from '../config.js';
import ollama, { Ollama } from 'ollama';

function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

export class SLM {
  constructor(private client: Ollama = ollama) {}

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
            num_ctx: CONFIG.NUM_CTX
          }
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
          })
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
}
