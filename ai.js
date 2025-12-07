const OpenAI = require('openai');
const db = require('./db');

const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function ensureClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function fetchUserSnapshot(userId) {
  const [presence, continuity, nudges, reflections, presenceLog] = await Promise.all([
    db.query(
      `SELECT date, score, breakdown
       FROM presence_index
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 14`,
      [userId]
    ),
    db.query(
      `SELECT date, is_intentional, note
       FROM continuity_tracker
       WHERE user_id = $1
       ORDER BY date DESC
       LIMIT 21`,
      [userId]
    ),
    db.query(
      `SELECT nudge_type, title, message, severity, acknowledged, acknowledged_at, created_at
       FROM ethical_nudges
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 8`,
      [userId]
    ),
    db.query(
      `SELECT prompt_id, prompt_category, question, user_response, ai_insight, created_at
       FROM ethical_reflections
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 8`,
      [userId]
    ),
    db.query(
      `SELECT timestamp, presence_score, contributors
       FROM moral_presence_log
       WHERE user_id = $1
       ORDER BY timestamp DESC
       LIMIT 30`,
      [userId]
    )
  ]);

  return {
    presence: presence.rows,
    continuity: continuity.rows,
    nudges: nudges.rows,
    reflections: reflections.rows,
    moral_presence: presenceLog.rows
  };
}

function buildPrompt(snapshot) {
  const sections = [
    `Presence (last ${snapshot.presence.length}): ${JSON.stringify(snapshot.presence)}`,
    `Continuity (last ${snapshot.continuity.length}): ${JSON.stringify(snapshot.continuity)}`,
    `Nudges (last ${snapshot.nudges.length}): ${JSON.stringify(snapshot.nudges)}`,
    `Reflections (last ${snapshot.reflections.length}): ${JSON.stringify(snapshot.reflections)}`,
    `Moral Presence (last ${snapshot.moral_presence.length}): ${JSON.stringify(snapshot.moral_presence)}`
  ].join('\n');

  return `You are an ethics and reflection coach. Given the user's recent data, produce:
1) Three concise themes (bullet points)
2) One behavioral suggestion (2 sentences)
3) A confidence level (low/medium/high)
Keep it under 180 words and stay supportive.

Data:
${sections}`;
}

async function generateInsights(userId) {
  const client = ensureClient();
  const snapshot = await fetchUserSnapshot(userId);
  const prompt = buildPrompt(snapshot);

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: 'You generate concise, compassionate insights.' }, { role: 'user', content: prompt }],
    max_tokens: 320,
    temperature: 0.4
  });

  const choice = completion.choices?.[0]?.message?.content || 'No insight generated.';
  const tokens = completion.usage?.total_tokens || 0;

  return {
    snapshot,
    summary: choice.trim(),
    model: completion.model || MODEL,
    tokens_used: tokens
  };
}

module.exports = {
  generateInsights
};
