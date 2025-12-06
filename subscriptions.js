// Database-backed subscription management
const db = require('./db');

// Create or update subscription after Stripe checkout
async function setFromCheckout({ email, customerId, subscriptionId, status = 'active' }) {
  if (!email || !customerId) {
    console.warn('[Subscriptions] Missing email or customerId');
    return;
  }

  try {
    const emailLower = email.toLowerCase();

    // Find user by email
    const userResult = await db.query('SELECT id FROM users WHERE email = $1', [emailLower]);
    
    if (userResult.rows.length === 0) {
      console.warn(`[Subscriptions] No user found for email: ${emailLower}`);
      // Optionally create the user here if they don't exist yet
      return;
    }

    const userId = userResult.rows[0].id;

    // Check if subscription exists
    const existing = await db.query(
      'SELECT id FROM subscriptions WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      // Update existing subscription
      await db.query(
        `UPDATE subscriptions 
         SET stripe_customer_id = $1, 
             stripe_subscription_id = $2, 
             plan = 'pro', 
             status = $3, 
             updated_at = NOW() 
         WHERE user_id = $4`,
        [customerId, subscriptionId, status, userId]
      );
      console.log(`[Subscriptions] Updated subscription for user ${userId}`);
    } else {
      // Create new subscription
      await db.query(
        `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status) 
         VALUES ($1, $2, $3, 'pro', $4)`,
        [userId, customerId, subscriptionId, status]
      );
      console.log(`[Subscriptions] Created subscription for user ${userId}`);
    }

    // Also update user record with customer ID
    await db.query(
      'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
      [customerId, userId]
    );

  } catch (error) {
    console.error('[Subscriptions] setFromCheckout error:', error.message);
    throw error;
  }
}

// Cancel subscription (downgrade to free)
async function cancelByCustomer(customerId) {
  if (!customerId) return;

  try {
    const result = await db.query(
      `UPDATE subscriptions 
       SET plan = 'free', 
           status = 'canceled', 
           updated_at = NOW() 
       WHERE stripe_customer_id = $1 
       RETURNING user_id`,
      [customerId]
    );

    if (result.rows.length > 0) {
      console.log(`[Subscriptions] Canceled subscription for customer ${customerId}`);
    }
  } catch (error) {
    console.error('[Subscriptions] cancelByCustomer error:', error.message);
    throw error;
  }
}

// Get subscription by email
async function getByEmail(email) {
  if (!email) return null;

  try {
    const emailLower = email.toLowerCase();
    const result = await db.query(
      `SELECT s.plan, s.status, s.stripe_customer_id, s.stripe_subscription_id, s.updated_at
       FROM subscriptions s
       JOIN users u ON s.user_id = u.id
       WHERE u.email = $1`,
      [emailLower]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('[Subscriptions] getByEmail error:', error.message);
    return null;
  }
}

// Get subscription by customer ID
async function getByCustomer(customerId) {
  if (!customerId) return null;

  try {
    const result = await db.query(
      `SELECT s.plan, s.status, s.stripe_customer_id, s.stripe_subscription_id, s.updated_at, u.email
       FROM subscriptions s
       JOIN users u ON s.user_id = u.id
       WHERE s.stripe_customer_id = $1`,
      [customerId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('[Subscriptions] getByCustomer error:', error.message);
    return null;
  }
}

// Get subscription by user ID
async function getByUserId(userId) {
  if (!userId) return null;

  try {
    const result = await db.query(
      `SELECT plan, status, stripe_customer_id, stripe_subscription_id, updated_at
       FROM subscriptions
       WHERE user_id = $1`,
      [userId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('[Subscriptions] getByUserId error:', error.message);
    return null;
  }
}

module.exports = {
  setFromCheckout,
  cancelByCustomer,
  getByEmail,
  getByCustomer,
  getByUserId
};
