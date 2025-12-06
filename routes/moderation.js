const express = require('express');
const router = express.Router();
const db = require('../db');
const auth = require('../auth');

// Block a user
router.post('/block/:username', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get target user
    const targetUser = await db.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const blockedId = targetUser.rows[0].id;

    if (userId === blockedId) {
      return res.status(400).json({ error: 'Cannot block yourself' });
    }

    await db.query(
      'INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, blockedId]
    );

    // Delete any existing follows
    await db.query(
      'DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)',
      [userId, blockedId]
    );

    res.json({ success: true, blocked: true });
  } catch (error) {
    console.error('Error blocking user:', error);
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// Unblock a user
router.delete('/block/:username', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const targetUser = await db.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const blockedId = targetUser.rows[0].id;

    await db.query(
      'DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [userId, blockedId]
    );

    res.json({ success: true, blocked: false });
  } catch (error) {
    console.error('Error unblocking user:', error);
    res.status(500).json({ error: 'Failed to unblock user' });
  }
});

// Get blocked users list
router.get('/blocked', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await db.query(`
      SELECT 
        u.id,
        u.username,
        u.avatar_emoji,
        b.created_at as blocked_at
      FROM blocks b
      JOIN users u ON b.blocked_id = u.id
      WHERE b.blocker_id = $1
      ORDER BY b.created_at DESC
    `, [userId]);

    res.json({ blockedUsers: result.rows });
  } catch (error) {
    console.error('Error fetching blocked users:', error);
    res.status(500).json({ error: 'Failed to fetch blocked users' });
  }
});

// Hide a post
router.post('/hide/:postId', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.postId);

    await db.query(
      'INSERT INTO hidden_posts (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, postId]
    );

    res.json({ success: true, hidden: true });
  } catch (error) {
    console.error('Error hiding post:', error);
    res.status(500).json({ error: 'Failed to hide post' });
  }
});

// Unhide a post
router.delete('/hide/:postId', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.postId);

    await db.query(
      'DELETE FROM hidden_posts WHERE user_id = $1 AND post_id = $2',
      [userId, postId]
    );

    res.json({ success: true, hidden: false });
  } catch (error) {
    console.error('Error unhiding post:', error);
    res.status(500).json({ error: 'Failed to unhide post' });
  }
});

// Report a user
router.post('/report/user/:username', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const targetUser = await db.query('SELECT id FROM users WHERE username = $1', [req.params.username]);
    if (targetUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const reportedUserId = targetUser.rows[0].id;

    await db.query(
      'INSERT INTO reports (reporter_id, reported_user_id, reason) VALUES ($1, $2, $3)',
      [userId, reportedUserId, reason.trim()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error reporting user:', error);
    res.status(500).json({ error: 'Failed to report user' });
  }
});

// Report a post
router.post('/report/post/:postId', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const postId = parseInt(req.params.postId);
    const { reason } = req.body;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({ error: 'Reason is required' });
    }

    const postCheck = await db.query('SELECT 1 FROM posts WHERE id = $1', [postId]);
    if (postCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Post not found' });
    }

    await db.query(
      'INSERT INTO reports (reporter_id, reported_post_id, reason) VALUES ($1, $2, $3)',
      [userId, postId, reason.trim()]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error reporting post:', error);
    res.status(500).json({ error: 'Failed to report post' });
  }
});

// Admin: Get all reports
router.get('/admin/reports', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is admin
    const adminCheck = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (!adminCheck.rows[0] || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const status = req.query.status || 'pending';

    const result = await db.query(`
      SELECT 
        r.id,
        r.reason,
        r.status,
        r.admin_notes,
        r.created_at,
        r.resolved_at,
        reporter.username as reporter_username,
        reported_user.username as reported_username,
        r.reported_post_id,
        p.content as post_content
      FROM reports r
      JOIN users reporter ON r.reporter_id = reporter.id
      LEFT JOIN users reported_user ON r.reported_user_id = reported_user.id
      LEFT JOIN posts p ON r.reported_post_id = p.id
      WHERE r.status = $1
      ORDER BY r.created_at DESC
    `, [status]);

    res.json({ reports: result.rows });
  } catch (error) {
    console.error('Error fetching reports:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

// Admin: Update report status
router.patch('/admin/reports/:reportId', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const reportId = parseInt(req.params.reportId);
    const { status, adminNotes } = req.body;

    // Check if user is admin
    const adminCheck = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (!adminCheck.rows[0] || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const validStatuses = ['pending', 'reviewed', 'resolved', 'dismissed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await db.query(
      'UPDATE reports SET status = $1, admin_notes = $2, resolved_at = NOW() WHERE id = $3',
      [status, adminNotes || null, reportId]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Error updating report:', error);
    res.status(500).json({ error: 'Failed to update report' });
  }
});

// Admin: Get dashboard stats
router.get('/admin/stats', auth.authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Check if user is admin
    const adminCheck = await db.query('SELECT is_admin FROM users WHERE id = $1', [userId]);
    if (!adminCheck.rows[0] || !adminCheck.rows[0].is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const stats = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM users) as total_users,
        (SELECT COUNT(*) FROM posts) as total_posts,
        (SELECT COUNT(*) FROM reports WHERE status = 'pending') as pending_reports,
        (SELECT COUNT(*) FROM reports WHERE status = 'resolved') as resolved_reports,
        (SELECT COUNT(*) FROM blocks) as total_blocks
    `);

    res.json({ stats: stats.rows[0] });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
