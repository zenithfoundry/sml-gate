import { z } from 'zod';
import { SLM } from './slm.js';
import { roles } from './roles.js';
import { ClassifyCategory, withSlmTimeout } from './types.js';
import { CONFIG } from '../config.js';

export function checkAgreement<T>(samples: T[]): T | null {
  if (samples.length === 0) return null;

  const normalize = (val: any): string => {
    if (typeof val === 'string') {
      return val.toLowerCase().replace(/\s+/g, ' ').replace(/[.,!?]$/, '').trim();
    }
    return JSON.stringify(val);
  };

  const counts = new Map<string, { count: number; original: T }>();
  let maxCount = 0;
  let majorityValue: T | null = null;

  for (const sample of samples) {
    const norm = normalize(sample);
    const existing = counts.get(norm) || { count: 0, original: sample };
    existing.count += 1;
    counts.set(norm, existing);

    if (existing.count > maxCount) {
      maxCount = existing.count;
      majorityValue = existing.original;
    }
  }

  const threshold = Math.floor(samples.length / 2) + 1;
  return maxCount >= threshold ? majorityValue : null;
}

export async function selfConsistency<T>(
  slm: SLM,
  model: string,
  prompt: string,
  schema: z.ZodSchema<T>,
  k: number = 3,
  temperature: number = 0.7
): Promise<T> {
  const promises = Array.from({ length: k }).map(() =>
    withSlmTimeout(slm.generateJSON<T>(model, prompt, schema, temperature), 'selfConsistency', CONFIG.SLM_TIMEOUT_MS).catch(() => null)
  );
  
  const results = await Promise.all(promises);
  const validResults = results.filter((r) => r !== null) as T[];
  
  const agreed = checkAgreement(validResults);
  if (agreed !== null) {
    return agreed;
  }
  
  // Fallback to a temp=0 run if no agreement
  return withSlmTimeout(slm.generateJSON<T>(model, prompt, schema, 0), 'selfConsistency', CONFIG.SLM_TIMEOUT_MS);
}

export async function classify(
  slm: SLM,
  text: string
): Promise<ClassifyCategory> {
  const schema = z.object({
    category: z.enum(['classify', 'extract', 'format', 'boolean', 'short_factual', 'trivial_edit', 'other'])
  });

  const prompt = `Classify the following text into one of the categories: classify, extract, format, boolean, short_factual, trivial_edit, other.\n\nText: ${text}`;
  
  const result = await withSlmTimeout(slm.generateJSON(roles.gate, prompt, schema, 0), 'classify', CONFIG.SLM_TIMEOUT_MS);
  return result.category;
}

export async function compress(
  slm: SLM,
  text: string
): Promise<string> {
  const schema = z.object({
    compressedText: z.string()
  });

  const prompt = `Compress the following text while maintaining the core meaning.\n\nText: ${text}`;
  
  const result = await withSlmTimeout(slm.generateJSON(roles.gate, prompt, schema, 0), 'compress', CONFIG.SLM_TIMEOUT_MS);
  return result.compressedText;
}
