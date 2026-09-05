import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG } from '../config.js';
import { getDb } from '../ledger/index.js';
import { SLM } from '../models/slm.js';

let dbInitialized = false;

/**
 * Initializes the semantic cache table in the local SQLite ledger.
 * This is called lazily before cache operations to ensure the `semcache` 
 * table exists without blocking the main application boot.
 */
export function initCacheDb() {
  if (dbInitialized) return;
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS semcache (
      id TEXT PRIMARY KEY,
      embedding_blob BLOB,
      response TEXT,
      file_hashes TEXT,
      ts TEXT
    );
  `);
  dbInitialized = true;
}

/**
 * Calculates the cosine similarity between two high-dimensional vectors.
 * A score of 1.0 means perfectly identical directions (identical meaning), 
 * while 0 means orthogonal (no semantic overlap).
 * 
 * @param a The first vector (e.g., the current prompt's embedding)
 * @param b The second vector (e.g., a stored prompt's embedding)
 * @returns A similarity score between -1.0 and 1.0
 */
function cosineSimilarity(a: number[], b: number[]) {
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

/**
 * Scans a prompt text for potential file paths, reads those files from disk, 
 * and returns a map of their SHA-256 hashes. This acts as a stale-context guard:
 * if a referenced file is edited, its hash changes, invalidating previous cache hits.
 * 
 * @param text The raw prompt or task text containing potential file paths.
 * @returns A dictionary mapping absolute file paths to their SHA-256 hashes.
 */
export async function getReferencedFilesHashes(text: string): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  
  // Regex to extract standard file paths or file:// URIs
  const regex = /(?:file:\/\/)?(\/?(?:[a-zA-Z0-9_\-\.]+\/)+[a-zA-Z0-9_\-\.]+)/g;
  let match;
  const potentialPaths = new Set<string>();
  
  while ((match = regex.exec(text)) !== null) {
    potentialPaths.add(match[1]);
  }
  
  // Secondary regex for isolated relative paths like "src/index.ts"
  const wordRegex = /([a-zA-Z0-9_\-\.\/]+)/g;
  while ((match = wordRegex.exec(text)) !== null) {
    if (match[1].includes('.') && match[1].includes('/')) {
      potentialPaths.add(match[1]);
    }
  }

  for (let p of potentialPaths) {
    // Strip URI protocol if present
    if (p.startsWith('file://')) p = p.substring(7);
    
    // Resolve relative paths against the project root
    let fullPath = p;
    if (!path.isAbsolute(fullPath)) {
      fullPath = path.join(CONFIG.ROOT_DIR, fullPath);
    }
    
    try {
      // Hash the file contents if it exists and is a valid file
      const stat = await fs.stat(fullPath);
      if (stat.isFile()) {
        const content = await fs.readFile(fullPath);
        hashes[fullPath] = crypto.createHash('sha256').update(content).digest('hex');
      }
    } catch {
      // Safely ignore missing files or invalid paths
    }
  }
  return hashes;
}

/**
 * Checks the semantic cache for a sufficiently similar previous request.
 * 
 * Flow:
 * 1. Generates an embedding for the current request using the local model.
 * 2. Extracts and hashes any files referenced in the current request.
 * 3. Scans stored cache entries:
 *    a. Rejects if the stored referenced file hashes do not match exactly.
 *    b. Calculates cosine similarity of the prompt embeddings.
 *    c. Accepts and returns the stored response if similarity >= threshold.
 * 
 * @param text The current task or prompt text to evaluate.
 * @returns The cached response object/string if a match is found, otherwise null.
 */
export async function checkSemanticCache(text: string): Promise<any | null> {
  if (!CONFIG.SEMCACHE) return null;
  initCacheDb();
  
  let currentEmbedding: number[];
  try {
    const slm = new SLM();
    currentEmbedding = await slm.embed(CONFIG.EMBED_MODEL, text);
  } catch (e) {
    console.error(`[cache] Failed to generate embedding: ${e}`);
    return null;
  }
  
  const currentHashes = await getReferencedFilesHashes(text);
  
  const db = getDb();
  const rows = db.prepare('SELECT id, embedding_blob, response, file_hashes FROM semcache').all() as any[];
  
  for (const row of rows) {
    const storedHashes = JSON.parse(row.file_hashes);
    
    // Validate that the context files haven't changed (stale-context guard)
    const keys1 = Object.keys(currentHashes);
    const keys2 = Object.keys(storedHashes);
    let match = keys1.length === keys2.length;
    if (match) {
      for (const k of keys1) {
        if (currentHashes[k] !== storedHashes[k]) {
          match = false;
          break;
        }
      }
    }
    
    // Skip this cache entry if file contexts differ
    if (!match) continue;

    // Convert the stored SQLite BLOB back into a Float64Array for math operations
    const buf = row.embedding_blob as Buffer;
    const storedEmbedding = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
    
    const sim = cosineSimilarity(currentEmbedding, Array.from(storedEmbedding));
    if (sim >= CONFIG.SEMCACHE_THRESHOLD) {
      console.log(`[cache] HIT! Similarity: ${sim.toFixed(4)}`);
      return JSON.parse(row.response);
    }
  }
  return null;
}

/**
 * Stores a new entry in the semantic cache.
 * 
 * Generates the vector embedding for the prompt, hashes its referenced files, 
 * and stores the original response payload in the SQLite ledger.
 * 
 * @param text The original prompt or task text.
 * @param responseObj The response payload or string to store.
 */
export async function setSemanticCache(text: string, responseObj: any) {
  if (!CONFIG.SEMCACHE) return;
  initCacheDb();
  
  let embedding: number[];
  try {
    const slm = new SLM();
    embedding = await slm.embed(CONFIG.EMBED_MODEL, text);
  } catch (e) {
    console.error(`[cache] Failed to generate embedding for storage: ${e}`);
    return;
  }
  
  // Convert the array of floats into a binary buffer for SQLite BLOB storage
  const blob = Buffer.from(new Float64Array(embedding).buffer);
  const currentHashes = await getReferencedFilesHashes(text);
  
  const db = getDb();
  const stmt = db.prepare('INSERT INTO semcache (id, embedding_blob, response, file_hashes, ts) VALUES (?, ?, ?, ?, ?)');
  
  // Store the request embedding alongside the serialized response and the file context state
  stmt.run(crypto.randomUUID(), blob, JSON.stringify(responseObj), JSON.stringify(currentHashes), new Date().toISOString());
}
