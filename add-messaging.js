const db = require('./db');

async function addMessaging() {
  try {
    await db.query('SELECT 1');
    console.log('[Database] Connected to PostgreSQL');

    // Create conversations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id SERIAL PRIMARY KEY,
        participant1_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        participant2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(participant1_id, participant2_id),
        CHECK (participant1_id < participant2_id)
      );
    `);
    console.log('✓ Conversations table created');

    // Create messages table
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✓ Messages table created');

    // Create indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_participant1 ON conversations(participant1_id);
      CREATE INDEX IF NOT EXISTS idx_conversations_participant2 ON conversations(participant2_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    `);
    console.log('✓ Indexes created');

    console.log('\n✅ Direct messaging tables created successfully');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

addMessaging();
