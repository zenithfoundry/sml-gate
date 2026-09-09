import { CONFIG } from '../config.js';
import { SLM } from '../models/slm.js';

const slm = new SLM();

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function embedText(text: string): Promise<number[] | null> {
  try {
    const res = await slm.embed(CONFIG.EMBED_MODEL, text);
    return res;
  } catch (e) {
    console.error('[embed] Error computing embedding:', e);
    return null;
  }
}

export function float64ArrayToBuffer(arr: number[]): Buffer {
  return Buffer.from(new Float64Array(arr).buffer);
}

export function bufferToFloat64Array(buf: Buffer): number[] {
  return Array.from(new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8));
}
