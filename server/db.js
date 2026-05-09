const { Pool } = require('pg');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,

  ssl: isProduction
    ? { rejectUnauthorized: false }
    : false,

  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ✅ IMPORTANT FIX: prevent statement timeout crashes
pool.on('connect', (client) => {
  client.query('SET statement_timeout = 0'); // disables query killing
  client.query('SET idle_in_transaction_session_timeout = 0');
});

// optional logging
pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error:', err);
});

console.log('PostgreSQL pool initialized');

module.exports = {
  initialize: async () => {
    try {
      await pool.query('SELECT 1');
      console.log('Database connection successful');
    } catch (err) {
      console.error('Database connection failed:', err);
      throw err;
    }
  },

  query: (text, params) => pool.query(text, params),
};