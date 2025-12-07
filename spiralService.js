/**
 * Identity Spiral Service
 * 
 * Calculates psychological continuity from existing reflection data:
 * - Memory continuity: From Continuity Tracker entries
 * - Intention continuity: From goal tracking & nudge follow-through
 * - Value continuity: From ethical reflections vs. actual behaviors
 * - Narrative continuity: From coherence of daily reflections
 */

const db = require('../db');

/**
 * Calculate psychological continuity dimensions for a given date
 * @param {number} userId
 * @param {string} date - YYYY-MM-DD format
 * @returns {object} - { memory_continuity, intention_continuity, value_continuity, narrative_continuity, overall_unity }
 */
async function calculateContinuity(userId, date) {
  try {
    // 1. MEMORY CONTINUITY: How connected are today's reflections to past patterns?
    // Query past 7 days of presence index to measure consistency
    const memoryQuery = `
      SELECT 
        COUNT(*) as reflection_count,
        AVG(CASE WHEN presence_score > 0.6 THEN 1 ELSE 0 END) as consistency
      FROM presence_index
      WHERE user_id = $1 
      AND date >= DATE($2) - INTERVAL '7 days'
      AND date <= $2;
    `;
    const memoryResult = await db.query(memoryQuery, [userId, date]);
    const memoryData = memoryResult.rows[0];
    // If user has been consistent with reflections, memory continuity is high
    const memory_continuity = memoryData.reflection_count > 5 
      ? (memoryData.consistency || 0.5)
      : Math.min(memoryData.reflection_count / 7, 1.0);

    // 2. INTENTION CONTINUITY: Am I following through on commitments?
    // Check nudge follow-through rate (nudges marked as "addressed")
    const intentionQuery = `
      SELECT 
        COUNT(*) as total_nudges,
        SUM(CASE WHEN is_addressed THEN 1 ELSE 0 END) as addressed_nudges
      FROM ethical_nudges
      WHERE user_id = $1
      AND created_at >= DATE($2) - INTERVAL '30 days'
      AND created_at <= DATE($2);
    `;
    const intentionResult = await db.query(intentionQuery, [userId, date]);
    const intentionData = intentionResult.rows[0];
    const intention_continuity = intentionData.total_nudges > 0
      ? (intentionData.addressed_nudges / intentionData.total_nudges)
      : 0.5;

    // 3. VALUE CONTINUITY: Are my reflections aligned with stated values?
    // Compare ethical reflections count vs days lived
    const valueQuery = `
      SELECT 
        COUNT(*) as reflection_count
      FROM ethical_reflections
      WHERE user_id = $1
      AND created_at >= DATE($2) - INTERVAL '7 days'
      AND created_at <= DATE($2);
    `;
    const valueResult = await db.query(valueQuery, [userId, date]);
    const valueData = valueResult.rows[0];
    // If user does 5+ ethical reflections per week, value continuity is strong
    const value_continuity = Math.min((valueData.reflection_count || 0) / 5, 1.0);

    // 4. NARRATIVE CONTINUITY: Does my day have coherence/story?
    // Measured by: presence_index score (how "present" was I) + reflection depth
    const narrativeQuery = `
      SELECT 
        AVG(presence_score) as avg_presence,
        COUNT(*) as entry_count
      FROM presence_index
      WHERE user_id = $1 AND date = $2;
    `;
    const narrativeResult = await db.query(narrativeQuery, [userId, date]);
    const narrativeData = narrativeResult.rows[0];
    // High presence + consistent tracking = narrative coherence
    const narrative_continuity = narrativeData.entry_count > 2
      ? (narrativeData.avg_presence || 0.5)
      : 0.4;

    // Calculate overall unity as simple average
    const overall_unity = (memory_continuity + intention_continuity + value_continuity + narrative_continuity) / 4;

    return {
      memory_continuity: Math.min(Math.max(memory_continuity, 0), 1),
      intention_continuity: Math.min(Math.max(intention_continuity, 0), 1),
      value_continuity: Math.min(Math.max(value_continuity, 0), 1),
      narrative_continuity: Math.min(Math.max(narrative_continuity, 0), 1),
      overall_unity: Math.min(Math.max(overall_unity, 0), 1)
    };
  } catch (error) {
    console.error('[Identity Spiral] Calculation error:', error.message);
    // Return neutral defaults on error
    return {
      memory_continuity: 0.5,
      intention_continuity: 0.5,
      value_continuity: 0.5,
      narrative_continuity: 0.5,
      overall_unity: 0.5
    };
  }
}

/**
 * Store or update identity spiral for a date
 */
async function saveSpiral(userId, date, continuityData) {
  try {
    const query = `
      INSERT INTO identity_spiral 
      (user_id, date, memory_continuity, intention_continuity, value_continuity, narrative_continuity, overall_unity, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (user_id, date) 
      DO UPDATE SET
        memory_continuity = $3,
        intention_continuity = $4,
        value_continuity = $5,
        narrative_continuity = $6,
        overall_unity = $7,
        updated_at = NOW()
      RETURNING *;
    `;
    const result = await db.query(query, [
      userId,
      date,
      continuityData.memory_continuity,
      continuityData.intention_continuity,
      continuityData.value_continuity,
      continuityData.narrative_continuity,
      continuityData.overall_unity
    ]);
    return result.rows[0];
  } catch (error) {
    console.error('[Identity Spiral] Save error:', error.message);
    throw error;
  }
}

/**
 * Get spiral data for a date (or generate if not exists)
 */
async function getSpiral(userId, date) {
  try {
    const query = `
      SELECT * FROM identity_spiral
      WHERE user_id = $1 AND date = $2;
    `;
    const result = await db.query(query, [userId, date]);
    
    if (result.rows.length > 0) {
      return result.rows[0];
    }

    // Generate on-demand if not cached
    const continuity = await calculateContinuity(userId, date);
    return await saveSpiral(userId, date, continuity);
  } catch (error) {
    console.error('[Identity Spiral] Get error:', error.message);
    throw error;
  }
}

/**
 * Get spiral trend for past N days
 */
async function getSpiralTrend(userId, days = 30) {
  try {
    const query = `
      SELECT 
        date,
        memory_continuity,
        intention_continuity,
        value_continuity,
        narrative_continuity,
        overall_unity
      FROM identity_spiral
      WHERE user_id = $1
      AND date >= CURRENT_DATE - INTERVAL '1 day' * $2
      ORDER BY date ASC;
    `;
    const result = await db.query(query, [userId, days]);
    return result.rows;
  } catch (error) {
    console.error('[Identity Spiral] Trend error:', error.message);
    throw error;
  }
}

module.exports = {
  calculateContinuity,
  saveSpiral,
  getSpiral,
  getSpiralTrend
};
