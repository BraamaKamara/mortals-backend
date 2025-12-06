const db = require('./db');

async function addBookmarks() {
  try {
    await db.query('SELECT 1');
    console.log('[Database] Connected to PostgreSQL');

    // Create bookmarks table
    await db.query(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (user_id, post_id)
      );
    `);
    console.log('✓ Bookmarks table created');

    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_post ON bookmarks(post_id);
      CREATE INDEX IF NOT EXISTS idx_bookmarks_created_at ON bookmarks(created_at);
    `);
    console.log('✓ Indexes created');

    console.log('\n✅ Bookmarks table created successfully');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addBookmarks();
