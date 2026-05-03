import { randomUUID } from 'node:crypto';

import { execute } from '../config/db.js';

let ensureNotificationsTablePromise = null;

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asNullableText(value) {
  const text = asString(value);
  return text || null;
}

function clampLimit(value, fallback = 20) {
  const parsed = Number.parseInt(asString(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 50));
}

function normalizeCategory(value) {
  const normalized = asString(value).toLowerCase();
  if (['success', 'warning', 'error'].includes(normalized)) {
    return normalized;
  }
  return 'info';
}

function safeJsonStringify(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function ensureNotificationsTable() {
  if (!ensureNotificationsTablePromise) {
    ensureNotificationsTablePromise = execute(
      `
        CREATE TABLE IF NOT EXISTS notifications (
          id_notification CHAR(36) NOT NULL,
          id_user VARCHAR(255) NOT NULL,
          category VARCHAR(32) NOT NULL DEFAULT 'info',
          title VARCHAR(160) NULL,
          message VARCHAR(500) NOT NULL,
          payload_json LONGTEXT NULL,
          dedupe_key VARCHAR(191) NULL,
          is_read TINYINT(1) NOT NULL DEFAULT 0,
          read_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id_notification),
          UNIQUE KEY uq_notifications_user_dedupe (id_user, dedupe_key),
          KEY idx_notifications_user_created (id_user, created_at),
          KEY idx_notifications_user_read (id_user, is_read, created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      [],
    ).catch((error) => {
      ensureNotificationsTablePromise = null;
      throw error;
    });
  }

  return ensureNotificationsTablePromise;
}

async function getNotificationById(idNotification) {
  const safeId = asString(idNotification);
  if (!safeId) return null;
  await ensureNotificationsTable();
  const rows = await execute(
    `
      SELECT *
      FROM notifications
      WHERE id_notification = ?
      LIMIT 1
    `,
    [safeId],
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function findNotificationByDedupeKey({ userId, dedupeKey }) {
  const safeUserId = asString(userId);
  const safeDedupeKey = asString(dedupeKey);
  if (!safeUserId || !safeDedupeKey) return null;
  await ensureNotificationsTable();
  const rows = await execute(
    `
      SELECT *
      FROM notifications
      WHERE id_user = ? AND dedupe_key = ?
      LIMIT 1
    `,
    [safeUserId, safeDedupeKey],
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function createNotification(record = {}) {
  const userId = asString(record.userId || record.id_user);
  const message = asString(record.message);
  const dedupeKey = asString(record.dedupeKey || record.dedupe_key);
  if (!userId || !message) {
    return null;
  }

  if (dedupeKey) {
    const existing = await findNotificationByDedupeKey({ userId, dedupeKey });
    if (existing) return existing;
  }

  await ensureNotificationsTable();

  const idNotification = asString(record.idNotification || record.id_notification) || randomUUID();

  try {
    await execute(
      `
        INSERT INTO notifications (
          id_notification,
          id_user,
          category,
          title,
          message,
          payload_json,
          dedupe_key,
          is_read,
          read_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        idNotification,
        userId,
        normalizeCategory(record.category),
        asNullableText(record.title),
        message,
        asNullableText(safeJsonStringify(record.payload)),
        asNullableText(dedupeKey),
        record.isRead ? 1 : 0,
        record.isRead ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null,
      ],
    );
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY' && dedupeKey) {
      return findNotificationByDedupeKey({ userId, dedupeKey });
    }
    throw error;
  }

  return getNotificationById(idNotification);
}

export async function listNotificationsForUser({
  userId,
  unreadOnly = false,
  limit = 20,
} = {}) {
  const safeUserId = asString(userId);
  if (!safeUserId) return [];
  await ensureNotificationsTable();

  const sql = unreadOnly
    ? `
        SELECT *
        FROM notifications
        WHERE id_user = ? AND is_read = 0
        ORDER BY created_at DESC, id_notification DESC
        LIMIT ?
      `
    : `
        SELECT *
        FROM notifications
        WHERE id_user = ?
        ORDER BY created_at DESC, id_notification DESC
        LIMIT ?
      `;

  return execute(sql, [safeUserId, clampLimit(limit)]);
}

export async function markNotificationRead({ notificationId, userId } = {}) {
  const safeNotificationId = asString(notificationId);
  const safeUserId = asString(userId);
  if (!safeNotificationId || !safeUserId) return null;
  await ensureNotificationsTable();

  await execute(
    `
      UPDATE notifications
      SET
        is_read = 1,
        read_at = COALESCE(read_at, UTC_TIMESTAMP())
      WHERE id_notification = ? AND id_user = ?
      LIMIT 1
    `,
    [safeNotificationId, safeUserId],
  );

  return getNotificationById(safeNotificationId);
}

export async function markAllNotificationsRead({ userId } = {}) {
  const safeUserId = asString(userId);
  if (!safeUserId) return 0;
  await ensureNotificationsTable();

  const result = await execute(
    `
      UPDATE notifications
      SET
        is_read = 1,
        read_at = COALESCE(read_at, UTC_TIMESTAMP())
      WHERE id_user = ? AND is_read = 0
    `,
    [safeUserId],
  );

  return Number(result?.affectedRows || 0);
}
