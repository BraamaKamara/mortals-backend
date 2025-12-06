const db = require('./db');

async function addModeration() {
  try {
    await db.query('SELECT 1');
    console.log('[Database] Connected to PostgreSQL');

    // Add admin column to users table
    await db.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
    `);
    console.log('✓ Admin column added to users');

    // Create reports table
    await db.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        reporter_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reported_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reported_post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        resolved_at TIMESTAMP,
        CHECK (reported_user_id IS NOT NULL OR reported_post_id IS NOT NULL)
      );
    `);
    console.log('✓ Reports table created');

    // Create blocks table (user blocking)
    await db.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        blocked_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (blocker_id, blocked_id),
        CHECK (blocker_id != blocked_id)
      );
    `);
    console.log('✓ Blocks table created');

    // Create hidden_posts table
    await db.query(`
      CREATE TABLE IF NOT EXISTS hidden_posts (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, post_id)
      );
    `);
    console.log('✓ Hidden posts table created');

    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id);
      CREATE INDEX IF NOT EXISTS idx_reports_reported_user ON reports(reported_user_id);
      CREATE INDEX IF NOT EXISTS idx_reports_reported_post ON reports(reported_post_id);
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
      CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON blocks(blocker_id);
      CREATE INDEX IF NOT EXISTS idx_blocks_blocked ON blocks(blocked_id);
      CREATE INDEX IF NOT EXISTS idx_hidden_posts_user ON hidden_posts(user_id);
    `);
    console.log('✓ Indexes created');

    console.log('\n✅ Moderation tables created successfully');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addModeration();
