#!/usr/bin/env node

/**
 * Migration: Create identity_spiral table for McMahan philosophical metrics
 * 
 * Tracks four dimensions of psychological continuity:
 * - Memory continuity: Do I remember my past selves?
 * - Intention continuity: Am I following through on my commitments?
 * - Value continuity: Am I living by my stated values?
 * - Narrative continuity: Does my day make sense as a coherent story?
 * 
 * Each dimension scores 0-1. Overall unity is the average.
 */

const db = require('./db');

async function migrate() {
  try {
    console.log('[Identity Spiral] Starting migration...');

    // Create identity_spiral table
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS identity_spiral (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        
        -- Four dimensions of psychological continuity (0-1 scale)
        memory_continuity FLOAT DEFAULT 0.5,        -- Do I remember my past?
        intention_continuity FLOAT DEFAULT 0.5,     -- Am I following commitments?
        value_continuity FLOAT DEFAULT 0.5,         -- Am I living by my values?
        narrative_continuity FLOAT DEFAULT 0.5,     -- Does my story cohere?
        
        -- Aggregate unity score (average of four dimensions)
        overall_unity FLOAT DEFAULT 0.5,
        
        -- Metadata
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        -- Ensure one spiral per user per day
        UNIQUE(user_id, date),
        INDEX idx_user_date (user_id, date)
      );
    `;

    await db.query(createTableQuery);
    console.log('[Identity Spiral] ✅ Table created: identity_spiral');

    // Create index for efficient queries
    const indexQuery = `
      CREATE INDEX IF NOT EXISTS idx_identity_spiral_user_date 
      ON identity_spiral(user_id, date DESC);
    `;
    await db.query(indexQuery);
    console.log('[Identity Spiral] ✅ Index created');

    console.log('[Identity Spiral] Migration complete!');
    process.exit(0);
  } catch (error) {
    console.error('[Identity Spiral] Migration failed:', error.message);
    process.exit(1);
  }
}

migrate();
