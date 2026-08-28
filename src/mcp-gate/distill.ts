import fs from 'fs/promises';
import { CONFIG } from '../config.js';
import { withSlmTimeout } from '../models/helpers.js';

export const BUILTIN_PATTERNS: RegExp[] = [
  // requirement keywords
  /.*(?:MUST|MUST NOT|SHALL|REQUIRED|SHOULD NOT|NEVER|ALWAYS|DO NOT|MANDATORY|PROHIBITED|IMPORTANT|CRITICAL|WARNING|CAUTION).*/i,
  // markdown headings
  /^#{1,6}\s/,
  // numbered steps
  /^\s*\d+[.)]\s/,
  // checklist items
  /^\s*[-*]\s+\[[ xX]\]/,
  // fenced code blocks / inline code lines (contain backticks)
  /`/,
  // URLs
  /https?:\/\//,
  // path/KEY[:=]value config lines
  /^[A-Za-z0-9_.\/-]+[:=]/,
  // output/format directives
  /(?:format:|respond with|output must|Answer:)/i,
  // hard quantities
  /(?:no more than \d|at most|exactly \d|maximum|minimum)/i,
  // YAML frontmatter block markers
  /^---/,
];

async function compilePattern(pattern: string): Promise<RegExp | null> {
  let Re2: typeof RegExp | undefined;
  try {
    // @ts-ignore - optional dependency
    Re2 = (await import('re2')).default;
  } catch {
    // re2 not installed, will fallback
  }

  if (Re2) {
    try {
      return new Re2(pattern);
    } catch (e) {
      // Re2 threw (e.g. unsupported syntax like lookaheads), fallback to native RegExp
    }
  }

  try {
    return new RegExp(pattern);
  } catch (e) {
    console.error(`[distill] Warning: Skipping invalid regex pattern: ${pattern}`);
    return null;
  }
}

export async function buildPreserveList(): Promise<RegExp[]> {
  let patterns: RegExp[] = [];
  const mode = CONFIG.DISTILL_PRESERVE_MODE || 'extend';

  if (mode === 'extend') {
    patterns = [...BUILTIN_PATTERNS];
  }

  if (CONFIG.DISTILL_PRESERVE_PATH) {
    try {
      const data = await fs.readFile(CONFIG.DISTILL_PRESERVE_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed.patterns)) {
        for (const p of parsed.patterns) {
          const compiled = await compilePattern(p);
          if (compiled) {
            patterns.push(compiled);
          }
        }
      }
    } catch (e) {
      console.error(`[distill] Warning: Failed to read or parse user preserve patterns from ${CONFIG.DISTILL_PRESERVE_PATH}`);
    }
  }

  if (CONFIG.TLS_ADAPTER) {
    try {
      // Guarded dynamic import
      // @ts-ignore - Decoupling: adapter may not exist
      const adapter = await import('../adapters/tech-lead-stack.js');
      if (adapter.tlsPreservePatterns) {
        patterns.push(...adapter.tlsPreservePatterns);
      }
    } catch (e) {
      console.error(`[distill] Warning: Failed to load TLS adapter patterns`, e);
    }
  }

  return patterns;
}

export async function distill(
  slm: (text: string, task?: string) => Promise<string>,
  text: string,
  task: string | undefined,
  preservePatterns: RegExp[]
): Promise<string> {
  const lines = text.split('\n');
  const preserved = new Map<string, string>();
  const modifiedLines: string[] = [];
  
  let preservedCount = 0;
  let nonBlankCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().length > 0) nonBlankCount++;

    const isPreserved = preservePatterns.some(p => p.test(line));
    if (isPreserved) {
      const placeholder = `⟦PRESERVE_${i}⟧`;
      preserved.set(placeholder, line);
      modifiedLines.push(placeholder);
      preservedCount++;
    } else {
      modifiedLines.push(line);
    }
  }

  if (nonBlankCount > 0 && preservedCount / nonBlankCount > 0.7) {
    console.warn('[distill] Warning: distill_low_yield - more than 70% of lines are preserved. Compression may be ineffective.');
  }

  const textToCompress = modifiedLines.join('\n');
  const compressed = await withSlmTimeout(slm(textToCompress, task), 'distill', CONFIG.SLM_TIMEOUT_MS);

  // Restore placeholders programmatically
  let finalText = compressed;
  for (const [placeholder, originalLine] of preserved.entries()) {
    finalText = finalText.replace(placeholder, originalLine);
  }



  // Assert every preserved line is actually in the final output
  let missingLines: string[] = [];
  for (const originalLine of preserved.values()) {
    if (!finalText.includes(originalLine)) {
      missingLines.push(originalLine);
    }
  }

  if (missingLines.length > 0) {
    console.warn(`[distill] Warning: distill_fallback - SLM omitted ${missingLines.length} preserved lines. Returning original text.`);
    return text;
  }

  return finalText;
}
