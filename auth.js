// Authentication middleware and helpers
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./db');

const SALT_ROUNDS = 12;
const JWT_EXPIRY = '7d'; // 7 days

// Hash password
async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

// Verify password
async function verifyPassword(password, hash) {
  return await bcrypt.compare(password, hash);
}

// Generate JWT token
function generateToken(userId, email) {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

// Verify JWT token
function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
}

// Middleware to authenticate requests
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  // Check if session exists in database
  try {
    const session = await db.query(
      'SELECT s.*, u.email, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = $1 AND s.expires_at > NOW()',
      [token]
    );

    if (session.rows.length === 0) {
      return res.status(403).json({ error: 'Session expired or invalid' });
    }

    // Attach user info to request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      username: session.rows[0].username
    };
    req.token = token;
    next();
  } catch (error) {
    console.error('[Auth] Session verification error:', error.message);
    return res.status(500).json({ error: 'Authentication failed' });
  }
}

// Optional authentication (doesn't fail if no token)
async function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    req.user = null;
    return next();
  }

  try {
    const session = await db.query(
      'SELECT s.*, u.email, u.username FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = $1 AND s.expires_at > NOW()',
      [token]
    );

    if (session.rows.length > 0) {
      req.user = {
        id: decoded.userId,
        email: decoded.email,
        username: session.rows[0].username
      };
    } else {
      req.user = null;
    }
  } catch (error) {
    console.error('[Auth] Optional auth error:', error.message);
    req.user = null;
  }

  next();
}

// Create user session
async function createSession(userId, email) {
  const token = generateToken(userId, email);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  try {
    await db.query(
      'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, token, expiresAt]
    );
    return token;
  } catch (error) {
    console.error('[Auth] Session creation error:', error.message);
    throw error;
  }
}

// Delete session (logout)
async function deleteSession(token) {
  try {
    await db.query('DELETE FROM sessions WHERE token = $1', [token]);
  } catch (error) {
    console.error('[Auth] Session deletion error:', error.message);
    throw error;
  }
}

// Clean up expired sessions (run periodically)
async function cleanExpiredSessions() {
  try {
    const result = await db.query('DELETE FROM sessions WHERE expires_at < NOW()');
    if (result.rowCount > 0) {
      console.log(`[Auth] Cleaned up ${result.rowCount} expired sessions`);
    }
  } catch (error) {
    console.error('[Auth] Session cleanup error:', error.message);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authenticateToken,
  optionalAuth,
  createSession,
  deleteSession,
  cleanExpiredSessions
};
