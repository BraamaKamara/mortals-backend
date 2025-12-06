// Authentication routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

// Signup - Create new user account
router.post('/signup', async (req, res) => {
  try {
    const { email, username, password } = req.body;

    // Validation
    if (!email || !username || !password) {
      return res.status(400).json({ error: 'Email, username, and password required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const emailLower = email.toLowerCase().trim();

    // Check if user already exists
    const existing = await db.query(
      'SELECT id FROM users WHERE email = $1',
      [emailLower]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const passwordHash = await auth.hashPassword(password);

    // Create user
    const result = await db.query(
      `INSERT INTO users (email, username, password_hash, email_verified) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id, email, username, created_at`,
      [emailLower, username, passwordHash, false]
    );

    const user = result.rows[0];

    // Create session
    const token = await auth.createSession(user.id, user.email);

    console.log(`[Auth] New user registered: ${user.email}`);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        emailVerified: false,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    console.error('[Auth] Signup error:', error.message);
    res.status(500).json({ error: 'Account creation failed' });
  }
});

// Login - Authenticate existing user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const emailLower = email.toLowerCase().trim();

    // Find user
    const result = await db.query(
      'SELECT id, email, username, password_hash, email_verified, avatar_emoji, avatar_image, is_admin FROM users WHERE email = $1',
      [emailLower]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    // Verify password
    const validPassword = await auth.verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Create session
    const token = await auth.createSession(user.id, user.email);

    console.log(`[Auth] User logged in: ${user.email}`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        emailVerified: user.email_verified,
        avatarEmoji: user.avatar_emoji,
        avatarImage: user.avatar_image,
        isAdmin: user.is_admin || false
      }
    });
  } catch (error) {
    console.error('[Auth] Login error:', error.message);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Logout - Invalidate session
router.post('/logout', auth.authenticateToken, async (req, res) => {
  try {
    await auth.deleteSession(req.token);
    console.log(`[Auth] User logged out: ${req.user.email}`);
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('[Auth] Logout error:', error.message);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user info
router.get('/me', auth.authenticateToken, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, username, email_verified, avatar_emoji, avatar_image, bio, dob, created_at 
       FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    // Get subscription info
    const subResult = await db.query(
      'SELECT plan, status, stripe_customer_id FROM subscriptions WHERE user_id = $1',
      [req.user.id]
    );

    const subscription = subResult.rows[0] || { plan: 'free', status: 'active' };

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      emailVerified: user.email_verified,
      avatarEmoji: user.avatar_emoji,
      avatarImage: user.avatar_image,
      bio: user.bio,
      dob: user.dob,
      createdAt: user.created_at,
      subscription: {
        plan: subscription.plan,
        status: subscription.status,
        customerId: subscription.stripe_customer_id
      }
    });
  } catch (error) {
    console.error('[Auth] Get user error:', error.message);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

// Update user profile
router.patch('/me', auth.authenticateToken, async (req, res) => {
  try {
    const { username, avatarEmoji, avatarImage, bio, dob } = req.body;
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (username !== undefined) {
      updates.push(`username = $${paramCount++}`);
      values.push(username);
    }
    if (avatarEmoji !== undefined) {
      updates.push(`avatar_emoji = $${paramCount++}`);
      values.push(avatarEmoji);
    }
    if (avatarImage !== undefined) {
      updates.push(`avatar_image = $${paramCount++}`);
      values.push(avatarImage);
    }
    if (bio !== undefined) {
      updates.push(`bio = $${paramCount++}`);
      values.push(bio);
    }
    if (dob !== undefined) {
      updates.push(`dob = $${paramCount++}`);
      values.push(dob);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(req.user.id);

    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING username, avatar_emoji, avatar_image, bio, dob`,
      values
    );

    console.log(`[Auth] Profile updated: ${req.user.email}`);

    res.json({
      success: true,
      message: 'Profile updated',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('[Auth] Update profile error:', error.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;
