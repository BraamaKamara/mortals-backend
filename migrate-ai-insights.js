// Migration for AI Insights caching table
const db = require('./db');

const migrationSQL = `
CREATE TABLE IF NOT EXISTS ai_insights (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope VARCHAR(50) NOT NULL DEFAULT 'weekly',
  summary_json JSONB NOT NULL,
  model VARCHAR(100),
  tokens_used INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ai_insights_user ON ai_insights(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_scope ON ai_insights(scope);
CREATE INDEX IF NOT EXISTS idx_ai_insights_created ON ai_insights(created_at DESC);
`;

async function runMigration() {
  console.log('[Migration] Starting AI Insights migration...');
  try {
    await db.query(migrationSQL);
    console.log('[Migration] ✓ ai_insights table created');

    const tables = await db.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'ai_insights';
    `);

    if (tables.rows.length === 1) {
      console.log('[Migration] ✓ Verified ai_insights exists');
    } else {
      console.warn('[Migration] ⚠️ ai_insights table not found after migration');
    }

    process.exit(0);
  } catch (error) {
    console.error('[Migration] Failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
