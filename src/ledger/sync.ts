/**
 * @fileoverview CLI utility script to synchronize/backfill SQLite ledger records to Langfuse Cloud.
 * 
 * Usage:
 *   pnpm run ledger:sync [--all] [--limit <n>] [--dry-run]
 */

import { CONFIG, requireKeys } from '../config.js';
import { formatEventForLangfuse, getDb, LangfuseSink, LedgerEvent } from './index.js';
import { initLangfuseConfigs } from './sync-config.js';

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

  const client = dryRun ? null : LangfuseSink.getClient();
  if (!dryRun && !client) {
    throw new Error('Could not initialize Langfuse client. Verify LANGFUSE_* keys in .env.');
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

      if (!dryRun && client) {
        const trace = client.trace(payload.trace);

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

        stats.syncedTraces++;
        batchCount++;

        if (batchCount >= BATCH_SIZE) {
          await client.flushAsync();
          batchCount = 0;
          process.stdout.write(`\rProgress: ${stats.syncedTraces}/${rows.length} traces synced...`);
        }
      } else {
        stats.syncedTraces++;
      }
    } catch (err: any) {
      stats.errors++;
      console.error(`\nError syncing event ${event.request_id}:`, err.message || err);
    }
  }

  if (!dryRun && client && batchCount > 0) {
    await client.flushAsync();
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
