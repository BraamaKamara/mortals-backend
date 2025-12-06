// Database connection pool for PostgreSQL
const { Pool } = require('pg');

// Create connection pool - use DATABASE_URL if available, otherwise fall back to localhost
const pool = new Pool(
  process.env.DATABASE_URL 
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false },
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
    : {
        host: '127.0.0.1',
        port: 5432,
        database: 'mortals_dashboard',
        user: 'postgres',
        password: 'Surake305',
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
      }
);

// Test connection on startup
pool.on('connect', () => {
  console.log('[Database] Connected to PostgreSQL');
});

pool.on('error', (err) => {
  console.error('⚠️ Unexpected error on idle client:', err);
  // Don't exit - just log the error
  // process.exit(-1);
});

// Helper function to execute queries
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.warn(`[Database] Slow query (${duration}ms):`, text);
    }
    return res;
  } catch (error) {
    console.error('[Database] Query error:', error.message);
    console.error('[Database] Query:', text);
    throw error;
  }
}

// Helper to get a client from the pool (for transactions)
async function getClient() {
  return await pool.connect();
}

module.exports = {
  query,
  getClient,
  pool
};
