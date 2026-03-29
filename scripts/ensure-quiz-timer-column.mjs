import { getPool } from '../config/db.js';

const pool = getPool();

try {
  const [rows] = await pool.query("SHOW COLUMNS FROM quiz_explanations LIKE 'timer_seconds'");
  if (Array.isArray(rows) && rows.length > 0) {
    console.log('timer_seconds_exists');
  } else {
    await pool.query("ALTER TABLE quiz_explanations ADD COLUMN timer_seconds INT NULL AFTER difficulty");
    console.log('timer_seconds_added');
  }
} finally {
  await pool.end();
}
