import { InternalMessage } from '../llm-gate/formats/internal.js';

export interface PruneOptions {
  /** Maximum number of messages to keep (currently unused but preserved for future sliding-window limits) */
  maxMessages?: number;
  /** Whether to aggressively drop tool outputs that are no longer the most recent instruction */
  dropStaleToolOutput?: boolean;
}

/**
 * Compresses the context window before forwarding to a cloud model.
 * 
 * Strategy:
 * 1. Always preserves the very last message (the current turn).
 * 2. Prunes old/stale tool outputs to dramatically save tokens, assuming the local model 
 *    or a previous cloud turn already synthesized their value.
 * 3. Deduplicates adjacent identical messages (common artifact of recursive tool usage).
 * 
 * @param messages The full history of internal messages
 * @param options Pruning strictness options
 * @returns A compressed array of internal messages optimized for cloud cost savings
 */
export function compressContext(messages: InternalMessage[], options: PruneOptions = {}): InternalMessage[] {
  const { dropStaleToolOutput = true } = options;
  
  if (messages.length === 0) return [];
  
  // Always keep the very last message intact (it's the current instruction)
  const lastIndex = messages.length - 1;
  
  const pruned = messages.filter((msg, index) => {
    if (index === lastIndex) return true;
    
    // Prune stale tool output to save tokens, if requested
    if (dropStaleToolOutput && msg.role === 'tool') {
      return false; // drop old tool responses
    }
    
    return true;
  });

  // Deduplication: if two adjacent messages have identical content and role, drop the earlier one
  const deduped: InternalMessage[] = [];
  for (let i = 0; i < pruned.length; i++) {
    if (i > 0 && pruned[i].role === pruned[i-1].role && pruned[i].content === pruned[i-1].content) {
      continue;
    }
    deduped.push(pruned[i]);
  }

  return deduped;
}
