import Database from 'better-sqlite3';
import { CONFIG } from '../config.js';
import crypto from 'node:crypto';

let db: Database.Database | null = null;

export interface DistillPolicyRow {
  tool_pattern: string;
  fidelity: 'verbatim' | 'structural' | 'summarize';
  priority: number;
  updated_at: string;
}

export interface DistillFeedbackRow {
  id: string;
  tool_name: string;
  skill: string;
  content_hash: string;
  region_text: string;
  embedding_blob: Buffer;
  signal: number;
  created_at: string;
}

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
  agent?: string;
  provider?: string | null;
}

import fs from 'node:fs';
import path from 'node:path';

export function getDb(): Database.Database {
  if (!db) {
    const ledgerPath = CONFIG.LEDGER_PATH || './output/ledger.sqlite';
    const dir = path.dirname(ledgerPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(ledgerPath);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS distill_policy (
        tool_pattern TEXT PRIMARY KEY,
        fidelity TEXT CHECK (fidelity IN ('verbatim','structural','summarize')),
        priority INTEGER,
        updated_at TEXT
      );
      
      CREATE TABLE IF NOT EXISTS distill_feedback (
        id TEXT PRIMARY KEY,
        tool_name TEXT,
        skill TEXT,
        content_hash TEXT,
        region_text TEXT,
        embedding_blob BLOB,
        signal INTEGER,
        created_at TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_distill_feedback_tool ON distill_feedback(tool_name);
      CREATE INDEX IF NOT EXISTS idx_distill_feedback_created ON distill_feedback(created_at);

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
        meta TEXT,
        provider TEXT,
        agent TEXT
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

      CREATE TABLE IF NOT EXISTS elision_cache (
        id TEXT PRIMARY KEY,
        tool_name TEXT,
        args TEXT,
        original_text TEXT,
        ranges TEXT,
        content_hash TEXT,
        created_at TEXT,
        last_accessed_at TEXT,
        size_bytes INTEGER
      );
    `);


    const policyCount = db.prepare('SELECT count(*) as c FROM distill_policy').get() as { c: number } | undefined;
    if (!policyCount || policyCount.c === 0) {
      const stmt = db.prepare('INSERT INTO distill_policy (tool_pattern, fidelity, priority, updated_at) VALUES (?, ?, ?, ?)');
      const now = new Date().toISOString();
      stmt.run('%skill%', 'verbatim', 10, now);
      stmt.run('get_skill', 'verbatim', 10, now);
      stmt.run('read_file', 'structural', 5, now);
      stmt.run('view_file', 'structural', 5, now);
      stmt.run('run_command', 'summarize', 0, now);
      stmt.run('get_logs', 'summarize', 0, now);
      stmt.run('grep_search', 'summarize', 0, now);
      stmt.run('list_dir', 'summarize', 0, now);
      stmt.run('*', 'summarize', -1, now);
    }

    // Automatic cleanup (startup sweep)
    const retentionDays = CONFIG.ELISION_RETENTION_DAYS ?? 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    db.prepare(`DELETE FROM elision_cache WHERE created_at < ?`).run(cutoffDate.toISOString());
  }
  return db;
}

export interface ElisionRecord {
  id: string;
  tool_name: string;
  args: string; // JSON
  original_text: string;
  ranges: string; // JSON
  content_hash: string;
  created_at: string;
  last_accessed_at: string;
  size_bytes: number;
}

export function writeElision(record: Omit<ElisionRecord, 'created_at' | 'last_accessed_at'>) {
  const ts = new Date().toISOString();
  
  // Size cap constraint
  const maxMb = CONFIG.ELISION_MAX_MB ?? 500;
  const maxBytes = maxMb * 1024 * 1024;
  const db = getDb();
  
  // Start a transaction for the write + eviction
  const transaction = db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO elision_cache (
        id, tool_name, args, original_text, ranges, content_hash, created_at, last_accessed_at, size_bytes
      ) VALUES (
        @id, @tool_name, @args, @original_text, @ranges, @content_hash, @created_at, @last_accessed_at, @size_bytes
      )
    `);
    
    insertStmt.run({
      ...record,
      created_at: ts,
      last_accessed_at: ts
    });

    // Evict oldest by last_accessed_at if we exceed max size
    db.prepare(`
      DELETE FROM elision_cache 
      WHERE id IN (
        SELECT id FROM (
          SELECT id, sum(size_bytes) OVER (ORDER BY last_accessed_at DESC) as running_total
          FROM elision_cache
        ) WHERE running_total > ?
      )
    `).run(maxBytes);
  });

  transaction();
}

export function getElision(id: string): ElisionRecord | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM elision_cache WHERE id = ?`).get(id) as ElisionRecord | undefined;
  
  if (row) {
    // Lazy expiry check
    const retentionDays = CONFIG.ELISION_RETENTION_DAYS ?? 180;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    
    if (new Date(row.created_at) < cutoffDate) {
      db.prepare(`DELETE FROM elision_cache WHERE id = ?`).run(id);
      return null;
    }

    db.prepare(`UPDATE elision_cache SET last_accessed_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
    return row;
  }
  
  return null;
}

export function isLocalEvent(e: LedgerEvent): boolean {
  return e.route === 'defer_local' || (!!e.verifier_flags && !e.verifier_flags.includes('escalate'));
}

export function providerFromModel(model?: string): 'claude' | 'chatgpt' | 'gemini' | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes('claude') || m.includes('sonnet') || m.includes('opus') || m.includes('haiku') || m.includes('anthropic')) return 'claude';
  if (m.includes('gemini') || m.includes('gemma') || m.includes('bison')) return 'gemini';
  if (m.includes('gpt') || m.includes('openai') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) return 'chatgpt';
  return null;
}

export function providerFromAgent(agent?: string): 'claude' | 'chatgpt' | 'gemini' | null {
  if (!agent) return null;
  const a = agent.toLowerCase();
  if (a.includes('antigravity')) return 'gemini';
  if (a.includes('claude')) return 'claude';
  if (a.includes('chatgpt') || a.includes('openai')) return 'chatgpt';
  return null;
}

export function perEventTokensSaved(e: LedgerEvent): number {
  const parsedMeta = e.meta ? (() => { try { return JSON.parse(e.meta); } catch { return {}; } })() : {};
  if (e.route === 'defer_local') {
    return (e.in_tok || 0) + (e.out_tok || 0);
  } else if (e.route === 'forward_compressed') {
    const rawInTok = typeof parsedMeta.raw_in_tok === 'number' ? parsedMeta.raw_in_tok : (e.api_in_tok > 0 ? Math.round(e.api_in_tok * 1.5) : e.in_tok);
    const baselineTokens = rawInTok + (e.api_out_tok || e.out_tok || 0);
    const actualTokens = (e.api_in_tok || 0) + (e.api_out_tok || 0);
    return Math.max(0, baselineTokens - actualTokens);
  } else if (e.route === 'condition') {
    const baselineTokens = e.in_tok || 0;
    const actualTokens = e.out_tok || 0;
    return Math.max(0, baselineTokens - actualTokens);
  }
  return 0;
}

export function perEventBaselineTokens(e: LedgerEvent): number {
  const parsedMeta = e.meta ? (() => { try { return JSON.parse(e.meta); } catch { return {}; } })() : {};
  if (e.route === 'defer_local') {
    return (e.in_tok || 0) + (e.out_tok || 0);
  } else if (e.route === 'forward_compressed') {
    const rawInTok = typeof parsedMeta.raw_in_tok === 'number' ? parsedMeta.raw_in_tok : (e.api_in_tok > 0 ? Math.round(e.api_in_tok * 1.5) : e.in_tok);
    return rawInTok + (e.api_out_tok || e.out_tok || 0);
  } else if (e.route === 'condition') {
    return e.in_tok || 0;
  }
  return (e.api_in_tok || e.in_tok || 0) + (e.api_out_tok || e.out_tok || 0);
}

export function computeTotals(rows: LedgerEvent[]) {
  let tokensSaved = 0;
  let baselineTokens = 0;
  
  for (const r of rows) {
    baselineTokens += perEventBaselineTokens(r);
    tokensSaved += perEventTokensSaved(r);
  }
  
  return { tokensSaved, baselineTokens };
}

export function computeTotalsByProvider(rows: LedgerEvent[]) {
  const stats = {
    claude: { tokensSaved: 0, baselineTokens: 0 },
    chatgpt: { tokensSaved: 0, baselineTokens: 0 },
    gemini: { tokensSaved: 0, baselineTokens: 0 },
  };
  for (const r of rows) {
    const p = r.provider || providerFromModel(r.api_model) || providerFromAgent(r.agent) || null;
    if (p && stats[p as keyof typeof stats]) {
      stats[p as keyof typeof stats].baselineTokens += perEventBaselineTokens(r);
      stats[p as keyof typeof stats].tokensSaved += perEventTokensSaved(r);
    }
  }
  return stats;
}

export function computeCycleRates(rows: LedgerEvent[]): Record<'claude'|'chatgpt'|'gemini', number> {
  const s = computeTotalsByProvider(rows);
  const plans = {
    claude: CONFIG.RESOLVED_PLAN_CLAUDE,
    chatgpt: CONFIG.RESOLVED_PLAN_CHATGPT,
    gemini: CONFIG.RESOLVED_PLAN_GEMINI
  };
  const out: any = { claude: 0, chatgpt: 0, gemini: 0 };
  for (const p of ['claude', 'chatgpt', 'gemini'] as const) {
    const t = s[p];
    out[p] = t.baselineTokens > 0 ? Number((plans[p].windowMinutes * (t.tokensSaved / t.baselineTokens)).toFixed(2)) : 0;
  }
  return out;
}

export function writeEvent(e: LedgerEvent) {
  const provider = e.provider ?? providerFromModel(e.api_model) ?? providerFromAgent(e.agent) ?? null;
  const statement = getDb().prepare(`
    INSERT OR REPLACE INTO events (
      ts, layer, request_id, session_id, skill, route, is_local_call, slm_model, api_model,
      in_tok, out_tok, api_in_tok, api_out_tok, cost_usd, slm_latency_s, api_latency_s,
      verifier_flags, quality_score, slm_gate, meta, provider, agent
    ) VALUES (
      @ts, @layer, @request_id, @session_id, @skill, @route, @is_local_call, @slm_model, @api_model,
      @in_tok, @out_tok, @api_in_tok, @api_out_tok, @cost_usd, @slm_latency_s, @api_latency_s,
      @verifier_flags, @quality_score, @slm_gate, @meta, @provider, @agent
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
    meta: e.meta ?? null,
    provider: provider,
    agent: e.agent ?? null
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
  
  const baselineTokens = perEventBaselineTokens(e);
  const tokensSaved = perEventTokensSaved(e);
  let baselineCostUsd = 0;
  let costSavedUsd = 0;
  
  const parsedMeta = e.meta ? (() => { try { return JSON.parse(e.meta); } catch { return {}; } })() : {};
  
  if (e.route === 'defer_local') {
    baselineCostUsd = safeCalculateCostUsd(referenceCloudModel, e.in_tok, e.out_tok);
    costSavedUsd = baselineCostUsd;
  } else if (e.route === 'forward_compressed') {
    const rawInTok = typeof parsedMeta.raw_in_tok === 'number' ? parsedMeta.raw_in_tok : (e.api_in_tok > 0 ? Math.round(e.api_in_tok * 1.5) : e.in_tok);
    baselineCostUsd = safeCalculateCostUsd(e.api_model || referenceCloudModel, rawInTok, e.api_out_tok || e.out_tok || 0);
    costSavedUsd = Math.max(0, baselineCostUsd - (e.cost_usd || 0));
  } else if (e.route === 'condition') {
    baselineCostUsd = safeCalculateCostUsd(referenceCloudModel, baselineTokens, 0);
    const conditionedCostUsd = safeCalculateCostUsd(referenceCloudModel, e.out_tok || 0, 0);
    costSavedUsd = Math.max(0, baselineCostUsd - conditionedCostUsd);
  } else {
    // forward_raw or escalate
    baselineCostUsd = e.cost_usd || 0;
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

  // Accuracy rule
  if (typeof e.quality_score === 'number') {
    scores.push({ id: `${e.request_id}_score_accuracy_rate_pct`, name: 'accuracy_rate_pct', value: Number((e.quality_score * 100).toFixed(2)), dataType: 'NUMERIC' });
  } else {
    const isLocalAttempted = parsedMeta.local_attempted === 1 || e.route === 'defer_local' || e.route === 'condition' || e.is_local_call === 1;
    if (isLocalAttempted) {
      let hasFailureFlag = false;
      if (e.verifier_flags) {
        try {
          const flags = JSON.parse(e.verifier_flags);
          hasFailureFlag = Array.isArray(flags) && flags.length > 0;
        } catch {
          hasFailureFlag = Boolean(e.verifier_flags);
        }
      }
      const isAccepted = parsedMeta.local_accepted === 1 || e.route === 'defer_local' || e.route === 'condition' || (e.is_local_call === 1 && !hasFailureFlag);
      scores.push({ id: `${e.request_id}_score_accuracy_rate_pct`, name: 'accuracy_rate_pct', value: isAccepted ? 100 : 0, dataType: 'NUMERIC' });
    }
  }

  const isLocal = isLocalEvent(e);
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
  
  static hasValidConfig(): boolean {
    const hasKeys = CONFIG.LANGFUSE_PUBLIC_KEY || CONFIG.LANGFUSE_SECRET_KEY || CONFIG.LANGFUSE_HOST;
    const hasAllKeys = CONFIG.LANGFUSE_PUBLIC_KEY && CONFIG.LANGFUSE_SECRET_KEY && CONFIG.LANGFUSE_HOST;
    
    if (hasAllKeys) {
      return true;
    } else if (hasKeys && !this._warnedMissingKeys) {
      console.error('Langfuse needs LANGFUSE_PUBLIC_KEY + SECRET_KEY + HOST — running ledger-only');
      this._warnedMissingKeys = true;
    }
    return false;
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
    if (!this.hasValidConfig()) return;
    
    const db = getDb();
    const rows = db.prepare('SELECT id, payload FROM langfuse_queue WHERE synced = 0 LIMIT 50').all() as {id: number, payload: string}[];
    
    if (rows.length === 0) return;
    
    const batch = [];
    const rowIds = [];
    
    for (const row of rows) {
      rowIds.push(row.id);
      const payload = JSON.parse(row.payload) as LangfuseQueuePayload;
      
      batch.push({
        id: crypto.randomUUID(),
        type: 'trace-create',
        timestamp: new Date().toISOString(),
        body: payload.trace
      });
      
      const generations = payload.generations || (payload.generation ? [payload.generation] : []);
      for (const gen of generations) {
        batch.push({
          id: crypto.randomUUID(),
          type: 'generation-create',
          timestamp: new Date().toISOString(),
          body: {
            ...gen,
            traceId: payload.trace.id
          }
        });
      }

      if (payload.scores && Array.isArray(payload.scores)) {
        for (const score of payload.scores) {
          batch.push({
            id: crypto.randomUUID(),
            type: 'score-create',
            timestamp: new Date().toISOString(),
            body: {
              ...score,
              traceId: payload.trace.id
            }
          });
        }
      }

      if (payload.span) {
        batch.push({
          id: crypto.randomUUID(),
          type: 'span-create',
          timestamp: new Date().toISOString(),
          body: {
            ...payload.span,
            traceId: payload.trace.id
          }
        });
      }
    }
    
    try {
      const auth = Buffer.from(`${CONFIG.LANGFUSE_PUBLIC_KEY}:${CONFIG.LANGFUSE_SECRET_KEY}`).toString('base64');
      const res = await fetch(`${CONFIG.LANGFUSE_HOST}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ batch })
      });
      
      if (!res.ok) {
        const errText = await res.text();
        console.warn(`[ledger] Warning: Langfuse ingestion failed (${res.status}): ${errText}`);
      } else {
        const placeholders = rowIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM langfuse_queue WHERE id IN (${placeholders})`).run(...rowIds);
      }
    } catch (err: any) {
      console.warn(`[ledger] Warning: Langfuse network flush failed: ${err.message || String(err)}`);
    }
  }

  static _lastPublishTs = 0;

  static async publishCycleRates(options?: { force?: boolean }) {
    if (!this.hasValidConfig()) return;

    // Throttle to 1 per minute unless we are explicitly given precomputed stats (e.g. from sync loop)
    const now = Date.now();
    if (!options?.force && now - this._lastPublishTs < 60000) return;
    this._lastPublishTs = now;

    const db = getDb();
    const rows = db.prepare(`SELECT * FROM events`).all() as LedgerEvent[];
    const providerStats = computeTotalsByProvider(rows);
    const rates = computeCycleRates(rows);

    const timestamp = new Date().toISOString();
    const batch: any[] = [
      {
        id: crypto.randomUUID(),
        type: 'trace-create',
        timestamp,
        body: {
          id: 'slmgate_cycle_rate_summary',
          name: 'SLM Gate Cycle Rates'
        }
      }
    ];

    for (const [provider, stats] of Object.entries(providerStats)) {
      if (stats.baselineTokens > 0) {
        batch.push({
          id: crypto.randomUUID(),
          type: 'score-create',
          timestamp,
          body: {
            traceId: 'slmgate_cycle_rate_summary',
            id: `slmgate_cycle_rate_${provider}`,
            name: `cycle_extended_per_window_${provider}`,
            value: rates[provider as keyof typeof rates],
            dataType: 'NUMERIC'
          }
        });
      }
    }

    if (batch.length === 1) return; // Only trace, no scores


    try {
      const auth = Buffer.from(`${CONFIG.LANGFUSE_PUBLIC_KEY}:${CONFIG.LANGFUSE_SECRET_KEY}`).toString('base64');
      const res = await fetch(`${CONFIG.LANGFUSE_HOST}/api/public/ingestion`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ batch })
      });
      
      if (!res.ok) {
        console.warn(`[ledger] Warning: Langfuse cycle rate publish failed (${res.status}): ${await res.text()}`);
      }
    } catch (err: any) {
      console.warn(`[ledger] Warning: Langfuse cycle rate publish failed: ${err.message || String(err)}`);
    }
  }

  /**
   * Test-only utility to reset the internal client state.
   */
  static __resetForTests() {
    db = null;
    this._lastPublishTs = 0;
  }
}




export function writeDistillFeedback(row: Omit<DistillFeedbackRow, 'created_at'>) {
  const db = getDb();
  if (!db) return;
  try {
    const stmt = db.prepare(`
      INSERT INTO distill_feedback (id, tool_name, skill, content_hash, region_text, embedding_blob, signal, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(row.id, row.tool_name, row.skill, row.content_hash, row.region_text, row.embedding_blob, row.signal, new Date().toISOString());
  } catch (e) {
    console.error('Failed to write distill feedback', e);
  }
}

export function getDistillFeedback(toolName: string, limit = 50): DistillFeedbackRow[] {
  const db = getDb();
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM distill_feedback WHERE tool_name = ? ORDER BY created_at DESC LIMIT ?')
             .all(toolName, limit) as DistillFeedbackRow[];
  } catch (e) {
    return [];
  }
}

export function getDistillPolicy(toolName: string): string {
  const db = getDb();
  if (!db) return 'summarize';
  try {
    const rows = db.prepare('SELECT tool_pattern, fidelity FROM distill_policy ORDER BY priority DESC').all() as any[];
    for (const r of rows) {
      if (r.tool_pattern === '*') return r.fidelity;
      const regexStr = r.tool_pattern.replace(/%/g, '.*');
      if (new RegExp('^' + regexStr + '$', 'i').test(toolName)) return r.fidelity;
    }
  } catch (e) {}
  return 'summarize';
}
