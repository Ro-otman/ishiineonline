import { getPool } from '../config/db.js';
import { seedMissingSaReleaseSchedules } from '../models/saReleaseSchedule.model.js';

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.query(
    `SHOW COLUMNS FROM \`${tableName}\` LIKE ?`,
    [columnName],
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.query(
    `SHOW INDEX FROM \`${tableName}\` WHERE Key_name = ?`,
    [indexName],
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function hasConstraint(connection, tableName, constraintName) {
  const [rows] = await connection.query(
    `
      SELECT CONSTRAINT_NAME
      FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = ?
      LIMIT 1
    `,
    [tableName, constraintName],
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureSaReleaseScheduleTable(connection) {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS sa_release_schedule (
      id_release INT AUTO_INCREMENT PRIMARY KEY,
      id_sa INT NOT NULL,
      available_from_at DATETIME NULL,
      available_until_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_sa_release_schedule_sa (id_sa),
      KEY idx_sa_release_schedule_window (available_from_at, available_until_at, is_active),
      CONSTRAINT fk_sa_release_schedule_sa FOREIGN KEY (id_sa)
        REFERENCES sa(id_sa)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function ensureWeeklyBankSaColumn(connection) {
  const hasIdSa = await hasColumn(connection, 'ligue_weekly_quiz_bank', 'id_sa');
  if (!hasIdSa) {
    await connection.query(`
      ALTER TABLE ligue_weekly_quiz_bank
      ADD COLUMN id_sa INT NULL AFTER id_matiere
    `);
  }

  await connection.query(`
    UPDATE ligue_weekly_quiz_bank bank
    JOIN quiz q ON q.id_quiz = bank.id_quiz
    SET bank.id_sa = q.id_sa
    WHERE bank.id_sa IS NULL
  `);

  const [nullRows] = await connection.query(`
    SELECT COUNT(*) AS total
    FROM ligue_weekly_quiz_bank
    WHERE id_sa IS NULL
  `);
  const nullTotal = Number(nullRows?.[0]?.total ?? 0);
  if (nullTotal > 0) {
    throw new Error(`Impossible de retro-remplir id_sa sur ${nullTotal} ligne(s) de ligue_weekly_quiz_bank.`);
  }

  await connection.query(`
    ALTER TABLE ligue_weekly_quiz_bank
    MODIFY COLUMN id_sa INT NOT NULL
  `);

  if (!(await hasIndex(connection, 'ligue_weekly_quiz_bank', 'idx_ligue_weekly_quiz_bank_sa'))) {
    await connection.query(`
      ALTER TABLE ligue_weekly_quiz_bank
      ADD KEY idx_ligue_weekly_quiz_bank_sa (id_sa)
    `);
  }

  if (!(await hasConstraint(connection, 'ligue_weekly_quiz_bank', 'fk_ligue_weekly_quiz_bank_sa'))) {
    await connection.query(`
      ALTER TABLE ligue_weekly_quiz_bank
      ADD CONSTRAINT fk_ligue_weekly_quiz_bank_sa
      FOREIGN KEY (id_sa)
      REFERENCES sa(id_sa)
      ON DELETE RESTRICT
      ON UPDATE CASCADE
    `);
  }
}

const connection = await getPool().getConnection();

try {
  await connection.beginTransaction();
  await ensureSaReleaseScheduleTable(connection);
  await ensureWeeklyBankSaColumn(connection);
  await seedMissingSaReleaseSchedules(connection);
  await connection.commit();

  const [statsRows] = await connection.query(`
    SELECT
      (SELECT COUNT(*) FROM sa_release_schedule) AS sa_release_rows,
      (SELECT COUNT(*) FROM ligue_weekly_quiz_bank) AS weekly_bank_rows
  `);

  console.log(JSON.stringify({
    ok: true,
    sa_release_rows: Number(statsRows?.[0]?.sa_release_rows ?? 0),
    weekly_bank_rows: Number(statsRows?.[0]?.weekly_bank_rows ?? 0),
  }));
} catch (error) {
  try {
    await connection.rollback();
  } catch {}
  console.error(JSON.stringify({
    ok: false,
    message: error?.message ?? String(error),
    code: error?.code ?? null,
  }));
  process.exitCode = 1;
} finally {
  connection.release();
  await getPool().end();
}
