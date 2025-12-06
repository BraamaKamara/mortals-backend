// Notifications routes
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');

// Get user's notifications
router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const unreadOnly = req.query.unreadOnly === 'true';

    const whereClause = unreadOnly ? 'WHERE n.user_id = $1 AND n.read = FALSE' : 'WHERE n.user_id = $1';

    const result = await db.query(`
      SELECT 
        n.id, n.type, n.message, n.read, n.created_at,
        n.post_id, n.comment_id,
        actor.username as actor_username,
        actor.avatar_emoji as actor_avatar_emoji
      FROM notifications n
      LEFT JOIN users actor ON n.actor_id = actor.id
      ${whereClause}
      ORDER BY n.created_at DESC
      LIMIT 50
    `, [userId]);

    res.json({ notifications: result.rows });
  } catch (error) {
    console.error('[Notifications] Error fetching:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get unread count
router.get('/unread-count', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read = FALSE',
      [userId]
    );

    res.json({ count: parseInt(result.rows[0].count) });
  } catch (error) {
    console.error('[Notifications] Error fetching count:', error);
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

// Mark notification as read
router.patch('/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await db.query(
      `UPDATE notifications 
       SET read = TRUE 
       WHERE id = $1 AND user_id = $2
       RETURNING id`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Notifications] Error marking as read:', error);
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// Mark all as read
router.patch('/mark-all-read', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    await db.query(
      'UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE',
      [userId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('[Notifications] Error marking all as read:', error);
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

module.exports = router;
