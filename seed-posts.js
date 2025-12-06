// Seed the database with initial philosophical posts
const db = require('./db');

const SEED_POSTS = [
  {
    title: "The Paradox of Mortality Awareness",
    content: "Being conscious of death gives life meaning, yet we spend most of our time avoiding this awareness. How do we strike a balance between memento mori and living fully in the present?",
    category: "mortality",
    username: "philosopher_king"
  },
  {
    title: "Digital Immortality vs. Authentic Living",
    content: "We curate our online presence to outlive us, creating digital monuments. But are these reflections of our true selves, or carefully constructed facades? What will future generations learn about who we really were?",
    category: "legacy",
    username: "digital_sage"
  },
  {
    title: "The Ethics of Life Extension",
    content: "If we could extend life indefinitely, should we? Would immortality rob life of its urgency and meaning? Or is accepting death just making peace with an avoidable tragedy?",
    category: "philosophy",
    username: "time_traveler"
  },
  {
    title: "Gratitude in the Face of Impermanence",
    content: "Everything we love is temporary. Does this make appreciation more profound or more painful? I find that knowing something won't last makes me cherish it more deeply.",
    category: "gratitude",
    username: "mindful_mortal"
  },
  {
    title: "What Would You Tell Your Younger Self?",
    content: "If you could send one message back in time to yourself at 20, knowing what you know now about life's brevity, what would it be? For me: 'Stop waiting for the perfect moment. This IS it.'",
    category: "reflection",
    username: "wise_elder"
  }
];

async function seedPosts() {
  console.log('[Seed] Starting to seed Eternal Board posts...\n');

  try {
    // Get or create seed users
    for (const post of SEED_POSTS) {
      let userId;

      // Check if user exists
      const userResult = await db.query(
        'SELECT id FROM users WHERE username = $1',
        [post.username]
      );

      if (userResult.rows.length > 0) {
        userId = userResult.rows[0].id;
        console.log(`[Seed] User ${post.username} already exists (ID: ${userId})`);
      } else {
        // Create user
        const newUser = await db.query(
          `INSERT INTO users (email, username, password_hash, email_verified)
           VALUES ($1, $2, $3, TRUE)
           RETURNING id`,
          [`${post.username}@mortals.app`, post.username, 'SEED_USER_NO_PASSWORD']
        );
        userId = newUser.rows[0].id;
        console.log(`[Seed] Created user ${post.username} (ID: ${userId})`);
      }

      // Check if post already exists (by content)
      const postCheck = await db.query(
        'SELECT id FROM posts WHERE content = $1',
        [post.content]
      );

      if (postCheck.rows.length > 0) {
        console.log(`[Seed] Post "${post.title}" already exists, skipping\n`);
        continue;
      }

      // Create post
      const result = await db.query(
        `INSERT INTO posts (user_id, content, philosopher)
         VALUES ($1, $2, $3)
         RETURNING id, content`,
        [userId, post.content, post.username]
      );

      console.log(`[Seed] ✓ Created post: "${post.title}" (ID: ${result.rows[0].id})\n`);
    }

    console.log('[Seed] ✅ Seeding complete!');
    process.exit(0);
  } catch (error) {
    console.error('[Seed] ❌ Error seeding posts:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedPosts();
}

module.exports = { seedPosts };
