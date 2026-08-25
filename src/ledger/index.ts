import Database from 'better-sqlite3';
import { Langfuse } from 'langfuse';
import { CONFIG } from '../config.js';

let db: Database.Database | null = null;
let langfuse: Langfuse | null = null;

export interface LedgerEvent {
  ts: string;
  layer: 'mcp' | 'llm';
  request_id: string;
  session_id?: string;
  skill?: string;
  route: 'defer_local' | 'escalate' | 'forward_compressed' | 'forward_raw' | 'condition';
  is_local_call: number; // 0 or 1
  slm_model?: string;
  api_model?: string;
  in_tok: number;
  out_tok: number;
  api_in_tok: number;
  api_out_tok: number;
  cost_usd: number;
  slm_latency_s: number;
  api_latency_s: number;
  verifier_flags?: string; // JSON
  quality_score?: number | null;
  slm_gate: 'on' | 'off';
  meta?: string; // JSON
}

import fs from 'node:fs';
import path from 'node:path';

export function getDb(): Database.Database {
  if (!db) {
    const dir = path.dirname(CONFIG.LEDGER_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(CONFIG.LEDGER_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        ts TEXT,
        layer TEXT,
        request_id TEXT UNIQUE PRIMARY KEY,
        session_id TEXT,
        skill TEXT,
        route TEXT,
        is_local_call INTEGER,
        slm_model TEXT,
        api_model TEXT,
        in_tok INTEGER,
        out_tok INTEGER,
        api_in_tok INTEGER,
        api_out_tok INTEGER,
        cost_usd REAL,
        slm_latency_s REAL,
        api_latency_s REAL,
        verifier_flags TEXT,
        quality_score REAL,
        slm_gate TEXT,
        meta TEXT
      );

      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT,
        ts TEXT
      );

      CREATE TABLE IF NOT EXISTS langfuse_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        payload TEXT,
        synced INTEGER DEFAULT 0
      );
    `);
  }
  return db;
}

export function writeEvent(e: LedgerEvent) {
  const statement = getDb().prepare(`
    INSERT OR REPLACE INTO events (
      ts, layer, request_id, session_id, skill, route, is_local_call, slm_model, api_model,
      in_tok, out_tok, api_in_tok, api_out_tok, cost_usd, slm_latency_s, api_latency_s,
      verifier_flags, quality_score, slm_gate, meta
    ) VALUES (
      @ts, @layer, @request_id, @session_id, @skill, @route, @is_local_call, @slm_model, @api_model,
      @in_tok, @out_tok, @api_in_tok, @api_out_tok, @cost_usd, @slm_latency_s, @api_latency_s,
      @verifier_flags, @quality_score, @slm_gate, @meta
    )
  `);
  
  // better-sqlite3 strictly requires all named parameters to exist on the object, 
  // so we must coalesce any undefined optional properties to null.
  statement.run({
    ts: e.ts,
    layer: e.layer,
    request_id: e.request_id,
    session_id: e.session_id ?? null,
    skill: e.skill ?? null,
    route: e.route,
    is_local_call: e.is_local_call,
    slm_model: e.slm_model ?? null,
    api_model: e.api_model ?? null,
    in_tok: e.in_tok,
    out_tok: e.out_tok,
    api_in_tok: e.api_in_tok,
    api_out_tok: e.api_out_tok,
    cost_usd: e.cost_usd,
    slm_latency_s: e.slm_latency_s,
    api_latency_s: e.api_latency_s,
    verifier_flags: e.verifier_flags ?? null,
    quality_score: e.quality_score ?? null,
    slm_gate: e.slm_gate,
    meta: e.meta ?? null
  });

  // Mirror to Langfuse if enabled
  LangfuseSink.mirrorEvent(e);
}

export function cacheGet(key: string): string | null {
  const statement = getDb().prepare('SELECT value FROM cache WHERE key = ?');
  const row = statement.get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function cacheSet(key: string, value: string) {
  const statement = getDb().prepare('INSERT OR REPLACE INTO cache (key, value, ts) VALUES (?, ?, ?)');
  statement.run(key, value, new Date().toISOString());
}

export interface LangfuseQueuePayload {
  trace: {
    id: string;
    sessionId?: string | null;
    tags: string[];
    metadata?: Record<string, unknown>;
    name: string;
  };
  generation?: {
    name: string;
    model: string;
    usage: {
      input: number;
      output: number;
    };
    startTime: string;
    endTime: string;
    metadata: { cost_usd: number };
  };
  span?: {
    name: string;
    startTime: string;
    endTime: string;
    metadata: {
      model: string;
      usage: {
        input: number;
        output: number;
      };
      cost_usd: number;
    };
  };
}

export class LangfuseSink {
  static getClient(): Langfuse | null {
    if (langfuse) return langfuse;
    if (CONFIG.LANGFUSE_PUBLIC_KEY && CONFIG.LANGFUSE_SECRET_KEY && CONFIG.LANGFUSE_HOST) {
      langfuse = new Langfuse({
        publicKey: CONFIG.LANGFUSE_PUBLIC_KEY,
        secretKey: CONFIG.LANGFUSE_SECRET_KEY,
        baseUrl: CONFIG.LANGFUSE_HOST,
      });
      return langfuse;
    }
    return null;
  }

  static mirrorEvent(e: LedgerEvent) {
    try {
      const payload: LangfuseQueuePayload = {
        trace: {
          id: e.request_id,
          sessionId: e.session_id,
          tags: [e.slm_gate === 'on' ? 'slm_gate=on' : 'slm_gate=off'],
          metadata: e.meta ? JSON.parse(e.meta) : undefined,
          name: e.skill || 'request',
        }
      };

      if (e.api_model && (e.api_in_tok > 0 || e.api_out_tok > 0)) {
        payload.generation = {
          name: 'api_call',
          model: e.api_model,
          usage: {
            input: e.api_in_tok,
            output: e.api_out_tok,
          },
          startTime: new Date(new Date(e.ts).getTime() - e.api_latency_s * 1000).toISOString(),
          endTime: new Date(e.ts).toISOString(),
          metadata: { cost_usd: e.cost_usd },
        };
      }

      if (e.slm_model && (e.in_tok > 0 || e.out_tok > 0)) {
        payload.span = {
          name: 'local_slm_call',
          startTime: new Date(new Date(e.ts).getTime() - (e.api_latency_s + e.slm_latency_s) * 1000).toISOString(),
          endTime: new Date(new Date(e.ts).getTime() - e.api_latency_s * 1000).toISOString(),
          metadata: {
            model: e.slm_model,
            usage: {
              input: e.in_tok,
              output: e.out_tok,
            },
            cost_usd: 0,
          },
        };
      }

      const statement = getDb().prepare('INSERT INTO langfuse_queue (payload) VALUES (?)');
      statement.run(JSON.stringify(payload));
    } catch (err) {
      console.error('Failed to queue langfuse event:', err);
    }
  }

  static async flushQueue() {
    const client = LangfuseSink.getClient();
    if (!client) return;
    
    const db = getDb();
    const rows = db.prepare('SELECT id, payload FROM langfuse_queue WHERE synced = 0 LIMIT 50').all() as {id: number, payload: string}[];
    
    if (rows.length === 0) return;
    
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as LangfuseQueuePayload;
        
        const trace = client.trace(payload.trace);
        
        if (payload.generation) {
          const genPayload = { 
            ...payload.generation,
            startTime: new Date(payload.generation.startTime),
            endTime: new Date(payload.generation.endTime)
          };
          trace.generation(genPayload);
        }
        if (payload.span) {
          const spanPayload = { 
            ...payload.span,
            startTime: new Date(payload.span.startTime),
            endTime: new Date(payload.span.endTime)
          };
          trace.span(spanPayload);
        }
        
        db.prepare('DELETE FROM langfuse_queue WHERE id = ?').run(row.id);
      } catch (err) {
        console.error(`Failed to flush langfuse event ${row.id}:`, err);
      }
    }
    
    await client.flushAsync();
  }

  /**
   * Test-only utility to reset the internal client state.
   */
  static __resetForTests() {
    langfuse = null;
    db = null;
  }
}
