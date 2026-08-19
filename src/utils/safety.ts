import { InternalMessage } from '../llm-gate/formats/internal.js';
import { TOOL_RESULT_PREFIXES, CURSOR_TOOL_MARKERS } from './constants.js';

/**
 * Heuristic to detect if the *last* message in the conversation actually represents
 * a tool response or a file output, rather than the user's own turn.
 * 
 * If it is a tool output, it's unsafe to locally defer since we shouldn't execute
 * commands derived directly from data.
 */
export function isLatestInstructionFromTool(messages: InternalMessage[]): boolean {
  if (messages.length === 0) return false;
  
  const last = messages[messages.length - 1];
  if (last.role === 'tool') {
    return true;
  }

  // Some clients encode tool results as 'user' or 'assistant' messages.
  const content = last.content.trim();
  
  if (TOOL_RESULT_PREFIXES.some(prefix => content.startsWith(prefix))) {
    return true;
  }
  
  if (CURSOR_TOOL_MARKERS.some(marker => content.includes(marker))) {
    return true;
  }

  // A very common pattern: JSON objects embedded directly at the start that look like tool returns
  if (content.startsWith('{"') && content.includes('}') && (content.includes('result') || content.includes('output'))) {
    // Basic heuristic for raw JSON return
    return true;
  }

  return false;
}
