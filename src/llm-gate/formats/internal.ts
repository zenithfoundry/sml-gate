/**
 * Normalized role type to unify the differences between OpenAI (system, user, assistant, function, tool) 
 * and Anthropic (user, assistant).
 */
export type InternalRole = 'system' | 'user' | 'assistant' | 'tool';

/**
 * An agnostic internal message representation.
 * Complex payloads (like images or multimodal blocks) are either flattened to text or 
 * kept as stringified JSON payloads depending on the serialization needs.
 */
export interface InternalMessage {
  role: InternalRole;
  content: string; // Flattened text content for simplicity, or complex content handled as string.
}

/**
 * The unified request shape used internally by the pipeline.
 * All inbound requests (regardless of whether they arrived as OpenAI or Anthropic format)
 * are parsed into this structure before processing.
 */
export interface InternalRequest {
  system?: string; // Hoisted system message, crucial for Anthropic alignment
  messages: InternalMessage[];
  maxTokens?: number;
  stream?: boolean;
  tools?: any[]; // Kept verbatim, passed down to the outbound serializer
  model: string;
}
