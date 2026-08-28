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

import { safeCalculateCostUsd } from '../pricing/index.js';

export interface LangfuseGenerationPayload {
  id?: string;
  name: string;
  model: string;
  usageDetails: {
    input?: number;
    output?: number;
    total?: number;
  };
  costDetails?: {
    total: number;
    input?: number;
    output?: number;
  };
  startTime: string;
  endTime: string;
  metadata?: Record<string, unknown>;
}

export interface LangfuseScorePayload {
  id?: string;
  name: string;
  value: number | string;
  comment?: string;
  dataType?: 'NUMERIC' | 'BOOLEAN' | 'CATEGORICAL';
}

export interface LangfuseQueuePayload {
  trace: {
    id: string;
    sessionId?: string | null;
    tags: string[];
    metadata?: Record<string, unknown>;
    name: string;
  };
  generations?: LangfuseGenerationPayload[];
  generation?: LangfuseGenerationPayload; // legacy single generation support
  span?: {
    name: string;
    startTime: string;
    endTime: string;
    metadata: {
      model: string;
      usage?: {
        input: number;
        output: number;
      };
      cost_usd: number;
    };
  };
  scores?: LangfuseScorePayload[];
}

export function formatEventForLangfuse(e: LedgerEvent): LangfuseQueuePayload {
  const referenceCloudModel = CONFIG.CLOUD_MODEL || 'gemini-2.5-flash';
  
  // Calculate baseline metrics (what it would have cost/consumed without SLM routing or compression)
  let baselineTokens = 0;
  let baselineCostUsd = 0;
  let tokensSaved = 0;
  let costSavedUsd = 0;
  
  const parsedMeta = e.meta ? (() => { try { return JSON.parse(e.meta); } catch { return {}; } })() : {};
  
  if (e.route === 'defer_local') {
    baselineTokens = (e.in_tok || 0) + (e.out_tok || 0);
    baselineCostUsd = safeCalculateCostUsd(referenceCloudModel, e.in_tok, e.out_tok);
    tokensSaved = baselineTokens;
    costSavedUsd = baselineCostUsd;
  } else if (e.route === 'forward_compressed') {
    const rawInTok = typeof parsedMeta.raw_in_tok === 'number' ? parsedMeta.raw_in_tok : (e.api_in_tok > 0 ? Math.round(e.api_in_tok * 1.5) : e.in_tok);
    baselineTokens = rawInTok + (e.api_out_tok || e.out_tok || 0);
    baselineCostUsd = safeCalculateCostUsd(e.api_model || referenceCloudModel, rawInTok, e.api_out_tok || e.out_tok || 0);
    const actualTokens = (e.api_in_tok || 0) + (e.api_out_tok || 0);
    tokensSaved = Math.max(0, baselineTokens - actualTokens);
    costSavedUsd = Math.max(0, baselineCostUsd - (e.cost_usd || 0));
  } else if (e.route === 'condition') {
    baselineTokens = e.in_tok || 0;
    const actualTokens = e.out_tok || 0;
    tokensSaved = Math.max(0, baselineTokens - actualTokens);
    baselineCostUsd = safeCalculateCostUsd(referenceCloudModel, baselineTokens, 0);
    const conditionedCostUsd = safeCalculateCostUsd(referenceCloudModel, actualTokens, 0);
    costSavedUsd = Math.max(0, baselineCostUsd - conditionedCostUsd);
  } else {
    // forward_raw or escalate
    baselineTokens = (e.api_in_tok || e.in_tok || 0) + (e.api_out_tok || e.out_tok || 0);
    baselineCostUsd = e.cost_usd || 0;
    tokensSaved = 0;
    costSavedUsd = 0;
  }

  const traceName = e.skill 
    ? e.skill 
    : (e.layer === 'mcp' ? `[mcp] ${e.route}` : `[llm] ${e.route}`);

  const tags = [
    e.slm_gate === 'on' ? 'slm_gate=on' : 'slm_gate=off',
    `route:${e.route}`,
    `layer:${e.layer}`,
    `call:${e.is_local_call ? 'local' : 'cloud'}`,
    `model:${e.api_model || e.slm_model || 'unknown'}`
  ];

  const metadata: Record<string, unknown> = {
    ...parsedMeta,
    route: e.route,
    layer: e.layer,
    is_local_call: Boolean(e.is_local_call),
    slm_model: e.slm_model ?? undefined,
    api_model: e.api_model ?? undefined,
    slm_latency_s: e.slm_latency_s,
    api_latency_s: e.api_latency_s,
    cost_usd: e.cost_usd,
    baseline_tokens: baselineTokens,
    baseline_cost_usd: Number(baselineCostUsd.toFixed(6)),
    tokens_saved: tokensSaved,
    cost_saved_usd: Number(costSavedUsd.toFixed(6)),
    verifier_flags: e.verifier_flags ? (() => { try { return JSON.parse(e.verifier_flags); } catch { return e.verifier_flags; } })() : undefined,
  };

  const generations: LangfuseGenerationPayload[] = [];

  // Cloud generation
  if (e.api_model && (e.api_in_tok > 0 || e.api_out_tok > 0)) {
    const apiLatency = e.api_latency_s > 0 ? e.api_latency_s : 0.05;
    generations.push({
      id: `${e.request_id}_gen_cloud`,
      name: 'cloud_api_call',
      model: e.api_model,
      usageDetails: {
        input: e.api_in_tok,
        output: e.api_out_tok,
        total: e.api_in_tok + e.api_out_tok,
      },
      costDetails: {
        total: e.cost_usd,
      },
      startTime: new Date(new Date(e.ts).getTime() - apiLatency * 1000).toISOString(),
      endTime: new Date(e.ts).toISOString(),
      metadata: {
        cost_usd: e.cost_usd,
        route: e.route,
      }
    });
  }

  // Local SLM generation (logged as generation so Langfuse aggregates local token throughput at $0)
  if (e.slm_model && (e.in_tok > 0 || e.out_tok > 0)) {
    const slmLatency = e.slm_latency_s > 0 ? e.slm_latency_s : 0.05;
    const apiLatency = e.api_latency_s || 0;
    generations.push({
      id: `${e.request_id}_gen_local`,
      name: 'local_slm_generation',
      model: e.slm_model,
      usageDetails: {
        input: e.in_tok,
        output: e.out_tok,
        total: e.in_tok + e.out_tok,
      },
      costDetails: {
        total: 0,
      },
      startTime: new Date(new Date(e.ts).getTime() - (apiLatency + slmLatency) * 1000).toISOString(),
      endTime: new Date(new Date(e.ts).getTime() - apiLatency * 1000).toISOString(),
      metadata: {
        cost_usd: 0,
        route: e.route,
      }
    });
  }

  const scores: LangfuseScorePayload[] = [
    { id: `${e.request_id}_score_cost_saved`, name: 'cost_saved_cents', value: Number((costSavedUsd * 100).toFixed(6)), dataType: 'NUMERIC' },
    { id: `${e.request_id}_score_tokens_saved`, name: 'tokens_saved', value: tokensSaved, dataType: 'NUMERIC' },
  ];

  if (typeof e.quality_score === 'number') {
    scores.push({ id: `${e.request_id}_score_quality_score`, name: 'accuracy_rate_pct', value: Number((e.quality_score * 100).toFixed(2)), dataType: 'NUMERIC' });
  }

  const isLocal = e.route === 'defer_local' || (e.verifier_flags && !e.verifier_flags.includes('escalate'));
  const verifiedLabel = isLocal ? 'Passed (Local SLM)' : 'Escalated (Cloud)';
  const verifiedComment = isLocal
    ? 'Handled 100% locally by Small Language Model ($0 cloud cost)'
    : 'Distilled by SLM and escalated to Cloud model';
  scores.push({
    id: `${e.request_id}_score_verified`,
    name: 'verified',
    value: verifiedLabel,
    dataType: 'CATEGORICAL',
    comment: verifiedComment
  });

  return {
    trace: {
      id: e.request_id,
      sessionId: e.session_id,
      tags,
      metadata,
      name: traceName,
    },
    generations,
    scores,
  };
}

export class LangfuseSink {
  static _warnedMissingKeys = false;
  
  static getClient(): Langfuse | null {
    if (langfuse) return langfuse;
    const hasKeys = CONFIG.LANGFUSE_PUBLIC_KEY || CONFIG.LANGFUSE_SECRET_KEY || CONFIG.LANGFUSE_HOST;
    const hasAllKeys = CONFIG.LANGFUSE_PUBLIC_KEY && CONFIG.LANGFUSE_SECRET_KEY && CONFIG.LANGFUSE_HOST;
    
    if (hasAllKeys) {
      langfuse = new Langfuse({
        publicKey: CONFIG.LANGFUSE_PUBLIC_KEY!,
        secretKey: CONFIG.LANGFUSE_SECRET_KEY!,
        baseUrl: CONFIG.LANGFUSE_HOST!,
      });
      return langfuse;
    } else if (hasKeys && !this._warnedMissingKeys) {
      console.error('Langfuse needs LANGFUSE_PUBLIC_KEY + SECRET_KEY + HOST — running ledger-only');
      this._warnedMissingKeys = true;
    }
    return null;
  }

  static mirrorEvent(e: LedgerEvent) {
    try {
      const payload = formatEventForLangfuse(e);
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
    
    let hasError = false;
    let lastError: any;
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload) as LangfuseQueuePayload;
        const trace = client.trace(payload.trace);
        
        // Handle generations (both array and legacy single generation)
        const generations = payload.generations || (payload.generation ? [payload.generation] : []);
        for (const gen of generations) {
          trace.generation({
            id: gen.id || `${trace.id}_gen_${gen.name}`,
            name: gen.name,
            model: gen.model,
            usageDetails: gen.usageDetails,
            costDetails: gen.costDetails,
            startTime: new Date(gen.startTime),
            endTime: new Date(gen.endTime),
            metadata: gen.metadata,
          } as any);
        }

        // Handle scores
        if (payload.scores && Array.isArray(payload.scores)) {
          for (const score of payload.scores) {
            trace.score({
              id: score.id || `${trace.id}_score_${score.name}`,
              name: score.name,
              value: score.value as any,
              dataType: score.dataType,
              comment: score.comment,
            });
          }
        }

        // Legacy span support
        if (payload.span) {
          trace.span({
            name: payload.span.name,
            startTime: new Date(payload.span.startTime),
            endTime: new Date(payload.span.endTime),
            metadata: payload.span.metadata,
          });
        }
        
        db.prepare('DELETE FROM langfuse_queue WHERE id = ?').run(row.id);
      } catch (err) {
        hasError = true;
        lastError = err;
      }
    }
    
    if (hasError) {
      console.warn(`[ledger] Warning: Failed to flush one or more Langfuse events. Last error: ${lastError.message || String(lastError)}`);
    }
    
    try {
      await client.flushAsync();
    } catch (err: any) {
      console.warn(`[ledger] Warning: Langfuse network flush failed: ${err.message || String(err)}`);
    }
  }

  /**
   * Test-only utility to reset the internal client state.
   */
  static __resetForTests() {
    langfuse = null;
    db = null;
  }
}


