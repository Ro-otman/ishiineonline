import { getPool } from '../config/db.js';

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SHOW COLUMNS FROM ${tableName} LIKE ?`,
    [columnName],
  );
  return Array.isArray(rows) && rows.length > 0;
}

const pool = getPool();
const connection = await pool.getConnection();

try {
  await connection.beginTransaction();

  const hasBreakMinutes = await columnExists(connection, 'ligue_settings', 'break_minutes');
  const hasBreakSeconds = await columnExists(connection, 'ligue_settings', 'break_seconds');
  const hasSecondsPerQuestion = await columnExists(connection, 'ligue_settings', 'seconds_per_question');

  if (!hasBreakMinutes) {
    await connection.query(
      'ALTER TABLE ligue_settings ADD COLUMN break_minutes INT NOT NULL DEFAULT 0 AFTER margin_seconds',
    );
  }

  if (hasBreakSeconds) {
    await connection.query(
      `
        UPDATE ligue_settings
        SET break_minutes = CASE
          WHEN break_seconds IS NULL OR break_seconds <= 0 THEN 0
          ELSE CEIL(break_seconds / 60)
        END
      `,
    );
    await connection.query('ALTER TABLE ligue_settings DROP COLUMN break_seconds');
  }

  if (hasSecondsPerQuestion) {
    await connection.query('ALTER TABLE ligue_settings DROP COLUMN seconds_per_question');
  }

  await connection.query(`
    CREATE TABLE IF NOT EXISTS ligue_weekly_quiz_bank (
      week_key VARCHAR(32) NOT NULL,
      id_classe INT NOT NULL,
      id_serie INT NOT NULL,
      id_matiere INT NOT NULL,
      question_index INT NOT NULL,
      id_quiz INT NOT NULL,
      timer_seconds INT NOT NULL DEFAULT 30,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (week_key, id_classe, id_serie, id_matiere, question_index),
      UNIQUE KEY uq_ligue_weekly_quiz_bank_quiz (week_key, id_classe, id_serie, id_matiere, id_quiz),
      KEY idx_ligue_weekly_quiz_bank_lookup (week_key, id_classe, id_serie, id_matiere),
      CONSTRAINT fk_ligue_weekly_quiz_bank_classe FOREIGN KEY (id_classe)
        REFERENCES classes(id_classe)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_ligue_weekly_quiz_bank_serie FOREIGN KEY (id_serie)
        REFERENCES series(id_serie)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_ligue_weekly_quiz_bank_matiere FOREIGN KEY (id_matiere)
        REFERENCES matieres(id_matiere)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_ligue_weekly_quiz_bank_quiz FOREIGN KEY (id_quiz)
        REFERENCES quiz(id_quiz)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const hasRunTimer = await columnExists(connection, 'ligue_run_questions', 'timer_seconds');
  if (!hasRunTimer) {
    await connection.query(
      'ALTER TABLE ligue_run_questions ADD COLUMN timer_seconds INT NOT NULL DEFAULT 30 AFTER id_quiz',
    );
  }

  await connection.query(`
    UPDATE ligue_run_questions rq
    LEFT JOIN quiz_explanations qe ON qe.id_quiz = rq.id_quiz
    SET rq.timer_seconds = COALESCE(NULLIF(qe.timer_seconds, 0), rq.timer_seconds, 30)
    WHERE rq.timer_seconds IS NULL OR rq.timer_seconds <= 0 OR rq.timer_seconds = 30
  `);

  await connection.commit();
  console.log('ligue_per_quiz_timers_migration_ok');
} catch (error) {
  try {
    await connection.rollback();
  } catch {}
  console.error('ligue_per_quiz_timers_migration_failed', {
    message: error?.message,
    code: error?.code,
    sqlMessage: error?.sqlMessage,
  });
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
