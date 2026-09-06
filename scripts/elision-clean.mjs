import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import Database from 'better-sqlite3';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

// Parse .env
config();

// Determine ledger path exactly as config.ts does
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, 'output');
const LEDGER_PATH = process.env.LEDGER_PATH || path.join(OUTPUT_DIR, 'ledger.sqlite');

const db = new Database(LEDGER_PATH);

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');

function getStats() {
  const countRes = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as totalSize, MIN(created_at) as oldest, MAX(created_at) as newest FROM elision_cache').get();
  
  const totalRows = countRes.count || 0;
  const totalMB = ((countRes.totalSize || 0) / (1024 * 1024)).toFixed(2);
  
  console.log(`\n=== Elision Registry Stats ===`);
  console.log(`Total Rows:  ${totalRows}`);
  console.log(`Total Size:  ${totalMB} MB`);
  console.log(`Oldest:      ${countRes.oldest || 'N/A'}`);
  console.log(`Newest:      ${countRes.newest || 'N/A'}`);
  
  if (totalRows === 0) return;

  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  
  const rows = db.prepare('SELECT tool_name, created_at, size_bytes FROM elision_cache').all();
  
  const buckets = {
    '<1mo': { count: 0, bytes: 0 },
    '1-3mo': { count: 0, bytes: 0 },
    '3-6mo': { count: 0, bytes: 0 },
    '>6mo': { count: 0, bytes: 0 },
  };
  
  const tools = {};

  for (const row of rows) {
    const ageDays = (now - new Date(row.created_at).getTime()) / dayMs;
    const size = row.size_bytes || 0;
    
    if (ageDays < 30) { buckets['<1mo'].count++; buckets['<1mo'].bytes += size; }
    else if (ageDays < 90) { buckets['1-3mo'].count++; buckets['1-3mo'].bytes += size; }
    else if (ageDays < 180) { buckets['3-6mo'].count++; buckets['3-6mo'].bytes += size; }
    else { buckets['>6mo'].count++; buckets['>6mo'].bytes += size; }
    
    if (!tools[row.tool_name]) tools[row.tool_name] = { count: 0, bytes: 0 };
    tools[row.tool_name].count++;
    tools[row.tool_name].bytes += size;
  }
  
  console.log(`\n--- Age Breakdown ---`);
  for (const [k, v] of Object.entries(buckets)) {
    console.log(`${k.padEnd(7)} : ${v.count} rows, ${(v.bytes / (1024*1024)).toFixed(2)} MB`);
  }
  
  console.log(`\n--- Tool Breakdown ---`);
  const sortedTools = Object.entries(tools).sort((a, b) => b[1].count - a[1].count);
  for (const [name, v] of sortedTools) {
    console.log(`${name.padEnd(15)} : ${v.count} rows, ${(v.bytes / (1024*1024)).toFixed(2)} MB`);
  }
  
  return { buckets, totalRows, totalMB };
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function run() {
  if (args.includes('--stats')) {
    getStats();
    process.exit(0);
  }

  const olderThanIdx = args.indexOf('--older-than');
  if (olderThanIdx !== -1) {
    const val = args[olderThanIdx + 1];
    const match = val && val.match(/^(\d+)d$/);
    if (!match) {
      console.error("Error: --older-than requires a value like '30d'");
      process.exit(1);
    }
    const days = parseInt(match[1], 10);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    
    const cutoffIso = cutoff.toISOString();
    
    const impact = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as bytes FROM elision_cache WHERE created_at < ?').get(cutoffIso);
    
    if (isDryRun) {
      console.log(`[DRY RUN] Would delete ${impact.count} rows (${((impact.bytes || 0)/(1024*1024)).toFixed(2)} MB) older than ${days} days.`);
      process.exit(0);
    }
    
    db.prepare('DELETE FROM elision_cache WHERE created_at < ?').run(cutoffIso);
    console.log(`Deleted ${impact.count} rows (${((impact.bytes || 0)/(1024*1024)).toFixed(2)} MB) older than ${days} days.`);
    process.exit(0);
  }

  if (args.includes('--all')) {
    const impact = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as bytes FROM elision_cache').get();
    if (isDryRun) {
      console.log(`[DRY RUN] Would delete all ${impact.count} rows (${((impact.bytes || 0)/(1024*1024)).toFixed(2)} MB).`);
      process.exit(0);
    }
    
    const ans = await prompt(`Are you sure you want to delete all ${impact.count} elision records? Type "yes" to confirm: `);
    if (ans === 'yes') {
      db.prepare('DELETE FROM elision_cache').run();
      console.log(`Deleted ${impact.count} rows (${((impact.bytes || 0)/(1024*1024)).toFixed(2)} MB).`);
    } else {
      console.log("Aborted.");
    }
    process.exit(0);
  }

  if (args.includes('--interactive')) {
    getStats();
    console.log("");
    const ans = await prompt("Enter max age to KEEP in days (e.g. 30), or 'abort': ");
    if (ans === 'abort' || !ans) {
      console.log("Aborted.");
      process.exit(0);
    }
    const days = parseInt(ans, 10);
    if (isNaN(days)) {
      console.error("Invalid number.");
      process.exit(1);
    }
    
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString();
    
    const impact = db.prepare('SELECT COUNT(*) as count, SUM(size_bytes) as bytes FROM elision_cache WHERE created_at < ?').get(cutoffIso);
    const confirm = await prompt(`About to delete ${impact.count} rows (${((impact.bytes || 0)/(1024*1024)).toFixed(2)} MB). Proceed? (yes/no): `);
    if (confirm === 'yes') {
      db.prepare('DELETE FROM elision_cache WHERE created_at < ?').run(cutoffIso);
      console.log("Cleanup complete.");
    } else {
      console.log("Aborted.");
    }
    process.exit(0);
  }

  console.log("No valid command provided. Use --stats, --older-than <Nd>, --all, or --interactive. Append --dry-run for testing.");
}

run().catch(console.error);
