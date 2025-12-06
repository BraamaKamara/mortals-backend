// Posts and comments API routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, optionalAuth } = require('../auth');

// Get all available tags
router.get('/tags', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT t.name, COUNT(pt.post_id) as post_count
      FROM tags t
      LEFT JOIN post_tags pt ON t.id = pt.tag_id
      GROUP BY t.id, t.name
      ORDER BY post_count DESC, t.name ASC
    `);
    res.json({ tags: result.rows });
  } catch (error) {
    console.error('[Posts] Error fetching tags:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// Get all posts with pagination, search, and filters
router.get('/', optionalAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const author = req.query.author || '';
    const dateFrom = req.query.dateFrom || '';
    const dateTo = req.query.dateTo || '';
    const tags = req.query.tags ? req.query.tags.split(',') : [];

    // Build WHERE clause
    const conditions = [];
    const params = [];
    let paramCount = 1;

    if (search) {
      conditions.push(`p.content ILIKE $${paramCount++}`);
      params.push(`%${search}%`);
    }

    if (author) {
      conditions.push(`u.username = $${paramCount++}`);
      params.push(author);
    }

    if (dateFrom) {
      conditions.push(`p.created_at >= $${paramCount++}`);
      params.push(dateFrom);
    }

    if (dateTo) {
      conditions.push(`p.created_at <= $${paramCount++}`);
      params.push(dateTo);
    }

    if (tags.length > 0) {
      conditions.push(`p.id IN (
        SELECT pt.post_id 
        FROM post_tags pt 
        JOIN tags t ON pt.tag_id = t.id 
        WHERE t.name = ANY($${paramCount++})
      )`);
      params.push(tags);
    }

    // Exclude hidden posts and blocked users if user is authenticated
    if (req.user) {
      conditions.push(`p.id NOT IN (SELECT post_id FROM hidden_posts WHERE user_id = $${paramCount++})`);
      params.push(req.user.id);
      
      conditions.push(`u.id NOT IN (SELECT blocked_id FROM blocks WHERE blocker_id = $${paramCount++})`);
      params.push(req.user.id);
      
      conditions.push(`u.id NOT IN (SELECT blocker_id FROM blocks WHERE blocked_id = $${paramCount++})`);
      params.push(req.user.id);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Add pagination params
    params.push(limit, offset);

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
         WHERE pt.post_id = p.id) as tags,
        ${req.user ? `EXISTS(SELECT 1 FROM bookmarks WHERE user_id = ${req.user.id} AND post_id = p.id)` : 'false'} as is_bookmarked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ${whereClause}
      ORDER BY p.created_at DESC
      LIMIT $${paramCount++} OFFSET $${paramCount++}
    `, params);

    // Get total count with filters
    const countResult = await db.query(`
      SELECT COUNT(*) 
      FROM posts p
      JOIN users u ON p.user_id = u.id
      ${whereClause}
    `, params.slice(0, -2)); // Exclude limit and offset
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
    console.error('[Posts] Error fetching posts:', error);
    res.status(500).json({ error: 'Failed to fetch posts' });
  }
});

// Get single post with details
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT 
        p.id, p.content, p.philosopher, p.likes_count, p.is_anonymous,
        p.created_at,
        u.id as author_id, u.username as author_username,
        u.avatar_emoji as author_avatar_emoji, u.avatar_image as author_avatar_image
      FROM posts p
      JOIN users u ON p.user_id = u.id
      WHERE p.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[Posts] Error fetching post:', error);
    res.status(500).json({ error: 'Failed to fetch post' });
  }
});

// Create new post (requires auth)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { content, tags = [] } = req.body;
    const authorId = req.user.id;

    console.log('[Posts] Creating post for user ID:', authorId, 'Email:', req.user.email);

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const result = await db.query(`
      INSERT INTO posts (user_id, content)
      VALUES ($1, $2)
      RETURNING id, content, philosopher, likes_count, is_anonymous, created_at
    `, [authorId, content]);

    // Get author info
    const userResult = await db.query(
      'SELECT id, username, avatar_emoji, avatar_image FROM users WHERE id = $1',
      [authorId]
    );

    if (userResult.rows.length === 0) {
      console.error('[Posts] User not found for ID:', authorId);
      return res.status(404).json({ error: 'User not found' });
    }

    const postId = result.rows[0].id;

    // Add tags if provided
    const postTags = [];
    if (tags.length > 0) {
      for (const tagName of tags) {
        // Get or create tag
        const tagResult = await db.query(`
          INSERT INTO tags (name) 
          VALUES ($1) 
          ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `, [tagName.toLowerCase().trim()]);
        
        // Link tag to post
        await db.query(`
          INSERT INTO post_tags (post_id, tag_id) 
          VALUES ($1, $2) 
          ON CONFLICT DO NOTHING
        `, [postId, tagResult.rows[0].id]);
        
        postTags.push(tagName.toLowerCase().trim());
      }
    }

    const post = {
      id: postId,
      content: result.rows[0].content,
      likes_count: result.rows[0].likes_count || 0,
      author_id: userResult.rows[0].id,
      author_username: userResult.rows[0].username,
      author_avatar_emoji: userResult.rows[0].avatar_emoji,
      author_avatar_image: userResult.rows[0].avatar_image,
      created_at: result.rows[0].created_at,
      tags: postTags
    };

    // Emit new post event via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.emit('new_post', post);
    }

    res.status(201).json(post);
  } catch (error) {
    console.error('[Posts] Error creating post:', error);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

// Get comments for a post
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT 
        c.id, c.content, c.created_at,
        u.id as author_id, u.username as author_username,
        u.avatar_emoji as author_avatar_emoji, u.avatar_image as author_avatar_image
      FROM comments c
      JOIN users u ON c.user_id = u.id
      WHERE c.post_id = $1
      ORDER BY c.created_at ASC
    `, [id]);

    res.json({ comments: result.rows });
  } catch (error) {
    console.error('[Posts] Error fetching comments:', error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Add comment to a post (requires auth)
router.post('/:id/comments', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const authorId = req.user.id;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Check if post exists and get author
    const postCheck = await db.query('SELECT id, user_id FROM posts WHERE id = $1', [id]);
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Insert comment
    const result = await db.query(`
      INSERT INTO comments (post_id, user_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, content, created_at
    `, [id, authorId, content]);

    // Create notification for post author (if not commenting on own post)
    if (postCheck.rows[0].user_id !== authorId) {
      await db.query(
        `INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, message)
         VALUES ($1, $2, 'comment', $3, $4, 'commented on your post')`,
        [postCheck.rows[0].user_id, authorId, id, result.rows[0].id]
      );
    }

    // Get author info
    const userResult = await db.query(
      'SELECT id, username, avatar_emoji, avatar_image FROM users WHERE id = $1',
      [authorId]
    );

    if (userResult.rows.length === 0) {
      console.error('[Posts] User not found for ID:', authorId);
      return res.status(404).json({ error: 'User not found' });
    }

    const comment = {
      ...result.rows[0],
      author_id: userResult.rows[0].id,
      author_username: userResult.rows[0].username,
      author_avatar_emoji: userResult.rows[0].avatar_emoji,
      author_avatar_image: userResult.rows[0].avatar_image
    };

    // Emit new comment event via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.emit('new_comment', { postId: id, comment });
      
      // Emit notification to post author if different user
      if (postCheck.rows[0].user_id !== authorId) {
        io.to(`user_${postCheck.rows[0].user_id}`).emit('new_notification', {
          type: 'comment',
          message: `${userResult.rows[0].username} commented on your post`,
          postId: id,
          commentId: result.rows[0].id
        });
      }
    }

    res.status(201).json(comment);
  } catch (error) {
    console.error('[Posts] Error adding comment:', error);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Add/remove reaction to a post (requires auth)
router.post('/:id/react', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reaction } = req.body; // 'like', 'love', 'inspire', 'reflect', 'wisdom'
    const userId = req.user.id;

    const validReactions = ['like', 'love', 'inspire', 'reflect', 'wisdom'];
    if (!reaction || !validReactions.includes(reaction)) {
      return res.status(400).json({ error: 'Invalid reaction type' });
    }

    // Check if post exists
    const postCheck = await db.query('SELECT id, user_id FROM posts WHERE id = $1', [id]);
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    // Check if user already reacted with this type
    const existingReaction = await db.query(
      'SELECT id FROM reactions WHERE post_id = $1 AND user_id = $2 AND reaction_type = $3',
      [id, userId, reaction]
    );

    if (existingReaction.rows.length > 0) {
      // Remove reaction
      await db.query(
        'DELETE FROM reactions WHERE post_id = $1 AND user_id = $2 AND reaction_type = $3',
        [id, userId, reaction]
      );
    } else {
      // Add reaction
      await db.query(
        'INSERT INTO reactions (post_id, user_id, reaction_type) VALUES ($1, $2, $3)',
        [id, userId, reaction]
      );

      // Create notification for post author (if not reacting to own post)
      if (postCheck.rows[0].user_id !== userId) {
        await db.query(
          `INSERT INTO notifications (user_id, actor_id, type, post_id, message)
           VALUES ($1, $2, 'reaction', $3, $4)`,
          [
            postCheck.rows[0].user_id,
            userId,
            id,
            `reacted with ${reaction} to your post`
          ]
        );
      }
    }

    // Get all reactions for this post
    const reactions = await db.query(
      `SELECT reaction_type, COUNT(*) as count
       FROM reactions
       WHERE post_id = $1
       GROUP BY reaction_type`,
      [id]
    );

    // Get user's reactions
    const userReactions = await db.query(
      'SELECT reaction_type FROM reactions WHERE post_id = $1 AND user_id = $2',
      [id, userId]
    );

    const responseData = {
      reactions: reactions.rows.reduce((acc, r) => {
        acc[r.reaction_type] = parseInt(r.count);
        return acc;
      }, {}),
      userReactions: userReactions.rows.map(r => r.reaction_type)
    };

    // Emit reaction update event via Socket.io
    const io = req.app.get('io');
    if (io) {
      io.emit('reaction_update', { postId: id, ...responseData });
      
      // Emit notification to post author if different user and reaction was added (not removed)
      if (postCheck.rows[0].user_id !== userId && existingReaction.rows.length === 0) {
        const userInfo = await db.query('SELECT username FROM users WHERE id = $1', [userId]);
        if (userInfo.rows.length > 0) {
          io.to(`user_${postCheck.rows[0].user_id}`).emit('new_notification', {
            type: 'reaction',
            message: `${userInfo.rows[0].username} reacted with ${reaction} to your post`,
            postId: id
          });
        }
      }
    }

    res.json(responseData);
  } catch (error) {
    console.error('[Posts] Error reacting to post:', error);
    res.status(500).json({ error: 'Failed to react to post' });
  }
});

// Update a post (requires auth and ownership)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const userId = req.user.id;

    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }

    // Check if post exists and user owns it
    const postCheck = await db.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (postCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only edit your own posts' });
    }

    // Update the post
    const result = await db.query(
      'UPDATE posts SET content = $1 WHERE id = $2 RETURNING id, content, created_at',
      [content, id]
    );

    res.json({
      id: result.rows[0].id,
      content: result.rows[0].content,
      created_at: result.rows[0].created_at,
      updated: true
    });
  } catch (error) {
    console.error('[Posts] Error updating post:', error);
    res.status(500).json({ error: 'Failed to update post' });
  }
});

// Delete a post (requires auth and ownership)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if post exists and user owns it
    const postCheck = await db.query('SELECT user_id FROM posts WHERE id = $1', [id]);
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    if (postCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'You can only delete your own posts' });
    }

    // Delete the post (comments will cascade delete due to foreign key)
    await db.query('DELETE FROM posts WHERE id = $1', [id]);

    res.json({ success: true, message: 'Post deleted successfully' });
  } catch (error) {
    console.error('[Posts] Error deleting post:', error);
    res.status(500).json({ error: 'Failed to delete post' });
  }
});

module.exports = router;
