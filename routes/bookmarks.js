const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

// Get user's bookmarked posts
router.get('/', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const result = await db.query(`
      SELECT 
        p.id,
        p.content,
        p.author,
        p.created_at,
        p.jar_type,
        u.avatar_emoji,
        u.avatar_image,
        (SELECT COUNT(*) FROM reactions WHERE post_id = p.id) as reaction_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
        (SELECT reaction_type FROM reactions WHERE post_id = p.id AND user_id = $1) as user_reaction,
        COALESCE(
          (SELECT json_agg(t.name ORDER BY t.name)
           FROM tags t
           JOIN post_tags pt ON pt.tag_id = t.id
           WHERE pt.post_id = p.id),
          '[]'::json
        ) as tags,
        b.created_at as bookmarked_at
      FROM bookmarks b
      JOIN posts p ON b.post_id = p.id
      JOIN users u ON p.author = u.username
      WHERE b.user_id = $1
      ORDER BY b.created_at DESC
      LIMIT $2 OFFSET $3
    `, [userId, limit, offset]);

    // Get total count
    const countResult = await db.query(
      'SELECT COUNT(*) FROM bookmarks WHERE user_id = $1',
      [userId]
    );

    res.json({
      posts: result.rows,
      pagination: {
        page,
        limit,
        total: parseInt(countResult.rows[0].count),
        hasMore: offset + result.rows.length < parseInt(countResult.rows[0].count)
      }
    });
  } catch (error) {
    console.error('Error fetching bookmarks:', error);
    res.status(500).json({ error: 'Failed to fetch bookmarks' });
  }
});

// Add bookmark
router.post('/:postId', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.postId);

    // Check if post exists
    const postCheck = await db.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await db.query(
      'INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, postId]
    );

    res.json({ success: true, bookmarked: true });
  } catch (error) {
    console.error('Error adding bookmark:', error);
    res.status(500).json({ error: 'Failed to add bookmark' });
  }
});

// Remove bookmark
router.delete('/:postId', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.postId);

    await db.query(
      'DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2',
      [userId, postId]
    );

    res.json({ success: true, bookmarked: false });
  } catch (error) {
    console.error('Error removing bookmark:', error);
    res.status(500).json({ error: 'Failed to remove bookmark' });
  }
});

// Check if post is bookmarked
router.get('/check/:postId', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.postId);

    const result = await db.query(
      'SELECT 1 FROM bookmarks WHERE user_id = $1 AND post_id = $2',
      [userId, postId]
    );

    res.json({ bookmarked: result.rows.length > 0 });
  } catch (error) {
    console.error('Error checking bookmark:', error);
    res.status(500).json({ error: 'Failed to check bookmark' });
  }
});

module.exports = router;
