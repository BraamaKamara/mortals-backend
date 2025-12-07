// Database migration for Reflection Suite (Phase 2)
// Adds tables for presence_index, continuity_tracker, ethical_nudges, ethical_reflections
const db = require('./db');

const migrationSQL = `
-- Presence Index table
CREATE TABLE IF NOT EXISTS presence_index (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  breakdown JSONB DEFAULT '{
    "reflection": 0,
    "gratitude": 0,
    "relationships": 0,
    "deep_work": 0,
    "sleep": 0
  }',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_presence_index_user ON presence_index(user_id);
CREATE INDEX IF NOT EXISTS idx_presence_index_date ON presence_index(date DESC);
CREATE INDEX IF NOT EXISTS idx_presence_index_user_date ON presence_index(user_id, date DESC);

-- Continuity Tracker table
CREATE TABLE IF NOT EXISTS continuity_tracker (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  is_intentional BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_continuity_tracker_user ON continuity_tracker(user_id);
CREATE INDEX IF NOT EXISTS idx_continuity_tracker_date ON continuity_tracker(date DESC);
CREATE INDEX IF NOT EXISTS idx_continuity_tracker_intentional ON continuity_tracker(is_intentional);

-- Ethical Nudges table
CREATE TABLE IF NOT EXISTS ethical_nudges (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nudge_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'warning',
  color VARCHAR(20) DEFAULT 'slate',
  acknowledged BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ethical_nudges_user ON ethical_nudges(user_id);
CREATE INDEX IF NOT EXISTS idx_ethical_nudges_type ON ethical_nudges(nudge_type);
CREATE INDEX IF NOT EXISTS idx_ethical_nudges_acknowledged ON ethical_nudges(acknowledged);

-- Ethical Reflections table
CREATE TABLE IF NOT EXISTS ethical_reflections (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id VARCHAR(100) NOT NULL,
  prompt_category VARCHAR(100) NOT NULL,
  question TEXT NOT NULL,
  user_response TEXT NOT NULL,
  ai_insight TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ethical_reflections_user ON ethical_reflections(user_id);
CREATE INDEX IF NOT EXISTS idx_ethical_reflections_prompt ON ethical_reflections(prompt_id);
CREATE INDEX IF NOT EXISTS idx_ethical_reflections_created ON ethical_reflections(created_at DESC);

-- Moral Presence Log table (for real-time consciousness tracking)
CREATE TABLE IF NOT EXISTS moral_presence_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  presence_score INTEGER NOT NULL CHECK (presence_score >= 0 AND presence_score <= 100),
  contributors JSONB DEFAULT '{
    "reflection": 0,
    "gratitude": 0,
    "relationships": 0,
    "mirror_mode": 0,
    "lost_time": 0
  }',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moral_presence_user ON moral_presence_log(user_id);
CREATE INDEX IF NOT EXISTS idx_moral_presence_timestamp ON moral_presence_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_moral_presence_user_timestamp ON moral_presence_log(user_id, timestamp DESC);
`;

async function runMigration() {
  console.log('[Migration] Starting Reflection Suite Phase 2 migration...');
  
  try {
    await db.query(migrationSQL);
    console.log('[Migration] ✓ All Reflection Suite tables created successfully');
    
    // Verify new tables
    const tables = await db.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('presence_index', 'continuity_tracker', 'ethical_nudges', 'ethical_reflections', 'moral_presence_log')
      ORDER BY table_name;
    `);
    
    console.log('[Migration] ✓ New tables:');
    tables.rows.forEach(row => {
      console.log(`  - ${row.table_name}`);
    });
    
    console.log('[Migration] ✓ Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('[Migration] Failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runMigration();
}

module.exports = { runMigration };
