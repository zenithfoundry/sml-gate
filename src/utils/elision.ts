import crypto from 'node:crypto';
import { CONFIG } from '../config.js';
import { getDb, writeElision } from '../ledger/index.js';
import { TOOL_RESULT_PREFIXES } from './constants.js';

// NOTE:: "Elision" meaning is; Leaving out a sound, a syllable, or a word part when speaking.

/**
 * Computes a deterministic SHA-256 ID for a tool elision.
 * By hashing the tool name, arguments, and original content, we ensure that
 * identical tool outputs always produce the exact same elision ID,
 * enabling safe and highly-cacheable reconstruction logic.
 *
 * @param toolName - The name of the tool (e.g., 'read_file')
 * @param args - The structured arguments provided to the tool
 * @param originalText - The complete, uncompressed raw text returned by the tool
 * @returns A unique hexadecimal SHA-256 hash identifying this exact output state
 */
export function computeElisionId(toolName: string, args: any, originalText: string): string {
  const hashText = crypto.createHash('sha256').update(originalText).digest('hex');
  const payload = `${toolName}:${JSON.stringify(args || {})}:${hashText}`;
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Formats a clear, identifiable text marker indicating that lines were elided.
 * This marker informs downstream LLMs that content is missing and provides the `expand_elision`
 * ID they can use if they determine they actually need the omitted lines.
 *
 * @param elisionId - The unique SHA-256 hash for the original content
 * @param elidedLinesCount - Number of lines that were removed
 * @param startLine - Optional starting line index of the removed chunk
 * @param endLine - Optional ending line index of the removed chunk
 * @returns A formatted string marker designed for robust parsing
 */
export function formatElisionMarker(elisionId: string, elidedLinesCount: number, startLine?: number, endLine?: number): string {
  const rangeStr = (startLine !== undefined && endLine !== undefined) ? `, lines ${startLine}-${endLine}` : '';
  return `\n... ${elidedLinesCount} lines elided [id: ${elisionId}${rangeStr}] — call expand_elision to retrieve ...\n`;
}

/**
 * Estimates the number of tokens in a string based on a rough character-to-token heuristic.
 * Used for fast, zero-dependency short-circuiting before invoking the actual SLM.
 *
 * @param text - The text to evaluate
 * @returns Estimated token count (roughly 1 token per 3.5 characters)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/**
 * Result structure returned when parsing raw context to deduce tool provenance.
 */
export interface ExtractResult {
  /** The identified name of the tool, if any */
  toolName?: string;
  /** Parsed JSON arguments of the tool call, if any */
  args?: any;
  /** A heuristically extracted file path, if the tool seems to target a file */
  filePath?: string;
}

/**
 * Attempts to parse raw tool-result context to deduce the tool name, arguments, and target file.
 * Many MCP clients just dump raw text; this heuristic extractor tries to glean structure
 * by matching common JSON wrappers, path structures, and standard prefixes.
 *
 * @param content - The raw context string to analyze
 * @returns An `ExtractResult` containing any successfully deduced tool metadata
 */
export function extractToolSignature(content: string): ExtractResult {
  let toolName: string | undefined;
  let args: any;
  let filePath: string | undefined;

  // Try to parse JSON blocks that might represent tool calls
  try {
    const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1]);
      if (parsed.name || parsed.tool) toolName = parsed.name || parsed.tool;
      if (parsed.arguments || parsed.args) args = parsed.arguments || parsed.args;
      if (args && args.path) filePath = args.path;
      if (args && args.file) filePath = args.file;
      if (args && args.AbsolutePath) filePath = args.AbsolutePath;
      if (args && args.TargetFile) filePath = args.TargetFile;
    }
  } catch (e) {}

  // Fallback regex for common file path mentions
  if (!filePath) {
    const pathMatch = content.match(/(?:\/|\\|^[a-zA-Z]:\\)(?:[^\s"'<>|]+)+/);
    if (pathMatch) filePath = pathMatch[0];
  }

  // Fallback for tool name if it starts with something like "Tool output: read_file"
  if (!toolName) {
    for (const prefix of TOOL_RESULT_PREFIXES) {
      if (content.includes(prefix)) {
        const parts = content.split(prefix);
        if (parts.length > 1) {
          const words = parts[1].trim().split(/[\s:()]+/);
          if (words.length > 0 && words[0].length > 0) {
            toolName = words[0];
          }
        }
      }
    }
  }

  return { toolName, args, filePath };
}

/**
 * Analyzes file contents line-by-line to identify critical structural lines
 * (e.g., imports, function signatures) and lines conceptually related to the user's task.
 * 
 * Used during deterministic distillation of `read_file` operations to safely truncate
 * unneeded implementation details while preserving the file's "skeleton".
 *
 * @param lines - Array of lines comprising the file
 * @param task - The active user task string, used to derive search terms
 * @param searchTerms - Explicit additional search terms to match
 * @returns A sorted array of 0-indexed line numbers that should be preserved
 */
export function findRelevantRegions(lines: string[], task: string, searchTerms: string[] = []): number[] {
  const keepLines = new Set<number>();
  
  // Create lowercase search terms from task
  const terms = new Set(searchTerms.map(t => t.toLowerCase()));
  if (task) {
    task.split(/\W+/).filter(w => w.length > 3).forEach(w => terms.add(w.toLowerCase()));
  }

  lines.forEach((line, i) => {
    const lowerLine = line.toLowerCase();
    
    // 1. Keep skeleton: imports, exports, class/function signatures
    if (/^(?:import|export|class|function|interface|type)\s/.test(line)) {
      keepLines.add(i);
      return;
    }

    // 2. Keep lines matching task terms
    for (const term of terms) {
      if (lowerLine.includes(term)) {
        // Keep a window around the match
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 2); j++) {
          keepLines.add(j);
        }
        break;
      }
    }
  });

  return Array.from(keepLines).sort((a, b) => a - b);
}

/**
 * Condenses a sparse array of kept line indices into contiguous block objects.
 * Joins line ranges that are separated by small gaps to prevent fragmented, 
 * unreadable output with too many elision markers.
 *
 * @param lines - The complete original array of lines
 * @param keepLines - Sorted array of line indices to preserve
 * @returns Array of segmented block objects containing the text and boundary indices
 */
export function mergeRegions(lines: string[], keepLines: number[]): { lines: string[], start: number, end: number }[] {
  if (keepLines.length === 0) return [];

  const segments: { lines: string[], start: number, end: number }[] = [];
  let currentStart = keepLines[0];
  let currentEnd = keepLines[0];

  for (let i = 1; i < keepLines.length; i++) {
    if (keepLines[i] <= currentEnd + 2) { // merge if gap <= 2
      currentEnd = keepLines[i];
    } else {
      segments.push({
        lines: lines.slice(currentStart, currentEnd + 1),
        start: currentStart,
        end: currentEnd
      });
      currentStart = keepLines[i];
      currentEnd = keepLines[i];
    }
  }
  
  segments.push({
    lines: lines.slice(currentStart, currentEnd + 1),
    start: currentStart,
    end: currentEnd
  });

  return segments;
}

/**
 * The core engine of Reasoned Redundancy.
 * Dynamically distills excessively large tool results into compressed representations using 
 * tool-specific deterministic policies (e.g. keeping stack traces, top-K search results, 
 * or code skeletons).
 * 
 * If the resulting output remains stubbornly above token limits, it engages a strict local 
 * SLM fallback to further distill the text, utilizing protective placeholders to guarantee 
 * invariant lines (like file paths or function identifiers) are never dropped.
 *
 * @param slm - The local offline Small Language Model integration client
 * @param text - The raw, verbose tool result text
 * @param task - The overall user directive/task string
 * @param toolName - The categorized tool name (e.g., 'read_file', 'get_logs')
 * @param args - The arguments originally passed to the tool
 * @param preservePatterns - A rigid list of RegExp patterns whose matched lines MUST survive SLM compression
 * @returns The final compressed text representation, optionally featuring elision markers
 */
export async function distillToolResult(
  slm: (text: string, task?: string) => Promise<string>,
  text: string,
  task: string | undefined,
  toolName: string | undefined,
  args: any,
  preservePatterns: RegExp[]
): Promise<string> {
  const minTokens = CONFIG.DISTILL_MIN_TOKENS ?? 500;
  const maxTokens = CONFIG.DISTILL_MAX_TOKENS ?? 2000;
  console.log("DEBUG elision CONFIG minTokens:", minTokens, "maxTokens:", maxTokens, "CONFIG.DISTILL_MIN_TOKENS:", CONFIG.DISTILL_MIN_TOKENS);
  const originalTokens = estimateTokens(text);
  
  // If small enough, bypass all logic
  if (originalTokens < minTokens) {
    return text;
  }

  // Determine caching keys
  const policyVersion = 'v1';
  const elisionId = computeElisionId(toolName || 'unknown', args, text);
  const cacheKey = crypto.createHash('sha256').update(text + (task||'') + (toolName||'') + policyVersion).digest('hex');

  const db = getDb();
  const cached = db.prepare('SELECT value FROM cache WHERE key = ?').get(cacheKey) as { value: string } | undefined;
  if (cached) {
    return cached.value;
  }

  // Commit the uncompressed original to the DB for recovery via `expand_elision`
  let ranges: any = { startLine: 0, endLine: text.split('\n').length - 1 };
  writeElision({
    id: elisionId,
    tool_name: toolName || 'unknown',
    args: JSON.stringify(args || {}),
    original_text: text,
    ranges: JSON.stringify(ranges),
    content_hash: crypto.createHash('sha256').update(text).digest('hex'),
    size_bytes: Buffer.byteLength(text, 'utf8')
  });

  // Default to keeping the whole text
  let processedText = text;

  // Domain-Specific Deterministic Heuristics
  if (toolName && ['read_file', 'view_file', 'File_Read'].some(t => toolName.toLowerCase().includes(t))) {
    const lines = text.split('\n');
    const keepLines = findRelevantRegions(lines, task || '');
    if (keepLines.length > 0 && keepLines.length < lines.length * 0.8) {
      const segments = mergeRegions(lines, keepLines);
      let newText = '';
      let lastEnd = -1;
      
      for (const seg of segments) {
        if (seg.start > lastEnd + 1) {
          const elidedCount = seg.start - (lastEnd + 1);
          newText += formatElisionMarker(elisionId, elidedCount, lastEnd + 1, seg.start - 1);
        }
        newText += seg.lines.join('\n') + '\n';
        lastEnd = seg.end;
      }
      if (lastEnd < lines.length - 1) {
        const elidedCount = lines.length - 1 - lastEnd;
        newText += formatElisionMarker(elisionId, elidedCount, lastEnd + 1, lines.length - 1);
      }
      processedText = newText.trim();
    }
  } else if (toolName && ['run_command', 'get_logs', 'execute'].some(t => toolName.toLowerCase().includes(t))) {
    const lines = text.split('\n');
    // Maintain critical telemetry: errors, stack traces, failures, and the definitive log tail
    const keepLines = new Set<number>();
    lines.forEach((line, i) => {
      if (/error|fail|exception|trace/i.test(line)) {
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 5); j++) {
          keepLines.add(j);
        }
      }
    });
    // Mandatory Log Tail Retention
    for (let i = Math.max(0, lines.length - 50); i < lines.length; i++) {
      keepLines.add(i);
    }
    
    if (keepLines.size < lines.length * 0.8) {
       const segments = mergeRegions(lines, Array.from(keepLines).sort((a,b)=>a-b));
       let newText = '';
       let lastEnd = -1;
       
       for (const seg of segments) {
         if (seg.start > lastEnd + 1) {
           const elidedCount = seg.start - (lastEnd + 1);
           newText += formatElisionMarker(elisionId, elidedCount, lastEnd + 1, seg.start - 1);
         }
         newText += seg.lines.join('\n') + '\n';
         lastEnd = seg.end;
       }
       processedText = newText.trim();
    }
  } else if (toolName && ['grep_search', 'list_dir', 'search'].some(t => toolName.toLowerCase().includes(t))) {
    // Greedy truncation via Top-K
    const lines = text.split('\n');
    const topK = 50; 
    if (lines.length > topK) {
       const elidedCount = lines.length - topK;
       processedText = lines.slice(0, topK).join('\n') + formatElisionMarker(elisionId, elidedCount, topK, lines.length - 1);
    }
  }

  let finalText = processedText;
  
  console.log("DEBUG Before SLM: tokens=", estimateTokens(finalText), "maxTokens=", maxTokens, "toolName=", toolName);
  
  // SLM Semantic Fallback 
  // If the policy output remains oversized (and we are NOT processing raw file source codes which shouldn't be summarized contextually), 
  // we deploy the SLM loop with placeholder preservation guarantees.
  if (estimateTokens(finalText) > maxTokens && !['read_file', 'view_file'].some(t => (toolName||'').includes(t))) {
    console.log("SLM FALLBACK TRIGGERED, maxTokens=", maxTokens);
    const slmLines = finalText.split('\n');
    const preserved = new Map<string, string>();
    const modifiedLines: string[] = [];
    
    for (let i = 0; i < slmLines.length; i++) {
      const line = slmLines[i];
      if (preservePatterns.some(p => p.test(line)) || line.includes('lines elided [id:')) {
        const placeholder = `⟦PRESERVE_${i}⟧`;
        preserved.set(placeholder, line);
        modifiedLines.push(placeholder);
      } else {
        modifiedLines.push(line);
      }
    }
    
    if (preserved.size > slmLines.length * 0.7) {
      console.warn(`distill_low_yield: Greedy preserve list matched ${preserved.size}/${slmLines.length} lines`);
    }
    
    const textToCompress = modifiedLines.join('\n');
    const compressed = await slm(textToCompress, task);
    
    // Reverse reconstruction: map placeholders back to the strict original string bytes
    let slmFinal = compressed;
    for (const [placeholder, originalLine] of preserved.entries()) {
      if (slmFinal.includes(placeholder)) {
        slmFinal = slmFinal.replace(placeholder, originalLine);
      } else {
        const match = placeholder.match(/PRESERVE_(\d+)/);
        if (match) {
          const idx = match[1];
          const altRegex = new RegExp(`(?:⟦|\\[|__|\\()\\s*PRESERVE_${idx}\\s*(?:⟧|\\]|__|\\))`, 'g');
          if (altRegex.test(slmFinal)) {
            slmFinal = slmFinal.replace(altRegex, originalLine);
          }
        }
      }
    }
    
    // Strict assurance: Do NOT yield compressed text if the SLM hallucinatory-dropped guaranteed lines
    let missingLines: string[] = [];
    for (const originalLine of preserved.values()) {
      if (!slmFinal.includes(originalLine)) {
        missingLines.push(originalLine);
      }
    }
    if (missingLines.length === 0) {
      finalText = slmFinal;
    } else {
      console.warn(`distill_fallback: SLM dropped preserved lines: ${missingLines.join(', ')}`);
    }
  }

  // Hard Truncation Check: If everything fails (including SLM), slice the block to protect context windows 
  if (maxTokens > 0 && estimateTokens(finalText) > maxTokens) {
    const lines = finalText.split('\n');
    const keepHead = Math.floor((maxTokens * 3.5) / 100);
    
    if (lines.length > keepHead * 2) {
      const headLines = lines.slice(0, keepHead);
      const tailLines = lines.slice(-keepHead);
      
      const elidedCount = lines.length - (keepHead * 2);
      finalText = headLines.join('\n') + 
                  formatElisionMarker(elisionId, elidedCount, keepHead, lines.length - keepHead - 1) + 
                  tailLines.join('\n');
    }
  }

  // Memorize the computed result
  db.prepare('INSERT OR REPLACE INTO cache (key, value, ts) VALUES (?, ?, ?)').run(cacheKey, finalText, new Date().toISOString());

  return finalText;
}
