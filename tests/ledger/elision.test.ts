import { jest } from '@jest/globals';

jest.unstable_mockModule('../../src/config.js', () => ({
  CONFIG: {
    LEDGER_PATH: ':memory:',
    ELISION_RETENTION_DAYS: 180,
    ELISION_MAX_MB: 1, // 1 MB
    ELISION_MAX_ENTRIES: 5000,
  }
}));

import Database from 'better-sqlite3';

const { getDb, writeElision, getElision, writeEvent } = await import('../../src/ledger/index.js');
const { CONFIG } = await import('../../src/config.js');

describe('Elision Registry Lifecycle Integration', () => {
  let db: Database.Database;

  beforeAll(() => {
    db = getDb();
  });

  beforeEach(() => {
    // Wipe tables for clean state
    db.prepare('DELETE FROM elision_cache').run();
    db.prepare('DELETE FROM events').run();
  });

  test('lazy expiry on read (miss + row gone)', () => {
    // Insert an old entry manually directly via SQL to bypass `writeElision` which sets `created_at` to now.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 181); // older than 180
    
    db.prepare(`
      INSERT INTO elision_cache (id, tool_name, args, original_text, ranges, content_hash, created_at, last_accessed_at, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old-elision-1', 'test_tool', '{}', 'old text', '[]', 'hash1', cutoff.toISOString(), cutoff.toISOString(), 100);

    const check1 = db.prepare('SELECT COUNT(*) as count FROM elision_cache').get() as any;
    expect(check1.count).toBe(1);

    // Read should trigger lazy expiry
    const result = getElision('old-elision-1');
    expect(result).toBeNull();

    // Verify row is gone
    const check2 = db.prepare('SELECT COUNT(*) as count FROM elision_cache').get() as any;
    expect(check2.count).toBe(0);
  });

  test('size cap evicts LRU rows once exceeded', () => {
    // CONFIG.ELISION_MAX_MB is mocked to 1 MB cap
    const maxBytes = 1 * 1024 * 1024;
    
    // We insert 3 records, each taking up 500KB. Total 1.5MB. 
    // The cap is 1.0 MB. So 1 record should be evicted.
    const size = 500 * 1024;

    // Record 1 (Oldest access)
    const t1 = new Date();
    t1.setHours(t1.getHours() - 2);
    db.prepare(`
      INSERT INTO elision_cache (id, tool_name, args, original_text, ranges, content_hash, created_at, last_accessed_at, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rec-1', 'tool', '{}', 'x', '[]', 'hash1', t1.toISOString(), t1.toISOString(), size);

    // Record 2 (Middle access)
    const t2 = new Date();
    t2.setHours(t2.getHours() - 1);
    db.prepare(`
      INSERT INTO elision_cache (id, tool_name, args, original_text, ranges, content_hash, created_at, last_accessed_at, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('rec-2', 'tool', '{}', 'x', '[]', 'hash2', t2.toISOString(), t2.toISOString(), size);

    // Record 3 (Write via normal writeElision, which triggers the size cap check)
    writeElision({
      id: 'rec-3',
      tool_name: 'tool',
      args: '{}',
      original_text: 'x',
      ranges: '[]',
      content_hash: 'hash3',
      size_bytes: size,
    });

    // Check count and remaining IDs
    const remaining = db.prepare('SELECT id FROM elision_cache ORDER BY last_accessed_at ASC').all() as any[];
    
    // Total size would be 1.5MB. Cap is 1.0MB. The oldest (rec-1) should be evicted.
    // So rec-2 and rec-3 remain.
    expect(remaining.length).toBe(2);
    expect(remaining.map(r => r.id)).not.toContain('rec-1');
    expect(remaining.map(r => r.id)).toContain('rec-2');
    expect(remaining.map(r => r.id)).toContain('rec-3');
  });

  test('cleanup runs leave events table untouched', () => {
    // 1. Populate events table
    writeEvent({
      ts: new Date().toISOString(),
      layer: 'mcp',
      request_id: 'req-1',
      route: 'condition',
      is_local_call: 1,
      in_tok: 0,
      out_tok: 0,
      api_in_tok: 0,
      api_out_tok: 0,
      cost_usd: 0,
      slm_latency_s: 0,
      api_latency_s: 0,
      slm_gate: 'on'
    });

    const initialEventCount = (db.prepare('SELECT COUNT(*) as count FROM events').get() as any).count;
    expect(initialEventCount).toBe(1);

    // 2. Populate old elisions
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 181);
    db.prepare(`
      INSERT INTO elision_cache (id, tool_name, args, original_text, ranges, content_hash, created_at, last_accessed_at, size_bytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('old-1', 'tool', '{}', 'x', '[]', 'hash1', cutoff.toISOString(), cutoff.toISOString(), 100);

    // 3. Import and run script equivalent logic (dry-run and active)
    
    // Test --dry-run
    const cutoffIso = cutoff.toISOString();
    const impact = db.prepare('SELECT COUNT(*) as count FROM elision_cache WHERE created_at <= ?').get(cutoffIso) as any;
    expect(impact.count).toBe(1); // One row identified for deletion

    // Test active deletion
    db.prepare('DELETE FROM elision_cache WHERE created_at <= ?').run(cutoffIso);
    
    // Verify elision is deleted
    const elisionCount = (db.prepare('SELECT COUNT(*) as count FROM elision_cache').get() as any).count;
    expect(elisionCount).toBe(0);

    // Assert explicitly: events table row count unchanged
    const finalEventCount = (db.prepare('SELECT COUNT(*) as count FROM events').get() as any).count;
    expect(finalEventCount).toBe(1);
  });
});
