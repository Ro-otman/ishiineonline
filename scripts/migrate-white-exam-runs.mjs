import { getPool } from '../config/db.js';

async function hasTable(connection, tableName) {
  const [rows] = await connection.query(
    `
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
      LIMIT 1
    `,
    [tableName],
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureWhiteExamRunsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS white_exam_runs (
      id_run CHAR(36) PRIMARY KEY,
      week_key VARCHAR(32) NOT NULL,
      id_user VARCHAR(255) NOT NULL,
      id_classe INT NOT NULL,
      id_type INT NULL,
      id_matiere INT NOT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      submitted_at DATETIME NULL,
      total_questions INT NOT NULL,
      correct_count INT NOT NULL DEFAULT 0,
      total_response_time_ms INT NOT NULL DEFAULT 0,
      score_percent DOUBLE NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_white_exam_runs_lookup (week_key, id_user, id_classe, id_type, id_matiere),
      KEY idx_white_exam_runs_user (id_user, submitted_at),
      CONSTRAINT fk_white_exam_runs_user FOREIGN KEY (id_user)
        REFERENCES users(id_users)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_white_exam_runs_classe FOREIGN KEY (id_classe)
        REFERENCES classes(id_classe)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
      CONSTRAINT fk_white_exam_runs_type FOREIGN KEY (id_type)
        REFERENCES type_series(id_type)
        ON DELETE SET NULL
        ON UPDATE CASCADE,
      CONSTRAINT fk_white_exam_runs_matiere FOREIGN KEY (id_matiere)
        REFERENCES matieres(id_matiere)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureWhiteExamRunQuestionsTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS white_exam_run_questions (
      id_run CHAR(36) NOT NULL,
      question_index INT NOT NULL,
      id_quiz INT NOT NULL,
      timer_seconds INT NOT NULL DEFAULT 30,
      PRIMARY KEY (id_run, question_index),
      UNIQUE KEY uq_white_exam_run_questions_run_quiz (id_run, id_quiz),
      KEY idx_white_exam_run_questions_quiz (id_quiz),
      CONSTRAINT fk_white_exam_run_questions_run FOREIGN KEY (id_run)
        REFERENCES white_exam_runs(id_run)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_white_exam_run_questions_quiz FOREIGN KEY (id_quiz)
        REFERENCES quiz(id_quiz)
        ON DELETE RESTRICT
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureWhiteExamRunAnswersTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS white_exam_run_answers (
      id_run CHAR(36) NOT NULL,
      id_quiz INT NOT NULL,
      id_options INT NULL,
      is_correct TINYINT(1) NOT NULL,
      response_time_ms INT NULL,
      answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id_run, id_quiz),
      KEY idx_white_exam_run_answers_run (id_run),
      CONSTRAINT fk_white_exam_run_answers_run FOREIGN KEY (id_run)
        REFERENCES white_exam_runs(id_run)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_white_exam_run_answers_quiz FOREIGN KEY (id_quiz)
        REFERENCES quiz(id_quiz)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,
      CONSTRAINT fk_white_exam_run_answers_option FOREIGN KEY (id_options)
        REFERENCES \`options\`(id_options)
        ON DELETE SET NULL
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

const connection = await getPool().getConnection();

try {
  await connection.beginTransaction();
  await ensureWhiteExamRunsTable(connection);
  await ensureWhiteExamRunQuestionsTable(connection);
  await ensureWhiteExamRunAnswersTable(connection);
  await connection.commit();

  const [statsRows] = await connection.query(`
    SELECT
      (SELECT COUNT(*) FROM white_exam_runs) AS runs_count,
      (SELECT COUNT(*) FROM white_exam_run_questions) AS questions_count,
      (SELECT COUNT(*) FROM white_exam_run_answers) AS answers_count
  `);

  console.log(
    JSON.stringify({
      ok: true,
      tables: {
        white_exam_runs: await hasTable(connection, 'white_exam_runs'),
        white_exam_run_questions: await hasTable(
          connection,
          'white_exam_run_questions',
        ),
        white_exam_run_answers: await hasTable(
          connection,
          'white_exam_run_answers',
        ),
      },
      runs_count: Number(statsRows?.[0]?.runs_count ?? 0),
      questions_count: Number(statsRows?.[0]?.questions_count ?? 0),
      answers_count: Number(statsRows?.[0]?.answers_count ?? 0),
    }),
  );
} catch (error) {
  try {
    await connection.rollback();
  } catch {}
  console.error(
    JSON.stringify({
      ok: false,
      message: error?.message ?? String(error),
      code: error?.code ?? null,
    }),
  );
  process.exitCode = 1;
} finally {
  connection.release();
  await getPool().end();
}
