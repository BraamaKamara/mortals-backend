const express = require('express');
const db = require('../db');
const { generateInsights } = require('../ai');

const router = express.Router();

// GET latest cached insight (if any) or generate a new one
router.post('/insights', async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI is not configured (missing OPENAI_API_KEY).' });
    }

    const userId = req.userId;

    // Return cached insight if newer than 6 hours
    const cached = await db.query(
      `SELECT id, summary_json, model, tokens_used, created_at
       FROM ai_insights
       WHERE user_id = $1 AND scope = 'weekly'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId]
    );

    if (cached.rows.length > 0) {
      const last = cached.rows[0];
      const ageMs = Date.now() - new Date(last.created_at).getTime();
      const sixHours = 6 * 60 * 60 * 1000;
      if (ageMs < sixHours) {
        return res.json({ cached: true, created_at: last.created_at, model: last.model, tokens_used: last.tokens_used, summary: last.summary_json.summary, snapshot: last.summary_json.snapshot });
      }
    }

    const result = await generateInsights(userId);

    // Persist for reuse
    await db.query(
      `INSERT INTO ai_insights (user_id, scope, summary_json, model, tokens_used)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, 'weekly', JSON.stringify({ summary: result.summary, snapshot: result.snapshot }), result.model, result.tokens_used]
    );

    return res.json({ cached: false, summary: result.summary, snapshot: result.snapshot, model: result.model, tokens_used: result.tokens_used });
  } catch (error) {
    console.error('[AI] Error generating insights:', error);
    res.status(500).json({ error: 'Failed to generate insights' });
  }
});

module.exports = router;
