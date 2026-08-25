import { CONFIG } from '../src/config.js';
import { getDb } from '../src/ledger/index.js';

async function main() {
  console.log('--- Local SQLite Ledger Metrics ---');
  const db = getDb();

  const rows = db.prepare(`
    SELECT 
      slm_gate,
      SUM(cost_usd) as total_cost_usd,
      SUM(in_tok + out_tok + api_in_tok + api_out_tok) as total_tokens,
      AVG(quality_score) as avg_quality_score,
      COUNT(request_id) as row_count
    FROM events
    WHERE slm_gate IN ('on', 'off')
    GROUP BY slm_gate
  `).all() as {
    slm_gate: string;
    total_cost_usd: number | null;
    total_tokens: number | null;
    avg_quality_score: number | null;
    row_count: number;
  }[];

  const metrics = {
    on: { cost: 0, tokens: 0, quality: 0, count: 0 },
    off: { cost: 0, tokens: 0, quality: 0, count: 0 },
  };

  for (const row of rows) {
    if (row.slm_gate === 'on' || row.slm_gate === 'off') {
      metrics[row.slm_gate] = {
        cost: row.total_cost_usd ?? 0,
        tokens: row.total_tokens ?? 0,
        quality: row.avg_quality_score ?? 0,
        count: row.row_count,
      };
    }
  }

  const table = [
    {
      Arm: 'slm_gate=off (Baseline)',
      'Cost (USD)': metrics.off.cost.toFixed(4),
      'Tokens': metrics.off.tokens,
      'Avg Quality': metrics.off.quality.toFixed(2),
      'Count': metrics.off.count
    },
    {
      Arm: 'slm_gate=on (Router)',
      'Cost (USD)': metrics.on.cost.toFixed(4),
      'Tokens': metrics.on.tokens,
      'Avg Quality': metrics.on.quality.toFixed(2),
      'Count': metrics.on.count
    }
  ];

  console.table(table);

  const costSaved = metrics.off.cost - metrics.on.cost;
  const tokensSaved = metrics.off.tokens - metrics.on.tokens;
  const qualityChange = metrics.on.quality - metrics.off.quality;

  console.log('\n--- Deltas (on - off) ---');
  console.log(`Cost Saved: $${costSaved.toFixed(4)}`);
  console.log(`Tokens Saved: ${tokensSaved}`);
  console.log(`Quality Change: ${qualityChange > 0 ? '+' : ''}${qualityChange.toFixed(2)}`);

  if (CONFIG.LANGFUSE_PUBLIC_KEY && CONFIG.LANGFUSE_SECRET_KEY && CONFIG.LANGFUSE_HOST) {
    console.log('\n--- Querying Langfuse Metrics API v2 ---');
    const authHeader = 'Basic ' + Buffer.from(`${CONFIG.LANGFUSE_PUBLIC_KEY}:${CONFIG.LANGFUSE_SECRET_KEY}`).toString('base64');
    const baseUrl = CONFIG.LANGFUSE_HOST.replace(/\/$/, '');
    
    const arms = ['on', 'off'];
    for (const arm of arms) {
      console.log(`\nArm: slm_gate=${arm}`);
      try {
        const query = {
          view: "observations",
          groupBy: [],
          metrics: [
            { measure: "count", aggregation: "count" },
            { measure: "totalTokens", aggregation: "sum" },
            { measure: "inputCost", aggregation: "sum" }
          ],
          filters: [
            { column: "tags", operator: "any of", value: [`slm_gate=${arm}`], type: "arrayOptions" }
          ],
          fromTimestamp: "2020-01-01T00:00:00.000Z",
          toTimestamp: "2030-01-01T00:00:00.000Z"
        };

        const url = new URL(`${baseUrl}/api/public/v2/metrics`);
        url.searchParams.append('query', JSON.stringify(query));
        
        const res = await fetch(url.toString(), {
          headers: { 'Authorization': authHeader }
        });

        if (!res.ok) {
          console.error(`Failed to fetch observation metrics for ${arm}: ${res.statusText}`);
          const text = await res.text();
          console.error('Response details:', text);
          continue;
        }

        const data = (await res.json()) as { data: any[] };
        const row = data.data && data.data.length > 0 ? data.data[0] : null;

        if (row) {
          console.log(`  Cost (USD): ${row.inputCost ?? 0}`);
          console.log(`  Total Tokens: ${row.totalTokens ?? 0}`);
          console.log(`  Count: ${row.count ?? 0}`);
        } else {
          console.log('  No observations data found for this arm.');
        }

        // Fetch score metrics separately
        const scoreQuery = {
          view: "scores-numeric",
          groupBy: [],
          metrics: [
            { measure: "value", aggregation: "avg" }
          ],
          filters: [
            { column: "tags", operator: "any of", value: [`slm_gate=${arm}`], type: "arrayOptions" },
            { column: "name", operator: "=", value: "task_pass", type: "string" }
          ],
          fromTimestamp: "2020-01-01T00:00:00.000Z",
          toTimestamp: "2030-01-01T00:00:00.000Z"
        };
        const scoreUrl = new URL(`${baseUrl}/api/public/v2/metrics`);
        scoreUrl.searchParams.append('query', JSON.stringify(scoreQuery));

        const scoreRes = await fetch(scoreUrl.toString(), {
          headers: { 'Authorization': authHeader }
        });

        if (scoreRes.ok) {
          const scoreData = (await scoreRes.json()) as { data: any[] };
          const sRow = scoreData.data && scoreData.data.length > 0 ? scoreData.data[0] : null;
          console.log(`  Avg Quality (task_pass): ${sRow && sRow.value ? sRow.value.toFixed(2) : 'N/A'}`);
        }
        
      } catch (err) {
        console.error(`Failed to fetch metrics for arm slm_gate=${arm}:`, err);
      }
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
