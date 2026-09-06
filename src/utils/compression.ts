import { InternalMessage } from '../llm-gate/formats/internal.js';
import { extractToolSignature, distillToolResult, estimateTokens, computeElisionId, formatElisionMarker } from './elision.js';
import { CONFIG } from '../config.js';
import crypto from 'node:crypto';
import { writeElision } from '../ledger/index.js';

/**
 * Configuration options for context compression pruning.
 */
export interface PruneOptions {
  /** Maximum number of messages to retain (currently unused but reserved for future hard-caps) */
  maxMessages?: number;
  /** Whether to aggressively drop older tool outputs if they are superseded or too large */
  dropStaleToolOutput?: boolean;
}

/**
 * Core context compression engine for the LLM Gate.
 * This function iterates through the conversation history and intelligently prunes, 
 * drops, or distills verbose tool outputs to save tokens and prevent context overflow, 
 * while maintaining strict cache-stability and preserving critical structural data.
 *
 * @param messages - The full history of internal messages in the conversation.
 * @param options - Configuration for pruning aggression.
 * @returns A promise resolving to the compressed array of messages.
 */
export async function compressContext(messages: InternalMessage[], options: PruneOptions = {}): Promise<InternalMessage[]> {
  const { dropStaleToolOutput = true } = options;
  
  if (messages.length === 0) return [];
  
  const lastIndex = messages.length - 1;
  
  // We keep a configurable number of recent tool outputs verbatim to ensure 
  // the model has full context for its most immediate recent actions.
  const recentToolTurns = CONFIG.KEEP_RECENT_TOOL_TURNS ?? 2;
  
  // Tool outputs smaller than this threshold are considered "cheap" and are kept verbatim 
  // to save CPU cycles and avoid unnecessary fragmentation.
  const minTokens = CONFIG.DISTILL_MIN_TOKENS ?? 500;

  // Pre-process messages to extract structural metadata (tool name, args, target file paths).
  // This metadata is crucial for detecting when an older tool output is "superseded" by a newer one.
  const toolResults = messages.map((m, i) => {
    if (m.role !== 'tool' && m.role !== 'user' && m.role !== 'assistant') return null;
    const extracted = extractToolSignature(m.content);
    return {
      index: i,
      role: m.role,
      content: m.content,
      toolName: extracted.toolName,
      args: extracted.args,
      filePath: extracted.filePath,
      // We hash the raw content here to easily detect exact duplicate responses later.
      hash: crypto.createHash('sha256').update(m.content).digest('hex')
    };
  });

  // Perform a reverse-scan to flag the N most recent tool results.
  // These flagged results will be protected from compression.
  let toolTurnsFound = 0;
  const isRecentTool = new Array(messages.length).fill(false);
  for (let i = lastIndex; i >= 0; i--) {
    if (messages[i].role === 'tool') {
      if (toolTurnsFound < recentToolTurns) {
        isRecentTool[i] = true;
      }
      toolTurnsFound++;
    }
  }

  // The LLM-gate primarily relies on deterministic truncation (heuristics) for speed.
  // Since we don't have an active SLM client instantiated here, we pass a dummy passthrough function.
  // The underlying `distillToolResult` handles deterministic heuristic truncation gracefully even with a dummy SLM.
  const dummySlm = async (t: string) => t;

  const processed: InternalMessage[] = [];
  
  // Main forward-scan loop to evaluate each message for compression or dropping.
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    
    // Always keep the very last message, non-tool messages, or everything if pruning is disabled.
    if (i === lastIndex || msg.role !== 'tool' || !dropStaleToolOutput) {
      processed.push(msg);
      continue;
    }

    const currentTool = toolResults[i]!;
    const sizeTokens = estimateTokens(msg.content);

    // Rule 1: KEEP VERBATIM
    // If the output is tiny or it is one of the most recent tool interactions, protect it.
    if (sizeTokens < minTokens || isRecentTool[i]) {
      processed.push(msg);
      continue;
    }

    // Rule 2: Check for Supersession
    // We scan ahead in the conversation to see if a future action renders this current tool output obsolete.
    let superseded = false;
    for (let j = i + 1; j < messages.length; j++) {
      const later = toolResults[j];
      if (!later) continue;
      
      // Condition A: An exact duplicate of this output appears later in the conversation.
      if (later.hash === currentTool.hash) {
        superseded = true;
        break;
      }
      
      // Condition B: The exact same file was read again later, making this older read obsolete.
      if (currentTool.filePath && later.filePath === currentTool.filePath && later.role === 'tool') {
        if (['read_file', 'view_file'].some(t => later.toolName?.includes(t))) {
          superseded = true;
          break;
        }
      }
      
      // Condition C: The file this tool read was subsequently modified/written to later,
      // rendering this older read's contents invalid/stale.
      if (currentTool.filePath && later.filePath === currentTool.filePath) {
        if (['write', 'edit', 'replace', 'patch'].some(t => later.toolName?.toLowerCase().includes(t))) {
          superseded = true;
          break;
        }
      }
    }

    if (superseded && currentTool.toolName) {
      // Rule 3: DROP (with marker)
      // The output is obsolete. We drop the payload but leave a precise breadcrumb (elision marker) 
      // in the context window and write the full payload to the local SQLite ledger.
      const elisionId = computeElisionId(currentTool.toolName, currentTool.args, msg.content);
      const lines = msg.content.split('\n');
      const marker = formatElisionMarker(elisionId, lines.length, 0, lines.length - 1);
      
      writeElision({
        id: elisionId,
        tool_name: currentTool.toolName,
        args: JSON.stringify(currentTool.args || {}),
        original_text: msg.content,
        ranges: JSON.stringify({startLine: 0, endLine: lines.length - 1}),
        content_hash: currentTool.hash,
        size_bytes: Buffer.byteLength(msg.content)
      });
      
      processed.push({ ...msg, content: marker.trim() });
    } else {
      // Rule 4: DISTILL (with marker)
      // The output is not obsolete but it is large and old. We use deterministic heuristics 
      // (like top-K truncation or log tailing) to shrink it down.
      let task = '';
      if (i > 0 && messages[i-1].role === 'user') task = messages[i-1].content;
      
      // `distillToolResult` will leave its own markers inside the returned compressed string.
      const distilled = await distillToolResult(dummySlm, msg.content, task, currentTool.toolName, currentTool.args, []);
      processed.push({ ...msg, content: distilled });
    }
  }

  // Final Pass: Deduplication
  // Strip out back-to-back identical messages (usually caused by tool errors or retries) 
  // to save a marginal amount of tokens.
  const deduped: InternalMessage[] = [];
  for (let i = 0; i < processed.length; i++) {
    if (i > 0 && processed[i].role === processed[i-1].role && processed[i].content === processed[i-1].content) {
      continue;
    }
    deduped.push(processed[i]);
  }

  return deduped;
}
