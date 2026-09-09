/**
 * @fileoverview Utility script to setup a dedicated Custom Dashboard in Langfuse 
 * with tailored widgets to properly visualize SLM Gate categorical and numeric scores.
 */
import { CONFIG, requireKeys } from '../config.js';

async function setupDashboard(): Promise<void> {
  requireKeys(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'LANGFUSE_HOST']);

  const baseUrl = CONFIG.LANGFUSE_HOST!.replace(/\/$/, '');
  const auth = `Basic ${Buffer.from(`${CONFIG.LANGFUSE_PUBLIC_KEY}:${CONFIG.LANGFUSE_SECRET_KEY}`).toString('base64')}`;
  const headers = { Authorization: auth, 'Content-Type': 'application/json' };

  console.log('=== SLM Gate: Langfuse Dashboard Setup ===\n');
  console.log('\nIMPORTANT: setup-dashboard.ts POSTs NEW widgets each run and dedupes only the dashboard by name.');
  console.log('BEFORE re-running this script, the operator MUST delete the old avg-based cycle widgets (and any duplicate placements) in the Langfuse UI to avoid visual duplication!\n');
  
  // 1. Create Widgets
  console.log('Creating widgets...');
  
  const widgets = [
    {
      name: 'Routing Decision',
      description: 'Whether the SLM resolved the prompt ($0) or escalated it',
      view: 'scores-categorical',
      chartType: 'PIE',
      metrics: [{ measure: 'count', agg: 'count' }],
      dimensions: [{ field: 'stringValue' }],
      filters: [{ type: 'string', column: 'name', operator: '=', value: 'verified' }],
    },
    {
      name: 'Tokens Saved',
      description: 'Total cloud tokens saved by local SLM deferral',
      view: 'scores-numeric',
      chartType: 'NUMBER',
      metrics: [{ measure: 'value', agg: 'sum' }],
      dimensions: [],
      filters: [{ type: 'string', column: 'name', operator: '=', value: 'tokens_saved' }],
    },
    {
      name: 'Cost Saved (Cents)',
      description: 'Estimated cloud API dollars avoided (in Cents)',
      view: 'scores-numeric',
      chartType: 'NUMBER',
      metrics: [{ measure: 'value', agg: 'sum' }],
      dimensions: [],
      filters: [{ type: 'string', column: 'name', operator: '=', value: 'cost_saved_cents' }],
    },
    {
      name: 'SLM Accuracy Rate (%)',
      description: 'Accuracy of SLM output compared to cloud model baseline (0-100%)',
      view: 'scores-numeric',
      chartType: 'NUMBER',
      metrics: [{ measure: 'value', agg: 'avg' }],
      dimensions: [],
      filters: [{ type: 'string', column: 'name', operator: '=', value: 'accuracy_rate_pct' }],
    },
    {
      name: 'Claude Cycle Extended (min)',
      description: 'Extra minutes of a 5h Claude window from SLM savings',
      view: 'scores-numeric',
      chartType: 'NUMBER',
      metrics: [{ measure: 'value', agg: 'sum' }],
      dimensions: [],
      filters: [{ type: 'string', column: 'name', operator: '=', value: 'cycle_minutes_saved_claude' }],
    },
    {
      name: 'ChatGPT Cycle Extended (min)',
      description: 'Extra minutes of a 3h ChatGPT window from SLM savings',
      view: 'scores-numeric',
      chartType: 'NUMBER',
      metrics: [{ measure: 'value', agg: 'sum' }],
      dimensions: [],
      filters: [{ type: 'string', column: 'name', operator: '=', value: 'cycle_minutes_saved_chatgpt' }],
    },
    {
      name: 'Gemini Cycle Extended (min)',
      description: 'Extra minutes of a 5h Gemini window from SLM savings',
      view: 'scores-numeric',
      chartType: 'NUMBER',
      metrics: [{ measure: 'value', agg: 'sum' }],
      dimensions: [],
      filters: [{ type: 'string', column: 'name', operator: '=', value: 'cycle_minutes_saved_gemini' }],
    }
  ];

  const createdWidgets = [];
  for (const w of widgets) {
    const res = await fetch(`${baseUrl}/api/public/unstable/dashboard-widgets`, {
      method: 'POST',
      headers,
      body: JSON.stringify(w),
    });
    if (!res.ok) {
      console.warn(`⚠ Failed to create widget '${w.name}': ${await res.text()}`);
    } else {
      const data = await res.json();
      console.log(`✓ Created widget: ${w.name}`);
      createdWidgets.push(data);
    }
  }

  // 2. Create Dashboard
  console.log('\nCreating SLM Gate Dashboard...');
  let dashboard;
  const listRes = await fetch(`${baseUrl}/api/public/unstable/dashboards`, { headers });
  if (listRes.ok) {
    const listData = await listRes.json();
    const existing = (listData.data || listData).find((d: any) => d.name === 'SLM Gate Performance');
    if (existing) {
      dashboard = existing;
      console.log(`✓ Found existing dashboard: ${dashboard.name} (ID: ${dashboard.id})`);
    }
  }

  if (!dashboard) {
    const dashboardRes = await fetch(`${baseUrl}/api/public/unstable/dashboards`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'SLM Gate Performance',
        description: 'Comprehensive metrics tracking local SLM deferral rates, token savings, and quality.',
      }),
    });

    if (!dashboardRes.ok) {
      console.error(`Failed to create dashboard: ${await dashboardRes.text()}`);
      return;
    }
    
    dashboard = await dashboardRes.json();
    console.log(`✓ Created NEW dashboard: ${dashboard.name} (ID: ${dashboard.id})`);
    console.log(`\nNOTE: A NEW dashboard was created. If you already had an "SLM Gate Performance" dashboard, you may want to delete the old one in Langfuse to avoid duplicates.`);
  }

  // 3. Attach Widgets to Dashboard
  console.log('\nPlacing widgets on dashboard...');
  
  // Arrange them in a 2x2 grid
  // Standard grid is usually 12 cols wide, x:0-12, y: row
  const placements = [
    { type: 'widget', widgetId: createdWidgets[0].id },
    { type: 'widget', widgetId: createdWidgets[1].id },
    { type: 'widget', widgetId: createdWidgets[2].id },
    { type: 'widget', widgetId: createdWidgets[3].id },
    { type: 'widget', widgetId: createdWidgets[4].id },
    { type: 'widget', widgetId: createdWidgets[5].id },
    { type: 'widget', widgetId: createdWidgets[6].id },
  ];

  for (const [i, p] of placements.entries()) {
    if (!p.widgetId) continue;
    const res = await fetch(`${baseUrl}/api/public/unstable/dashboards/${dashboard.id}/placements`, {
      method: 'POST',
      headers,
      body: JSON.stringify(p),
    });
    if (res.ok) {
      console.log(`✓ Placed widget: ${widgets[i].name}`);
    } else {
      console.warn(`⚠ Failed to place widget '${widgets[i].name}': ${await res.text()}`);
    }
  }

  console.log(`\n🎉 Dashboard created successfully!`);
  const projectId = dashboard.projectId;
  if (projectId) {
    console.log(`👉 View it at: ${baseUrl}/project/${projectId}/dashboards/${dashboard.id}`);
  } else {
    console.log(`👉 To view it, open Langfuse and click "Dashboards" in the left sidebar.`);
  }
}

setupDashboard().catch((err) => {
  console.error('Fatal error setting up dashboard:', err);
  process.exit(1);
});
