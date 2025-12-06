// User profile routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, optionalAuth } = require('../auth');

// Get user profile by username
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const { username } = req.params;

    // Get user info
    const userResult = await db.query(
      `SELECT id, username, email, bio, dob, avatar_emoji, avatar_image, created_at 
       FROM users WHERE username = $1`,
      [username]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];
    const isOwnProfile = req.user && req.user.id === user.id;

    // Don't expose email to others
    if (!isOwnProfile) {
      delete user.email;
    }

    // Get user's post count
    const postCount = await db.query(
      'SELECT COUNT(*) FROM posts WHERE user_id = $1',
      [user.id]
    );

    // Get follower and following counts
    const followerCount = await db.query(
      'SELECT COUNT(*) FROM follows WHERE following_id = $1',
      [user.id]
    );

    const followingCount = await db.query(
      'SELECT COUNT(*) FROM follows WHERE follower_id = $1',
      [user.id]
    );

    // Check if current user is following this profile
    let isFollowing = false;
    let isBlocked = false;
    if (req.user && !isOwnProfile) {
      const followResult = await db.query(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
        [req.user.id, user.id]
      );
      isFollowing = followResult.rows.length > 0;
      
      // Check if current user has blocked this profile
      const blockResult = await db.query(
        'SELECT 1 FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',
        [req.user.id, user.id]
      );
      isBlocked = blockResult.rows.length > 0;
    }

    // Get user's posts
    const postsResult = await db.query(
      `SELECT 
        p.id, p.content, p.likes_count, p.created_at,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
        (SELECT ARRAY_AGG(t.name) 
         FROM post_tags pt 
         JOIN tags t ON pt.tag_id = t.id 
         WHERE pt.post_id = p.id) as tags
       FROM posts p
       WHERE p.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 20`,
      [user.id]
    );

    res.json({
      profile: {
        ...user,
        postCount: parseInt(postCount.rows[0].count),
        followerCount: parseInt(followerCount.rows[0].count),
        followingCount: parseInt(followingCount.rows[0].count),
        isFollowing,
        isBlocked,
        posts: postsResult.rows
      }
    });
  } catch (error) {
    console.error('[Profile] Error fetching profile:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update own profile
router.patch('/me', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { bio, dob, avatar_emoji, avatar_image } = req.body;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (bio !== undefined) {
      updates.push(`bio = $${paramCount++}`);
      values.push(bio);
    }
    if (dob !== undefined) {
      updates.push(`dob = $${paramCount++}`);
      values.push(dob);
    }
    if (avatar_emoji !== undefined) {
      updates.push(`avatar_emoji = $${paramCount++}`);
      values.push(avatar_emoji);
    }
    if (avatar_image !== undefined) {
      updates.push(`avatar_image = $${paramCount++}`);
      values.push(avatar_image);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const result = await db.query(
      `UPDATE users 
       SET ${updates.join(', ')}
       WHERE id = $${paramCount}
       RETURNING id, username, bio, dob, avatar_emoji, avatar_image`,
      values
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Profile] Error updating profile:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Follow a user
router.post('/:username/follow', authenticateToken, async (req, res) => {
  try {
    const { username } = req.params;
    const followerId = req.user.id;

    // Get user to follow
    const userResult = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const followingId = userResult.rows[0].id;

    if (followerId === followingId) {
      return res.status(400).json({ error: 'Cannot follow yourself' });
    }

    // Add follow relationship
    await db.query(
      'INSERT INTO follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [followerId, followingId]
    );

    res.json({ message: 'Successfully followed user' });
  } catch (error) {
    console.error('[Profile] Error following user:', error);
    res.status(500).json({ error: 'Failed to follow user' });
  }
});

// Unfollow a user
router.delete('/:username/follow', authenticateToken, async (req, res) => {
  try {
    const { username } = req.params;
    const followerId = req.user.id;

    // Get user to unfollow
    const userResult = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const followingId = userResult.rows[0].id;

    // Remove follow relationship
    await db.query(
      'DELETE FROM follows WHERE follower_id = $1 AND following_id = $2',
      [followerId, followingId]
    );

    res.json({ message: 'Successfully unfollowed user' });
  } catch (error) {
    console.error('[Profile] Error unfollowing user:', error);
    res.status(500).json({ error: 'Failed to unfollow user' });
  }
});

// Get following feed (posts from users you follow)
router.get('/feed/following', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const result = await db.query(`
      SELECT 
        p.id, p.content, p.philosopher, p.likes_count, p.is_anonymous,
        p.created_at,
        u.id as author_id, u.username as author_username, 
        u.avatar_emoji as author_avatar_emoji, u.avatar_image as author_avatar_image,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
        (SELECT ARRAY_AGG(t.name) 
         FROM post_tags pt 
         JOIN tags t ON pt.tag_id = t.id 
         WHERE pt.post_id = p.id) as tags
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.user_id IN (
        SELECT following_id FROM follows WHERE follower_id = $1
      )
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    // Get total count
    const countResult = await db.query(`
      SELECT COUNT(*) 
      FROM posts p
      WHERE p.user_id IN (
        SELECT following_id FROM follows WHERE follower_id = $1
      )
    `, [userId]);
    const total = parseInt(countResult.rows[0].count);

    res.json({
      posts: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[Profile] Error fetching following feed:', error);
    res.status(500).json({ error: 'Failed to fetch following feed' });
  }
});

module.exports = router;
