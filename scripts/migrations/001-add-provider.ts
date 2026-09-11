import Database from 'better-sqlite3';
import { CONFIG } from '../../src/config.js'; // match repo's import style/extension

const dfltArg = process.argv.find(a => a.startsWith('--default='));
const dflt = dfltArg ? dfltArg.split('=')[1] : null;
const valid = ['gemini','claude','chatgpt'];
if (dflt && !valid.includes(dflt)) { console.error(`--default must be one of ${valid.join(', ')}`); process.exit(1); }

const db = new Database(CONFIG.LEDGER_PATH);
const hasCol = (db.prepare("PRAGMA table_info(events)").all() as any[]).some(c => c.name === 'provider');
if (!hasCol) { db.exec("ALTER TABLE events ADD COLUMN provider TEXT"); console.log("Added events.provider."); }
else { console.log("events.provider already present."); }

const hasAgentCol = (db.prepare("PRAGMA table_info(events)").all() as any[]).some(c => c.name === 'agent');
if (!hasAgentCol) { db.exec("ALTER TABLE events ADD COLUMN agent TEXT"); console.log("Added events.agent."); }
else { console.log("events.agent already present."); }

const res = db.prepare(`
  UPDATE events SET provider = CASE
    WHEN lower(coalesce(api_model,'')) LIKE '%claude%' OR lower(coalesce(api_model,'')) LIKE '%sonnet%'
      OR lower(coalesce(api_model,'')) LIKE '%opus%' OR lower(coalesce(api_model,'')) LIKE '%haiku%'
      OR lower(coalesce(api_model,'')) LIKE '%anthropic%' THEN 'claude'
    WHEN lower(coalesce(api_model,'')) LIKE '%gemini%' OR lower(coalesce(api_model,'')) LIKE '%gemma%'
      OR lower(coalesce(api_model,'')) LIKE '%bison%' THEN 'gemini'
    WHEN lower(coalesce(api_model,'')) LIKE '%gpt%' OR lower(coalesce(api_model,'')) LIKE '%openai%'
      OR lower(coalesce(api_model,'')) LIKE 'o1%' OR lower(coalesce(api_model,'')) LIKE 'o3%'
      OR lower(coalesce(api_model,'')) LIKE 'o4%' THEN 'chatgpt'
    ELSE provider END
  WHERE provider IS NULL`).run();
console.log(`Backfilled ${res.changes} rows from api_model.`);

if (dflt) {
  const d = db.prepare("UPDATE events SET provider = ? WHERE provider IS NULL").run(dflt);
  console.log(`Applied --default=${dflt} to ${d.changes} unattributed rows.`);
}
console.log("Counts:", db.prepare("SELECT coalesce(provider,'(null)') p, count(*) c FROM events GROUP BY provider").all());
db.close();
