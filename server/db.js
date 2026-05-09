const { Pool } = require('pg');
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Missing DATABASE_URL. The backend requires a PostgreSQL connection string in the .env file.');
  console.error('If you are using Supabase, set DATABASE_URL to your Supabase PostgreSQL connection string, or provide SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY and update the backend accordingly.');
  process.exit(1);
}

const pool = new Pool({
  connectionString,
  max: 20,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
