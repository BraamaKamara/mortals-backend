// Reflection Suite API Routes
// Endpoints for presence index, continuity tracker, ethical nudges, ethical reflections
const express = require('express');
const db = require('../db');
const spiralService = require('../spiralService');
const router = express.Router();

// Note: Authentication middleware is applied at app.use level in index.js
// req.userId is set by authenticateToken middleware

// ============================================================================
// PRESENCE INDEX ENDPOINTS
// ============================================================================

/**
 * GET /api/reflection/presence-index/:date
 * Get presence index for a specific date
 */
router.get('/presence-index/:date', async (req, res) => {
  try {
    const { date } = req.params;
    
    const result = await db.query(
      'SELECT * FROM presence_index WHERE user_id = $1 AND date = $2',
      [req.userId, date]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No presence index found for this date' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[API] Error fetching presence index:', error);
    res.status(500).json({ error: 'Failed to fetch presence index' });
  }
});

/**
 * POST /api/reflection/presence-index
 * Save presence index for today
 */
router.post('/presence-index', async (req, res) => {
  try {
    const { score, breakdown } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (!score || score < 0 || score > 100) {
      return res.status(400).json({ error: 'Score must be between 0 and 100' });
    }

    const result = await db.query(
      `INSERT INTO presence_index (user_id, date, score, breakdown, created_at, updated_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, date) 
       DO UPDATE SET score = $3, breakdown = $4, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.userId, today, score, JSON.stringify(breakdown || {})]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Error saving presence index:', error);
    res.status(500).json({ error: 'Failed to save presence index' });
  }
});

/**
 * GET /api/reflection/presence-index/stats/:days
 * Get presence index stats for last N days
 */
router.get('/presence-index-stats/:days', async (req, res) => {
  try {
    const { days } = req.params;
    const daysNum = parseInt(days) || 7;

    const result = await db.query(
      `SELECT date, score 
       FROM presence_index 
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '${daysNum} days'
       ORDER BY date DESC`,
      [req.userId]
    );

    const avg = result.rows.length > 0
      ? Math.round(result.rows.reduce((sum, r) => sum + r.score, 0) / result.rows.length)
      : 0;

    res.json({
      period_days: daysNum,
      entries_count: result.rows.length,
      average_score: avg,
      entries: result.rows
    });
  } catch (error) {
    console.error('[API] Error fetching presence stats:', error);
    res.status(500).json({ error: 'Failed to fetch presence stats' });
  }
});

// ============================================================================
// CONTINUITY TRACKER ENDPOINTS
// ============================================================================

/**
 * POST /api/reflection/continuity-tracker
 * Log a day as intentional or not
 */
router.post('/continuity-tracker', async (req, res) => {
  try {
    const { date, is_intentional, note } = req.body;
    const targetDate = date || new Date().toISOString().split('T')[0];

    const result = await db.query(
      `INSERT INTO continuity_tracker (user_id, date, is_intentional, note, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id, date) 
       DO UPDATE SET is_intentional = $3, note = $4
       RETURNING *`,
      [req.userId, targetDate, is_intentional, note || null]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Error saving continuity log:', error);
    res.status(500).json({ error: 'Failed to save continuity log' });
  }
});

/**
 * GET /api/reflection/continuity-streak
 * Get current streak and longest streak
 */
router.get('/continuity-streak', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT date, is_intentional
       FROM continuity_tracker
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 365`,
      [req.userId]
    );

    const entries = result.rows;
    
    // Calculate current streak
    let currentStreak = 0;
    for (let i = 0; i < entries.length; i++) {
      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - i);
      const expectedDateStr = expectedDate.toISOString().split('T')[0];
      
      if (entries[i].date === expectedDateStr && entries[i].is_intentional) {
        currentStreak++;
      } else {
        break;
      }
    }

    // Calculate longest streak
    let longestStreak = 0;
    let tempStreak = 0;
    for (const entry of entries) {
      if (entry.is_intentional) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }

    res.json({
      current_streak: currentStreak,
      longest_streak: longestStreak,
      total_intentional_days: entries.filter(e => e.is_intentional).length,
      total_tracked_days: entries.length
    });
  } catch (error) {
    console.error('[API] Error calculating streak:', error);
    res.status(500).json({ error: 'Failed to calculate streak' });
  }
});

/**
 * GET /api/reflection/continuity-history/:days
 * Get continuity tracker history for last N days
 */
router.get('/continuity-history/:days', async (req, res) => {
  try {
    const { days } = req.params;
    const daysNum = parseInt(days) || 84; // 12 weeks

    const result = await db.query(
      `SELECT date, is_intentional
       FROM continuity_tracker
       WHERE user_id = $1 AND date >= CURRENT_DATE - INTERVAL '${daysNum} days'
       ORDER BY date ASC`,
      [req.userId]
    );

    res.json({
      period_days: daysNum,
      entries: result.rows
    });
  } catch (error) {
    console.error('[API] Error fetching continuity history:', error);
    res.status(500).json({ error: 'Failed to fetch continuity history' });
  }
});

// ============================================================================
// ETHICAL NUDGES ENDPOINTS
// ============================================================================

/**
 * GET /api/reflection/ethical-nudges
 * Get all active (unacknowledged) nudges for user
 */
router.get('/ethical-nudges', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nudge_type, title, message, severity, color, created_at
       FROM ethical_nudges
       WHERE user_id = $1 AND acknowledged = FALSE
       ORDER BY created_at DESC`,
      [req.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('[API] Error fetching nudges:', error);
    res.status(500).json({ error: 'Failed to fetch nudges' });
  }
});

/**
 * POST /api/reflection/ethical-nudges
 * Create a new nudge (usually by system/algorithm)
 */
router.post('/ethical-nudges', async (req, res) => {
  try {
    const { nudge_type, title, message, severity, color } = req.body;

    const result = await db.query(
      `INSERT INTO ethical_nudges (user_id, nudge_type, title, message, severity, color, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
       RETURNING *`,
      [req.userId, nudge_type, title, message, severity || 'warning', color || 'slate']
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Error creating nudge:', error);
    res.status(500).json({ error: 'Failed to create nudge' });
  }
});

/**
 * PUT /api/reflection/ethical-nudges/:id/acknowledge
 * Acknowledge a nudge
 */
router.put('/ethical-nudges/:id/acknowledge', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `UPDATE ethical_nudges
       SET acknowledged = TRUE, acknowledged_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Nudge not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Error acknowledging nudge:', error);
    res.status(500).json({ error: 'Failed to acknowledge nudge' });
  }
});

// ============================================================================
// ETHICAL REFLECTIONS ENDPOINTS
// ============================================================================

/**
 * POST /api/reflection/ethical-reflections
 * Save an ethical reflection response
 */
router.post('/ethical-reflections', async (req, res) => {
  try {
    const { prompt_id, prompt_category, question, user_response } = req.body;

    if (!prompt_id || !question || !user_response) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await db.query(
      `INSERT INTO ethical_reflections 
       (user_id, prompt_id, prompt_category, question, user_response, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING *`,
      [req.userId, prompt_id, prompt_category, question, user_response]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Error saving reflection:', error);
    res.status(500).json({ error: 'Failed to save reflection' });
  }
});

/**
 * GET /api/reflection/ethical-reflections
 * Get all ethical reflections for user
 */
router.get('/ethical-reflections', async (req, res) => {
  try {
    const { limit } = req.query;
    const limitNum = parseInt(limit) || 50;

    const result = await db.query(
      `SELECT id, prompt_id, prompt_category, question, user_response, ai_insight, created_at
       FROM ethical_reflections
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [req.userId, limitNum]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('[API] Error fetching reflections:', error);
    res.status(500).json({ error: 'Failed to fetch reflections' });
  }
});

/**
 * GET /api/reflection/ethical-reflections/:id
 * Get a specific reflection
 */
router.get('/ethical-reflections/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT * FROM ethical_reflections WHERE id = $1 AND user_id = $2`,
      [id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reflection not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[API] Error fetching reflection:', error);
    res.status(500).json({ error: 'Failed to fetch reflection' });
  }
});

/**
 * PUT /api/reflection/ethical-reflections/:id/insight
 * Add AI insight to a reflection
 */
router.put('/ethical-reflections/:id/insight', async (req, res) => {
  try {
    const { id } = req.params;
    const { ai_insight } = req.body;

    if (!ai_insight) {
      return res.status(400).json({ error: 'Missing ai_insight' });
    }

    const result = await db.query(
      `UPDATE ethical_reflections
       SET ai_insight = $1, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [ai_insight, id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Reflection not found' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Error updating insight:', error);
    res.status(500).json({ error: 'Failed to update insight' });
  }
});

// ============================================================================
// MORAL PRESENCE LOG ENDPOINTS
// ============================================================================

/**
 * POST /api/reflection/moral-presence-log
 * Log a real-time moral presence score
 */
router.post('/moral-presence-log', async (req, res) => {
  try {
    const { presence_score, contributors } = req.body;

    if (presence_score === undefined || presence_score < 0 || presence_score > 100) {
      return res.status(400).json({ error: 'presence_score must be between 0 and 100' });
    }

    const result = await db.query(
      `INSERT INTO moral_presence_log (user_id, timestamp, presence_score, contributors, created_at)
       VALUES ($1, CURRENT_TIMESTAMP, $2, $3, CURRENT_TIMESTAMP)
       RETURNING *`,
      [req.userId, presence_score, JSON.stringify(contributors || {})]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('[API] Error logging moral presence:', error);
    res.status(500).json({ error: 'Failed to log moral presence' });
  }
});

/**
 * GET /api/reflection/moral-presence-history/:hours
 * Get moral presence history for last N hours
 */
router.get('/moral-presence-history/:hours', async (req, res) => {
  try {
    const { hours } = req.params;
    const hoursNum = parseInt(hours) || 24;

    const result = await db.query(
      `SELECT timestamp, presence_score, contributors
       FROM moral_presence_log
       WHERE user_id = $1 AND timestamp >= CURRENT_TIMESTAMP - INTERVAL '${hoursNum} hours'
       ORDER BY timestamp DESC`,
      [req.userId]
    );

    const avg = result.rows.length > 0
      ? Math.round(result.rows.reduce((sum, r) => sum + r.presence_score, 0) / result.rows.length)
      : 0;

    res.json({
      period_hours: hoursNum,
      entries_count: result.rows.length,
      average_score: avg,
      entries: result.rows
    });
  } catch (error) {
    console.error('[API] Error fetching moral presence history:', error);
    res.status(500).json({ error: 'Failed to fetch moral presence history' });
  }
});

// ============================================================================
// DEGREES OF SELF - IDENTITY SPIRAL ENDPOINTS (McMahan Enhancement)
// ============================================================================

/**
 * POST /api/reflection/identity-spiral/:date
 * Calculate and cache identity spiral for a specific date
 */
router.post('/identity-spiral/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.userId;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Calculate continuity dimensions
    const continuity = await spiralService.calculateContinuity(userId, date);

    // Save to database
    const result = await spiralService.saveSpiral(userId, date, continuity);

    res.json({
      success: true,
      spiral: result,
      interpretation: interpretSpiral(continuity)
    });
  } catch (error) {
    console.error('[Identity Spiral] Calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate identity spiral' });
  }
});

/**
 * GET /api/reflection/identity-spiral/:date
 * Get cached spiral for a date (generates if missing)
 */
router.get('/identity-spiral/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.userId;

    // Validate date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const spiral = await spiralService.getSpiral(userId, date);

    res.json({
      success: true,
      spiral: spiral,
      interpretation: interpretSpiral({
        memory_continuity: spiral.memory_continuity,
        intention_continuity: spiral.intention_continuity,
        value_continuity: spiral.value_continuity,
        narrative_continuity: spiral.narrative_continuity,
        overall_unity: spiral.overall_unity
      })
    });
  } catch (error) {
    console.error('[Identity Spiral] Fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch identity spiral' });
  }
});

/**
 * GET /api/reflection/identity-spiral-trend
 * Get spiral trend for past N days (default 30)
 */
router.get('/identity-spiral-trend', async (req, res) => {
  try {
    const userId = req.userId;
    const days = parseInt(req.query.days) || 30;

    const trend = await spiralService.getSpiralTrend(userId, days);

    // Calculate statistics
    const stats = {
      count: trend.length,
      average_unity: trend.length > 0 
        ? trend.reduce((sum, t) => sum + t.overall_unity, 0) / trend.length
        : 0,
      highest_unity: trend.length > 0 
        ? Math.max(...trend.map(t => t.overall_unity))
        : 0,
      lowest_unity: trend.length > 0 
        ? Math.min(...trend.map(t => t.overall_unity))
        : 0,
      trend_direction: calculateTrend(trend)
    };

    res.json({
      success: true,
      trend: trend,
      stats: stats
    });
  } catch (error) {
    console.error('[Identity Spiral] Trend error:', error);
    res.status(500).json({ error: 'Failed to fetch spiral trend' });
  }
});

/**
 * GET /api/reflection/moral-weight/:date
 * Returns hourly breakdown and summary for the specified date
 */
router.get('/moral-weight/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const userId = req.userId;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Aggregate presence samples by hour for the given date
    const result = await db.query(
      `SELECT 
         EXTRACT(HOUR FROM timestamp) AS hour,
         AVG(presence_score) AS avg_score,
         COUNT(*) AS samples
       FROM moral_presence_log
       WHERE user_id = $1 AND DATE(timestamp) = $2
       GROUP BY hour
       ORDER BY hour ASC`,
      [userId, date]
    );

    // Map average scores to tiers and points
    const rows = result.rows || [];
    const hours = Array.from({ length: 24 }, (_, h) => {
      const match = rows.find(r => Number(r.hour) === h);
      const avg = match ? Number(match.avg_score) : 0;
      let tier = 'shallow';
      let points = 1;

      if (avg >= 80) { tier = 'ethical_generative'; points = 7; }
      else if (avg >= 60) { tier = 'reflective'; points = 5; }
      else if (avg >= 30) { tier = 'rich'; points = 3; }

      return {
        hour: h,
        avg_score: Math.round(avg),
        tier,
        points
      };
    });

    // Summaries
    const summary = hours.reduce((acc, h) => {
      acc.total_points += h.points;
      acc.counts[h.tier] = (acc.counts[h.tier] || 0) + 1;
      return acc;
    }, { total_points: 0, counts: { shallow: 0, rich: 0, reflective: 0, ethical_generative: 0 } });

    const totalHours = hours.length;
    const pct = (n) => totalHours ? Math.round((n / totalHours) * 100) : 0;

    res.json({
      success: true,
      date,
      hours,
      summary: {
        total_points: summary.total_points,
        max_points: 24 * 7,
        quality_pct: Math.round((summary.total_points / (24 * 7)) * 100),
        distribution: {
          shallow: { hours: summary.counts.shallow, pct: pct(summary.counts.shallow) },
          rich: { hours: summary.counts.rich, pct: pct(summary.counts.rich) },
          reflective: { hours: summary.counts.reflective, pct: pct(summary.counts.reflective) },
          ethical_generative: { hours: summary.counts.ethical_generative, pct: pct(summary.counts.ethical_generative) }
        }
      }
    });
  } catch (error) {
    console.error('[Moral Weight] Error computing hourly tiers:', error);
    res.status(500).json({ error: 'Failed to compute moral weight of moments' });
  }
});
/**
 * Helper: Interpret spiral qualities in human-readable text
 */
function interpretSpiral(continuity) {
  const unity = continuity.overall_unity;
  let interpretation = '';

  if (unity > 0.8) {
    interpretation = 'Highly unified self. Your identity feels coherent and stable.';
  } else if (unity > 0.6) {
    interpretation = 'Well-integrated. Your various dimensions of self are aligned.';
  } else if (unity > 0.4) {
    interpretation = 'Moderate fragmentation. Some aspects of your identity feel disconnected.';
  } else {
    interpretation = 'Significantly fragmented. Your identity feels scattered—consider pausing to reconnect.';
  }

  // Add specific insights
  const weakest = Math.min(
    continuity.memory_continuity,
    continuity.intention_continuity,
    continuity.value_continuity,
    continuity.narrative_continuity
  );

  if (weakest === continuity.memory_continuity) {
    interpretation += ' Your memory of past commitments feels weak.';
  } else if (weakest === continuity.intention_continuity) {
    interpretation += ' You\'re struggling to follow through on intentions.';
  } else if (weakest === continuity.value_continuity) {
    interpretation += ' Your actions don\'t align with your stated values.';
  } else if (weakest === continuity.narrative_continuity) {
    interpretation += ' Your day lacks coherent narrative—what\'s the story?';
  }

  return interpretation;
}

/**
 * Helper: Determine trend direction (improving/declining/stable)
 */
function calculateTrend(spiralArray) {
  if (spiralArray.length < 2) return 'stable';

  const recent = spiralArray.slice(-7);
  const older = spiralArray.slice(-14, -7);

  if (recent.length === 0 || older.length === 0) return 'stable';

  const recentAvg = recent.reduce((sum, t) => sum + t.overall_unity, 0) / recent.length;
  const olderAvg = older.reduce((sum, t) => sum + t.overall_unity, 0) / older.length;

  const change = recentAvg - olderAvg;

  if (change > 0.1) return 'improving';
  if (change < -0.1) return 'declining';
  return 'stable';
}

module.exports = router;
