import pkg from 'pg';
const { Pool } = pkg;
import { drizzle } from 'drizzle-orm/node-postgres';

// Configure connection pool with optimized settings for concurrent users
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 2000, // Return an error after 2 seconds if connection could not be established
  maxUses: 7500, // Close connection after it has been used 7500 times
  keepAlive: true, // Enable TCP keepalive
  statement_timeout: 10000, // Timeout queries after 10 seconds
  query_timeout: 10000, // Timeout queries after 10 seconds
});

// Add event listeners for pool management
pool.on('connect', (client) => {
  console.log('New client connected to PostgreSQL');
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

pool.on('remove', (client) => {
  console.log('Client removed from pool');
});

// Export configured database instance
export const db = drizzle(pool);

// Health check function with connection validation
export async function checkDBConnection() {
  let client;
  try {
    client = await pool.connect();
    await client.query('SELECT 1'); // Verify we can actually execute queries
    return true;
  } catch (err) {
    console.error('Database connection error:', err);
    return false;
  } finally {
    if (client) client.release();
  }
}

// Graceful shutdown function with timeout
export async function closePool() {
  try {
    console.log('Closing database pool...');
    const timeout = setTimeout(() => {
      console.error('Pool shutdown timed out after 5 seconds');
      process.exit(1);
    }, 5000);

    await pool.end();
    clearTimeout(timeout);
    console.log('Database pool closed successfully');
  } catch (err) {
    console.error('Error closing pool:', err);
    process.exit(1);
  }
}
