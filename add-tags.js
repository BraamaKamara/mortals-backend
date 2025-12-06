const db = require('./db');

async function addTagsSupport() {
  console.log('[Database] Adding tags support...');

  try {
    await db.query('SELECT 1');
    console.log('[Database] Connected to PostgreSQL');

    // Create tags table
    await db.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create post_tags junction table
    await db.query(`
      CREATE TABLE IF NOT EXISTS post_tags (
        post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (post_id, tag_id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_post_tags_post ON post_tags(post_id);
      CREATE INDEX IF NOT EXISTS idx_post_tags_tag ON post_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name);
    `);

    // Insert default tags
    const defaultTags = [
      'philosophy',
      'reflection',
      'gratitude',
      'wisdom',
      'mortality',
      'meaning',
      'growth',
      'mindfulness',
      'stoicism',
      'existentialism',
      'ethics',
      'happiness',
      'courage',
      'virtue',
      'purpose'
    ];

    for (const tag of defaultTags) {
      await db.query(`
        INSERT INTO tags (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
      `, [tag]);
    }

    console.log('[Database] ✓ Tags tables created successfully');
    console.log(`[Database] ✓ Added ${defaultTags.length} default tags`);
    
    process.exit(0);
  } catch (error) {
    console.error('[Database] Error:', error);
    process.exit(1);
  }
}

addTagsSupport();
