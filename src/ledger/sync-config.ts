/**
 * @fileoverview Utility script to synchronize local Evaluator and Monitor configurations
 * with a remote Langfuse project. It reads JSON definitions from the harness directory
 * and upserts them into the Langfuse instance using the Langfuse Management API.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config.js';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Synchronizes evaluator and monitor definitions with the Langfuse API.
 * Reads definitions from `harness/evaluators.json` and `harness/monitors.json`
 * and sends POST requests to the respective Langfuse API endpoints.
 * 
 * @async
 * @returns {Promise<void>} Resolves when all synchronizations are complete. Exits the process on critical errors.
 */
async function syncConfig(): Promise<void> {
  // Validate that all required Langfuse configuration variables are present
  if (!CONFIG.LANGFUSE_PUBLIC_KEY || !CONFIG.LANGFUSE_SECRET_KEY || !CONFIG.LANGFUSE_HOST) {
    console.error('LANGFUSE keys or host not configured. Skipping sync.');
    process.exit(1);
  }

  // Construct the Basic Authentication header required by the Langfuse API
  const authHeader = 'Basic ' + Buffer.from(`${CONFIG.LANGFUSE_PUBLIC_KEY}:${CONFIG.LANGFUSE_SECRET_KEY}`).toString('base64');
  
  // Ensure the base URL does not have a trailing slash for consistent route construction
  const baseUrl = CONFIG.LANGFUSE_HOST.replace(/\/$/, '');

  console.log('Syncing Langfuse Evaluators and Monitors...');

  try {
    // -------------------------------------------------------------------------
    // Sync Evaluators
    // -------------------------------------------------------------------------
    const evaluatorsPath = path.resolve(__dirname, '../../harness/evaluators.json');
    if (fs.existsSync(evaluatorsPath)) {
      // Parse the evaluators configuration file
      const evaluators = JSON.parse(fs.readFileSync(evaluatorsPath, 'utf-8')) as Record<string, unknown>[];
      console.log(`Found ${evaluators.length} evaluators to sync.`);
      
      for (const ev of evaluators) {
        console.log(`- Upserting evaluator: ${ev.name}`);
        
        // This makes a best-effort POST to the Langfuse API. 
        // If the management API for evaluators is unsupported, it logs the error but continues.
        const res = await fetch(`${baseUrl}/api/public/v1/evaluators`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(ev)
        });
        
        // Non-2xx responses (other than 404) are treated as failures, but we continue processing the rest
        if (!res.ok && res.status !== 404) {
          console.error(`  Failed to sync evaluator ${ev.name}: ${res.statusText}`);
        }
      }
    }

    // -------------------------------------------------------------------------
    // Sync Monitors
    // -------------------------------------------------------------------------
    const monitorsPath = path.resolve(__dirname, '../../harness/monitors.json');
    if (fs.existsSync(monitorsPath)) {
      // Parse the monitors configuration file
      const monitors = JSON.parse(fs.readFileSync(monitorsPath, 'utf-8')) as Record<string, unknown>[];
      console.log(`Found ${monitors.length} monitors to sync.`);
      
      for (const mon of monitors) {
        console.log(`- Upserting monitor: ${mon.name}`);
        
        // Push the monitor configuration to Langfuse
        const res = await fetch(`${baseUrl}/api/public/v1/monitors`, {
          method: 'POST',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(mon)
        });
        
        // Similar to evaluators, log failures without aborting the entire sync process
        if (!res.ok && res.status !== 404) {
          console.error(`  Failed to sync monitor ${mon.name}: ${res.statusText}`);
        }
      }
    }

    console.log('Sync complete.');
  } catch (err) {
    // Catch-all for unexpected errors (e.g., file read errors, network failure)
    console.error('Failed to sync config:', err);
    process.exit(1);
  }
}

// Execute the synchronization script
syncConfig();
