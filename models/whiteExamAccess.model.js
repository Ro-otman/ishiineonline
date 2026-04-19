import { execute } from '../config/db.js';

let ensureWhiteExamAccessTablePromise = null;

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeWeekKey(value) {
  const weekKey = asString(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(weekKey) ? weekKey : '';
}

function normalizeClasseKey(value) {
  return asString(value).toLowerCase().replace(/\s+/g, ' ');
}

function toSqlDateTime(value) {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export async function ensureWhiteExamAccessTable() {
  if (!ensureWhiteExamAccessTablePromise) {
    ensureWhiteExamAccessTablePromise = execute(
      `
        CREATE TABLE IF NOT EXISTS white_exam_accesses (
          id_access BIGINT AUTO_INCREMENT PRIMARY KEY,
          transaction_id VARCHAR(128) NOT NULL,
          user_id VARCHAR(255) NOT NULL,
          week_key VARCHAR(10) NOT NULL,
          classe_name VARCHAR(191) NOT NULL,
          classe_key VARCHAR(191) NOT NULL,
          plan_key VARCHAR(64) NOT NULL DEFAULT 'white_exam_access',
          status VARCHAR(64) NOT NULL DEFAULT 'created',
          amount INT NOT NULL DEFAULT 0,
          currency_iso VARCHAR(16) NOT NULL DEFAULT 'XOF',
          approved_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_white_exam_access_tx (transaction_id),
          KEY idx_white_exam_access_user_scope (user_id, week_key, classe_key, status),
          KEY idx_white_exam_access_status_updated (status, updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      [],
    ).catch((error) => {
      ensureWhiteExamAccessTablePromise = null;
      throw error;
    });
  }

  return ensureWhiteExamAccessTablePromise;
}

export async function upsertWhiteExamAccess(record = {}) {
  const transactionId = asString(record.transactionId || record.transaction_id);
  const userId = asString(record.userId || record.user_id);
  const weekKey = normalizeWeekKey(record.weekKey || record.week_key);
  const classeName = asString(
    record.classeName || record.classe_name || record.classe,
  );
  const classeKey = normalizeClasseKey(classeName);

  if (!transactionId || !userId || !weekKey || !classeName || !classeKey) {
    return null;
  }

  await ensureWhiteExamAccessTable();

  await execute(
    `
      INSERT INTO white_exam_accesses (
        transaction_id,
        user_id,
        week_key,
        classe_name,
        classe_key,
        plan_key,
        status,
        amount,
        currency_iso,
        approved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = VALUES(user_id),
        week_key = VALUES(week_key),
        classe_name = VALUES(classe_name),
        classe_key = VALUES(classe_key),
        plan_key = VALUES(plan_key),
        status = COALESCE(NULLIF(VALUES(status), ''), status),
        amount = CASE WHEN VALUES(amount) > 0 THEN VALUES(amount) ELSE amount END,
        currency_iso = COALESCE(NULLIF(VALUES(currency_iso), ''), currency_iso),
        approved_at = COALESCE(VALUES(approved_at), approved_at),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      transactionId,
      userId,
      weekKey,
      classeName,
      classeKey,
      asString(record.planKey || record.plan_key || 'white_exam_access') ||
        'white_exam_access',
      asString(record.status || 'created') || 'created',
      Math.max(0, asInt(record.amount, 0)),
      asString(record.currencyIso || record.currency_iso || 'XOF') || 'XOF',
      toSqlDateTime(record.approvedAt || record.approved_at),
    ],
  );

  return getWhiteExamAccessByTransactionId(transactionId);
}

export async function getWhiteExamAccessByTransactionId(transactionId) {
  const safeTransactionId = asString(transactionId);
  if (!safeTransactionId) return null;
  await ensureWhiteExamAccessTable();
  const rows = await execute(
    `
      SELECT *
      FROM white_exam_accesses
      WHERE transaction_id = ?
      LIMIT 1
    `,
    [safeTransactionId],
  );
  return rows[0] ?? null;
}

export async function getWhiteExamAccessStatus({ userId, weekKey, classe }) {
  const safeUserId = asString(userId);
  const safeWeekKey = normalizeWeekKey(weekKey);
  const safeClasseKey = normalizeClasseKey(classe);
  if (!safeUserId || !safeWeekKey || !safeClasseKey) return null;

  await ensureWhiteExamAccessTable();
  const rows = await execute(
    `
      SELECT *
      FROM white_exam_accesses
      WHERE user_id = ?
        AND week_key = ?
        AND classe_key = ?
        AND status IN ('approved', 'transferred')
      ORDER BY COALESCE(approved_at, updated_at, created_at) DESC, id_access DESC
      LIMIT 1
    `,
    [safeUserId, safeWeekKey, safeClasseKey],
  );
  return rows[0] ?? null;
}
