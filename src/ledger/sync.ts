/**
 * @fileoverview CLI utility script to synchronize/backfill SQLite ledger records to Langfuse Cloud.
 * 
 * Usage:
 *   pnpm run ledger:sync [--all] [--limit <n>] [--dry-run]
 */

import { CONFIG, requireKeys } from '../config.js';
import { formatEventForLangfuse, getDb, LangfuseSink, LedgerEvent } from './index.js';
import { initLangfuseConfigs } from './sync-config.js';
import crypto from 'node:crypto';

interface SyncStats {
  totalEvents: number;
  syncedTraces: number;
  localCalls: number;
  cloudCalls: number;
  localTokens: number;
  cloudTokens: number;
  baselineCostUsd: number;
  actualCostUsd: number;
  costSavedUsd: number;
  tokensSaved: number;
  errors: number;
}

export async function syncLedgerToLangfuse(options: { limit?: number; dryRun?: boolean } = {}): Promise<SyncStats> {
  const { limit, dryRun = false } = options;

  console.log('=== SLM Gate: SQLite to Langfuse Ledger Sync ===\n');
  console.log(`Database Source : ${CONFIG.LEDGER_PATH}`);
  console.log(`Target Host     : ${CONFIG.LANGFUSE_HOST || '<Not Set>'}`);
  console.log(`Mode            : ${dryRun ? 'DRY-RUN (No network requests)' : 'LIVE SYNC'}\n`);

  if (!dryRun) {
    requireKeys(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_HOST']);
    await initLangfuseConfigs();
  }

  const db = getDb();
  let query = 'SELECT * FROM events ORDER BY rowid ASC';
  if (limit && limit > 0) {
    query += ` LIMIT ${limit}`;
  }

  const rows = db.prepare(query).all() as LedgerEvent[];
  console.log(`Found ${rows.length} total event(s) in SQLite ledger.\n`);

  if (rows.length === 0) {
    console.log('No events to synchronize.');
    return {
      totalEvents: 0,
      syncedTraces: 0,
      localCalls: 0,
      cloudCalls: 0,
      localTokens: 0,
      cloudTokens: 0,
      baselineCostUsd: 0,
      actualCostUsd: 0,
      costSavedUsd: 0,
      tokensSaved: 0,
      errors: 0,
    };
  }

  const stats: SyncStats = {
    totalEvents: rows.length,
    syncedTraces: 0,
    localCalls: 0,
    cloudCalls: 0,
    localTokens: 0,
    cloudTokens: 0,
    baselineCostUsd: 0,
    actualCostUsd: 0,
    costSavedUsd: 0,
    tokensSaved: 0,
    errors: 0,
  };

  const BATCH_SIZE = 50;
  let batchCount = 0;
  
  let batch: any[] = [];
  const flushBatch = async () => {
    if (batch.length === 0) return;
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
        console.warn(`\nLangfuse sync failed (${res.status}): ${errText}`);
        stats.errors += batch.length; // Approximate
      } else {
        stats.syncedTraces += batchCount;
        process.stdout.write(`\rProgress: ${stats.syncedTraces}/${rows.length} traces synced...`);
      }
    } catch (err: any) {
      console.error('\nNetwork error during sync:', err.message || err);
      stats.errors += batch.length;
    }
    batch = [];
    batchCount = 0;
  };

  const hasClient = !dryRun && LangfuseSink.hasValidConfig();
  if (!dryRun && !hasClient) {
    throw new Error('Could not initialize Langfuse sync. Verify LANGFUSE_* keys in .env.');
  }

  for (let i = 0; i < rows.length; i++) {
    const event = rows[i];
    try {
      const payload = formatEventForLangfuse(event);
      const meta = payload.trace.metadata || {};

      stats.actualCostUsd += event.cost_usd || 0;
      stats.baselineCostUsd += Number(meta.baseline_cost_usd || event.cost_usd || 0);
      stats.costSavedUsd += Number(meta.cost_saved_usd || 0);
      stats.tokensSaved += Number(meta.tokens_saved || 0);

      if (event.is_local_call) {
        stats.localCalls++;
        stats.localTokens += (event.in_tok || 0) + (event.out_tok || 0);
      }
      if (event.api_model && (event.api_in_tok > 0 || event.api_out_tok > 0)) {
        stats.cloudCalls++;
        stats.cloudTokens += (event.api_in_tok || 0) + (event.api_out_tok || 0);
      }

      if (hasClient) {
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

        batchCount++;
        if (batchCount >= BATCH_SIZE) {
          await flushBatch();
        }
      } else {
        stats.syncedTraces++;
      }
    } catch (err: any) {
      stats.errors++;
      console.error(`\nError syncing event ${event.request_id}:`, err.message || err);
    }
  }

  if (hasClient && batch.length > 0) {
    await flushBatch();
  }

  if (!dryRun) {
    process.stdout.write(`\rProgress: ${stats.syncedTraces}/${rows.length} traces synced.\n\n`);
  }

  console.log('--- Sync Summary Table ---');
  console.table([
    { Metric: 'Total Events in SQLite', Value: stats.totalEvents },
    { Metric: 'Traces Processed', Value: stats.syncedTraces },
    { Metric: 'Local SLM Calls ($0.00)', Value: stats.localCalls },
    { Metric: 'Local Tokens Processed', Value: stats.localTokens.toLocaleString() },
    { Metric: 'Cloud API Calls', Value: stats.cloudCalls },
    { Metric: 'Cloud Tokens Billed', Value: stats.cloudTokens.toLocaleString() },
    { Metric: 'Baseline Estimated Cost', Value: `$${stats.baselineCostUsd.toFixed(4)}` },
    { Metric: 'Actual Cost Incurred', Value: `$${stats.actualCostUsd.toFixed(4)}` },
    { Metric: 'Net Dollars Saved', Value: `$${stats.costSavedUsd.toFixed(4)}` },
    { Metric: 'Net Tokens Saved', Value: stats.tokensSaved.toLocaleString() },
    { Metric: 'Sync Errors', Value: stats.errors },
  ]);

  return stats;
}

// Execution entry point
const isDirectCall = process.argv[1] && (
  process.argv[1].endsWith('sync.ts') || 
  process.argv[1].endsWith('sync.js')
);

if (isDirectCall) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  let limit: number | undefined;
  if (limitIdx >= 0 && args[limitIdx + 1]) {
    limit = parseInt(args[limitIdx + 1], 10);
  }

  syncLedgerToLangfuse({ limit, dryRun })
    .then(() => {
      console.log('Sync process complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Fatal sync error:', err.message || err);
      process.exit(1);
    });
}
