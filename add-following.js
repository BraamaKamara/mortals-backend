const db = require('./db');

async function addFollowingSystem() {
  console.log('[Database] Adding following system...');

  try {
    await db.query('SELECT 1');
    console.log('[Database] Connected to PostgreSQL');

    // Create follows table
    await db.query(`
      CREATE TABLE IF NOT EXISTS follows (
        follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (follower_id, following_id),
        CHECK (follower_id != following_id)
      )
    `);

    // Create indexes for efficient queries
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
      CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);
    `);

    console.log('[Database] ✓ Following system tables created successfully');
    
    process.exit(0);
  } catch (error) {
    console.error('[Database] Error:', error);
    process.exit(1);
  }
}

addFollowingSystem();
