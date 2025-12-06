// Add reactions table to database
const db = require('./db');

const addReactionsTable = `
-- Reactions table for posts
CREATE TABLE IF NOT EXISTS reactions (
  id SERIAL PRIMARY KEY,
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  reaction_type VARCHAR(20) NOT NULL, -- 'like', 'love', 'inspire', 'reflect', 'wisdom'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(post_id, user_id, reaction_type)
);

CREATE INDEX IF NOT EXISTS idx_reactions_post ON reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL, -- 'comment', 'reaction', 'mention'
  post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
  comment_id INTEGER REFERENCES comments(id) ON DELETE CASCADE,
  message TEXT,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
`;

async function addTables() {
  console.log('[Database] Adding reactions and notifications tables...');
  
  try {
    await db.query(addReactionsTable);
    console.log('[Database] ✓ Tables created successfully');
    process.exit(0);
  } catch (error) {
    console.error('[Database] Failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  addTables();
}

module.exports = { addTables };
