const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

// Get all conversations for current user
router.get('/conversations', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await db.query(`
      SELECT 
        c.id,
        c.created_at,
        c.updated_at,
        CASE 
          WHEN c.participant1_id = $1 THEN c.participant2_id
          ELSE c.participant1_id
        END as other_user_id,
        CASE 
          WHEN c.participant1_id = $1 THEN u2.username
          ELSE u1.username
        END as other_username,
        CASE 
          WHEN c.participant1_id = $1 THEN u2.avatar_emoji
          ELSE u1.avatar_emoji
        END as other_avatar,
        (SELECT content FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message,
        (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_time,
        (SELECT COUNT(*) FROM messages WHERE conversation_id = c.id AND sender_id != $1 AND is_read = false) as unread_count
      FROM conversations c
      JOIN users u1 ON c.participant1_id = u1.id
      JOIN users u2 ON c.participant2_id = u2.id
      WHERE c.participant1_id = $1 OR c.participant2_id = $1
      ORDER BY c.updated_at DESC
    `, [userId]);

    res.json({ conversations: result.rows });
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// Get or create conversation with a user
router.post('/conversations', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { otherUserId } = req.body;

    if (!otherUserId) {
      return res.status(400).json({ error: 'otherUserId is required' });
    }

    if (userId === otherUserId) {
      return res.status(400).json({ error: 'Cannot message yourself' });
    }

    // Check if user is blocked
    const blockCheck = await db.query(
      'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
      [userId, otherUserId]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Cannot message this user' });
    }

    // Ensure participant1_id < participant2_id for consistency
    const [participant1, participant2] = userId < otherUserId 
      ? [userId, otherUserId] 
      : [otherUserId, userId];

    // Try to insert, or get existing conversation
    const result = await db.query(`
      INSERT INTO conversations (participant1_id, participant2_id)
      VALUES ($1, $2)
      ON CONFLICT (participant1_id, participant2_id) DO UPDATE SET updated_at = NOW()
      RETURNING id
    `, [participant1, participant2]);

    res.json({ conversationId: result.rows[0].id });
  } catch (error) {
    console.error('Error creating conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// Get messages in a conversation
router.get('/conversations/:id/messages', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = parseInt(req.params.id);
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    // Verify user is participant
    const convCheck = await db.query(
      'SELECT 1 FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get messages
    const result = await db.query(`
      SELECT 
        m.id,
        m.content,
        m.sender_id,
        m.is_read,
        m.created_at,
        u.username as sender_username,
        u.avatar_emoji as sender_avatar
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.conversation_id = $1
      ORDER BY m.created_at DESC
      LIMIT $2 OFFSET $3
    `, [conversationId, limit, offset]);

    // Mark messages as read
    await db.query(
      'UPDATE messages SET is_read = true WHERE conversation_id = $1 AND sender_id != $2 AND is_read = false',
      [conversationId, userId]
    );

    res.json({ messages: result.rows.reverse() });
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// Send a message
router.post('/conversations/:id/messages', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = parseInt(req.params.id);
    const { content } = req.body;

    if (!content || content.trim().length === 0) {
      return res.status(400).json({ error: 'Message content is required' });
    }

    if (content.length > 2000) {
      return res.status(400).json({ error: 'Message too long' });
    }

    // Verify user is participant
    const convCheck = await db.query(
      'SELECT participant1_id, participant2_id FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2)',
      [conversationId, userId]
    );

    if (convCheck.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const otherUserId = convCheck.rows[0].participant1_id === userId 
      ? convCheck.rows[0].participant2_id 
      : convCheck.rows[0].participant1_id;

    // Check if blocked
    const blockCheck = await db.query(
      'SELECT 1 FROM blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)',
      [userId, otherUserId]
    );

    if (blockCheck.rows.length > 0) {
      return res.status(403).json({ error: 'Cannot message this user' });
    }

    // Insert message
    const result = await db.query(`
      INSERT INTO messages (conversation_id, sender_id, content)
      VALUES ($1, $2, $3)
      RETURNING id, content, sender_id, is_read, created_at
    `, [conversationId, userId, content.trim()]);

    // Update conversation timestamp
    await db.query('UPDATE conversations SET updated_at = NOW() WHERE id = $1', [conversationId]);

    // Get sender info for response
    const userInfo = await db.query(
      'SELECT username, avatar_emoji FROM users WHERE id = $1',
      [userId]
    );

    const message = {
      ...result.rows[0],
      sender_username: userInfo.rows[0].username,
      sender_avatar: userInfo.rows[0].avatar_emoji
    };

    // Emit socket event to other user
    const io = req.app.get('io');
    if (io) {
      io.to(`user_${otherUserId}`).emit('new_message', {
        conversationId,
        message
      });
    }

    res.json({ message });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Delete a conversation
router.delete('/conversations/:id', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = parseInt(req.params.id);

    // Verify user is participant
    const result = await db.query(
      'DELETE FROM conversations WHERE id = $1 AND (participant1_id = $2 OR participant2_id = $2) RETURNING id',
      [conversationId, userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
});

module.exports = router;
