/**
 * @fileoverview Utility script to completely purge/wipe all traces and scores
 * from the configured remote Langfuse project.
 *
 * @desc Uses raw fetch for maximum control over error handling and rate-limit
 * detection. Langfuse Cloud enforces a 50 trace-deletes/day quota; the script
 * detects 429 responses and reports the reset time instead of silently failing.
 *
 * Strategy:
 *   1. List ALL scores via GET /api/public/v2/scores → DELETE /api/public/scores/{id}
 *   2. List ALL traces via GET /api/public/traces     → DELETE /api/public/traces/{id}
 *   3. Archive score configs via PATCH /api/public/score-configs/{id}
 */

import { CONFIG, requireKeys } from '../config.js';

interface PaginatedResponse<T> {
  data: T[];
  meta?: { totalPages?: number; totalItems?: number; page?: number };
}

function makeAuthHeader(): string {
  const pub = CONFIG.LANGFUSE_PUBLIC_KEY!;
  const sec = CONFIG.LANGFUSE_SECRET_KEY!;
  return `Basic ${Buffer.from(`${pub}:${sec}`).toString('base64')}`;
}

/**
 * @desc Paginate through a Langfuse list endpoint and collect all item IDs
 */
async function collectAllIds(
  baseUrl: string,
  path: string,
  headers: Record<string, string>,
  label: string,
): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  while (true) {
    const url = `${baseUrl}${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.error(`  Failed to list ${label} (page ${page}): ${res.status} ${res.statusText}`);
      break;
    }
    const json = (await res.json()) as PaginatedResponse<{ id: string }>;
    const items = json.data || [];
    if (items.length === 0) break;
    for (const item of items) if (item.id) ids.push(item.id);
    if (page >= (json.meta?.totalPages ?? 1)) break;
    page++;
  }
  return ids;
}

async function wipeLangfuse(): Promise<void> {
  requireKeys(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_HOST']);

  const baseUrl = CONFIG.LANGFUSE_HOST!.replace(/\/$/, '');
  const auth = makeAuthHeader();
  const headers: Record<string, string> = {
    Authorization: auth,
    'Content-Type': 'application/json',
  };

  console.log('=== SLM Gate: Langfuse Remote Project Wiper ===\n');
  console.log(`Target Host: ${baseUrl}`);
  console.log('Fetching all scores and traces for complete removal...\n');

  // ── 1. Delete ALL scores ──────────────────────────────────────────────
  // v2 is the correct listing endpoint; v1 GET /api/public/scores doesn't exist (it's POST-only)
  const scoreIds = await collectAllIds(baseUrl, '/api/public/v2/scores', headers, 'scores');
  console.log(`Found ${scoreIds.length} remote score(s) to wipe.`);

  let scoresDeleted = 0;
  let scoresFailed = 0;
  for (const id of scoreIds) {
    const res = await fetch(`${baseUrl}/api/public/scores/${id}`, { method: 'DELETE', headers });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const details = body.details as Record<string, unknown> | undefined;
      const resetAt = details?.resetAt ?? 'unknown';
      console.error(`\n⛔ Rate limited on score deletion. Reset at: ${resetAt}`);
      console.error(`   Remaining: ${details?.remaining ?? '?'} / ${details?.limit ?? '?'}`);
      break;
    }
    if (res.ok || res.status === 204) {
      scoresDeleted++;
    } else {
      scoresFailed++;
      if (scoresFailed <= 3) {
        console.warn(`  ⚠ Failed to delete score ${id}: ${res.status} ${res.statusText}`);
      }
    }
    if ((scoresDeleted + scoresFailed) % 10 === 0) {
      process.stderr.write(`\r  Progress: ${scoresDeleted} deleted / ${scoreIds.length} total`);
    }
  }
  if (scoreIds.length > 0) console.log('');
  console.log(`✓ Scores wiped: ${scoresDeleted}${scoresFailed > 0 ? ` (${scoresFailed} failed)` : ''}\n`);

  // ── 2. Delete ALL traces ──────────────────────────────────────────────
  const traceIds = await collectAllIds(baseUrl, '/api/public/traces', headers, 'traces');
  console.log(`Found ${traceIds.length} remote trace(s) to wipe.`);

  let tracesDeleted = 0;
  let tracesFailed = 0;
  let isRateLimited = false;
  for (const id of traceIds) {
    const res = await fetch(`${baseUrl}/api/public/traces/${id}`, { method: 'DELETE', headers });
    if (res.status === 429) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const details = body.details as Record<string, unknown> | undefined;
      let resetAt = 'unknown';
      if (details?.resetAt) {
        try { resetAt = new Date(details.resetAt as string).toLocaleString(); } catch { resetAt = String(details.resetAt); }
      }
      let retryAfterMsg = 'unknown';
      if (typeof details?.retryAfterSeconds === 'number') {
        const secs = details.retryAfterSeconds;
        const d = Math.floor(secs / 86400);
        const h = Math.floor((secs % 86400) / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = Math.floor(secs % 60);
        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (s > 0 || parts.length === 0) parts.push(`${s}s`);
        retryAfterMsg = parts.join(' ');
      }

      console.error(`\n⛔ Rate limited on trace deletion. Reset at: ${resetAt} (retry after ${retryAfterMsg})`);
      console.error(`   Remaining: ${details?.remaining ?? '?'} / ${details?.limit ?? '?'}`);
      console.error(`   Deleted ${tracesDeleted} of ${traceIds.length} before hitting the limit.`);
      console.error(`   Re-run this command after the reset time to continue.\n`);
      isRateLimited = true;
      break;
    }
    if (res.ok || res.status === 204) {
      tracesDeleted++;
    } else {
      tracesFailed++;
      if (tracesFailed <= 3) {
        const body = await res.text().catch(() => '');
        console.warn(`  ⚠ Failed to delete trace ${id}: ${res.status} ${res.statusText} ${body.slice(0, 100)}`);
      }
    }
    if ((tracesDeleted + tracesFailed) % 10 === 0) {
      process.stderr.write(`\r  Progress: ${tracesDeleted} deleted / ${traceIds.length} total`);
    }
  }
  if (traceIds.length > 0 && !isRateLimited) console.log('');
  console.log(`✓ Traces wiped: ${tracesDeleted}${tracesFailed > 0 ? ` (${tracesFailed} failed)` : ''}\n`);

  // ── 3. Archive stale score configs ────────────────────────────────────
  try {
    const cfgIds = await collectAllIds(baseUrl, '/api/public/score-configs', headers, 'score-configs');
    if (cfgIds.length > 0) {
      console.log(`Found ${cfgIds.length} score config(s) to archive...`);
      for (const id of cfgIds) {
        const res = await fetch(`${baseUrl}/api/public/score-configs/${id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ isArchived: true }),
        });
        if (res.ok) console.log(`  ✓ Archived config ${id}`);
      }
    }
  } catch {
    // non-fatal
  }

  if (isRateLimited) {
    console.log('⚠ Wipe incomplete due to rate limiting. Re-run after the reset time shown above.');
  } else {
    console.log('🎉 Langfuse remote project is now 100% clean and reset to zero.\n');
  }
}

wipeLangfuse().catch((err) => {
  console.error('Fatal error during wipe:', err);
  process.exit(1);
});
