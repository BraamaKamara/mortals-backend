// Verify migration results
const db = require('./db');

async function verify() {
  console.log('\n=== Verifying Subscription Migration ===\n');
  
  try {
    // Check migrated subscriptions
    const result = await db.query(`
      SELECT 
        u.id, u.email, u.username,
        s.plan, s.status, s.stripe_customer_id, s.stripe_subscription_id
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      WHERE u.email IN ('braamakamara@gmail.com', 'ibrahimkamara930@gmail.com')
      ORDER BY u.email
    `);
    
    console.log('Found', result.rows.length, 'users:\n');
    
    result.rows.forEach(row => {
      console.log(`📧 Email: ${row.email}`);
      console.log(`   User ID: ${row.id}`);
      console.log(`   Username: ${row.username}`);
      console.log(`   Plan: ${row.plan || 'No subscription'}`);
      console.log(`   Status: ${row.status || 'N/A'}`);
      console.log(`   Stripe Customer: ${row.stripe_customer_id || 'N/A'}`);
      console.log(`   Stripe Subscription: ${row.stripe_subscription_id || 'N/A'}`);
      console.log('');
    });
    
    console.log('✅ Migration verification complete!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

verify();
