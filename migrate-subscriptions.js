// Migrate existing Stripe subscriptions from JSON to database
const db = require('./db');
const fs = require('fs');
const path = require('path');

async function migrateSubscriptions() {
  console.log('[Migration] Starting Stripe subscriptions migration...');
  
  try {
    // Read entitlements.json
    const jsonPath = path.join(__dirname, 'entitlements.json');
    if (!fs.existsSync(jsonPath)) {
      console.log('[Migration] No entitlements.json found - nothing to migrate');
      return;
    }

    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const entries = Object.entries(data.byEmail || {});

    if (entries.length === 0) {
      console.log('[Migration] No subscriptions to migrate');
      return;
    }

    console.log(`[Migration] Found ${entries.length} subscriptions to migrate`);

    for (const [email, sub] of entries) {
      console.log(`[Migration] Processing ${email}...`);

      // Check if user exists
      const userResult = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      
      if (userResult.rows.length === 0) {
        console.log(`[Migration] ⚠️  User ${email} not found - creating user record`);
        
        // Create user with placeholder password (they'll need to reset or we can handle this differently)
        const newUser = await db.query(
          `INSERT INTO users (email, username, password_hash, stripe_customer_id, email_verified) 
           VALUES ($1, $2, $3, $4, TRUE) 
           RETURNING id`,
          [email.toLowerCase(), email.split('@')[0], 'MIGRATED_USER_NEEDS_PASSWORD_RESET', sub.customerId]
        );
        
        const userId = newUser.rows[0].id;
        console.log(`[Migration] ✓ Created user ${userId} for ${email}`);
        
        // Create subscription
        await db.query(
          `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status) 
           VALUES ($1, $2, $3, $4, $5)`,
          [userId, sub.customerId, sub.subscriptionId, sub.plan, sub.status]
        );
        
        console.log(`[Migration] ✓ Created subscription for ${email}`);
      } else {
        const userId = userResult.rows[0].id;
        console.log(`[Migration] ✓ User ${userId} exists for ${email}`);
        
        // Update user's stripe_customer_id
        await db.query(
          'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
          [sub.customerId, userId]
        );
        
        // Check if subscription exists
        const subResult = await db.query(
          'SELECT id FROM subscriptions WHERE user_id = $1',
          [userId]
        );
        
        if (subResult.rows.length > 0) {
          // Update existing
          await db.query(
            `UPDATE subscriptions 
             SET stripe_customer_id = $1, stripe_subscription_id = $2, plan = $3, status = $4, updated_at = NOW()
             WHERE user_id = $5`,
            [sub.customerId, sub.subscriptionId, sub.plan, sub.status, userId]
          );
          console.log(`[Migration] ✓ Updated subscription for ${email}`);
        } else {
          // Create new
          await db.query(
            `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status) 
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, sub.customerId, sub.subscriptionId, sub.plan, sub.status]
          );
          console.log(`[Migration] ✓ Created subscription for ${email}`);
        }
      }
    }

    console.log('[Migration] ✅ Migration complete!');
    console.log('[Migration] You can now safely delete entitlements.json');
    
  } catch (error) {
    console.error('[Migration] ❌ Migration failed:', error.message);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  migrateSubscriptions()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { migrateSubscriptions };
