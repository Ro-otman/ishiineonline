import { execute } from '../config/db.js';

let ensurePaymentsTablePromise = null;

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNullableText(value) {
  const text = asString(value);
  return text || null;
}

function toSqlDateTime(value) {
  const text = asString(value);
  if (!text) return null;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function safeJsonStringify(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

export async function ensurePaymentsTable() {
  if (!ensurePaymentsTablePromise) {
    ensurePaymentsTablePromise = execute(
      `
        CREATE TABLE IF NOT EXISTS payments (
          id_payment BIGINT AUTO_INCREMENT PRIMARY KEY,
          provider VARCHAR(32) NOT NULL DEFAULT 'fedapay',
          transaction_id VARCHAR(128) NOT NULL,
          user_id VARCHAR(255) NULL,
          plan_key VARCHAR(64) NULL,
          status VARCHAR(64) NULL,
          amount INT NOT NULL DEFAULT 0,
          currency_iso VARCHAR(16) NOT NULL DEFAULT 'XOF',
          description VARCHAR(255) NULL,
          customer_firstname VARCHAR(255) NULL,
          customer_lastname VARCHAR(255) NULL,
          customer_email VARCHAR(255) NULL,
          customer_phone VARCHAR(64) NULL,
          payment_url TEXT NULL,
          callback_url TEXT NULL,
          approved_at DATETIME NULL,
          transferred_at DATETIME NULL,
          provider_created_at DATETIME NULL,
          provider_updated_at DATETIME NULL,
          last_event_source VARCHAR(64) NULL,
          raw_payload LONGTEXT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_payments_provider_transaction (provider, transaction_id),
          KEY idx_payments_user_status (user_id, status),
          KEY idx_payments_status_updated (status, updated_at),
          KEY idx_payments_provider_updated (provider_updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `,
      [],
    ).catch((error) => {
      ensurePaymentsTablePromise = null;
      throw error;
    });
  }
  return ensurePaymentsTablePromise;
}

export async function getPaymentByTransactionId(transactionId, provider = 'fedapay') {
  const safeTransactionId = asString(transactionId);
  if (!safeTransactionId) return null;
  await ensurePaymentsTable();
  const rows = await execute(
    `
      SELECT *
      FROM payments
      WHERE provider = ? AND transaction_id = ?
      LIMIT 1
    `,
    [asString(provider) || 'fedapay', safeTransactionId],
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function upsertPaymentRecord(record = {}) {
  const provider = asString(record.provider) || 'fedapay';
  const transactionId = asString(record.transactionId || record.transaction_id);
  if (!transactionId) {
    return null;
  }

  await ensurePaymentsTable();

  await execute(
    `
      INSERT INTO payments (
        provider,
        transaction_id,
        user_id,
        plan_key,
        status,
        amount,
        currency_iso,
        description,
        customer_firstname,
        customer_lastname,
        customer_email,
        customer_phone,
        payment_url,
        callback_url,
        approved_at,
        transferred_at,
        provider_created_at,
        provider_updated_at,
        last_event_source,
        raw_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        user_id = COALESCE(VALUES(user_id), user_id),
        plan_key = COALESCE(VALUES(plan_key), plan_key),
        status = COALESCE(NULLIF(VALUES(status), ''), status),
        amount = CASE WHEN VALUES(amount) > 0 THEN VALUES(amount) ELSE amount END,
        currency_iso = COALESCE(NULLIF(VALUES(currency_iso), ''), currency_iso),
        description = COALESCE(NULLIF(VALUES(description), ''), description),
        customer_firstname = COALESCE(NULLIF(VALUES(customer_firstname), ''), customer_firstname),
        customer_lastname = COALESCE(NULLIF(VALUES(customer_lastname), ''), customer_lastname),
        customer_email = COALESCE(NULLIF(VALUES(customer_email), ''), customer_email),
        customer_phone = COALESCE(NULLIF(VALUES(customer_phone), ''), customer_phone),
        payment_url = COALESCE(NULLIF(VALUES(payment_url), ''), payment_url),
        callback_url = COALESCE(NULLIF(VALUES(callback_url), ''), callback_url),
        approved_at = COALESCE(VALUES(approved_at), approved_at),
        transferred_at = COALESCE(VALUES(transferred_at), transferred_at),
        provider_created_at = COALESCE(VALUES(provider_created_at), provider_created_at),
        provider_updated_at = COALESCE(VALUES(provider_updated_at), provider_updated_at),
        last_event_source = COALESCE(NULLIF(VALUES(last_event_source), ''), last_event_source),
        raw_payload = COALESCE(NULLIF(VALUES(raw_payload), ''), raw_payload),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      provider,
      transactionId,
      asNullableText(record.userId || record.user_id),
      asNullableText(record.planKey || record.plan_key),
      asNullableText(record.status),
      Math.max(0, asInt(record.amount, 0)),
      asString(record.currencyIso || record.currency_iso || 'XOF') || 'XOF',
      asNullableText(record.description),
      asNullableText(record.customerFirstname || record.customer_firstname),
      asNullableText(record.customerLastname || record.customer_lastname),
      asNullableText(record.customerEmail || record.customer_email),
      asNullableText(record.customerPhone || record.customer_phone),
      asNullableText(record.paymentUrl || record.payment_url),
      asNullableText(record.callbackUrl || record.callback_url),
      toSqlDateTime(record.approvedAt || record.approved_at),
      toSqlDateTime(record.transferredAt || record.transferred_at),
      toSqlDateTime(record.providerCreatedAt || record.provider_created_at),
      toSqlDateTime(record.providerUpdatedAt || record.provider_updated_at),
      asNullableText(record.lastEventSource || record.last_event_source),
      asNullableText(safeJsonStringify(record.rawPayload ?? record.raw_payload)),
    ],
  );

  return getPaymentByTransactionId(transactionId, provider);
}

async function getPaymentsMetrics() {
  await ensurePaymentsTable();
  const rows = await execute(
    `
      SELECT
        COUNT(*) AS total_payments,
        COALESCE(SUM(CASE WHEN status IN ('approved', 'transferred') THEN amount ELSE 0 END), 0) AS gross_revenue,
        COALESCE(SUM(CASE WHEN status = 'transferred' THEN amount ELSE 0 END), 0) AS transferred_revenue,
        COALESCE(SUM(CASE WHEN status IN ('approved', 'transferred') AND COALESCE(provider_updated_at, updated_at, created_at) >= DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-01 00:00:00') THEN amount ELSE 0 END), 0) AS month_revenue,
        COALESCE(SUM(CASE WHEN status IN ('approved', 'transferred') THEN 1 ELSE 0 END), 0) AS successful_payments,
        COALESCE(SUM(CASE WHEN status IN ('pending', 'created', 'initiated') THEN 1 ELSE 0 END), 0) AS pending_payments,
        COALESCE(SUM(CASE WHEN status NOT IN ('approved', 'transferred', 'pending', 'created', 'initiated') THEN 1 ELSE 0 END), 0) AS failed_payments
      FROM payments
      WHERE provider = 'fedapay'
    `,
    [],
  );
  return rows[0] ?? {};
}

async function listRecentPayments(limit = 24) {
  await ensurePaymentsTable();
  return execute(
    `
      SELECT
        p.id_payment,
        p.transaction_id,
        p.user_id,
        p.plan_key,
        p.status,
        p.amount,
        p.currency_iso,
        p.customer_firstname,
        p.customer_lastname,
        p.customer_email,
        p.customer_phone,
        p.payment_url,
        p.callback_url,
        p.approved_at,
        p.transferred_at,
        p.provider_created_at,
        p.provider_updated_at,
        p.last_event_source,
        p.created_at,
        p.updated_at,
        u.prenoms,
        u.nom,
        u.email AS user_email,
        u.classe
      FROM payments p
      LEFT JOIN users u ON u.id_users = p.user_id
      WHERE p.provider = 'fedapay'
      ORDER BY COALESCE(p.provider_updated_at, p.updated_at, p.created_at) DESC, p.id_payment DESC
      LIMIT ?
    `,
    [Math.max(1, asInt(limit, 24))],
  );
}

export async function getPaymentsDashboardData(limit = 24) {
  const [metrics, recentPayments] = await Promise.all([
    getPaymentsMetrics(),
    listRecentPayments(limit),
  ]);

  return {
    metrics: {
      totalPayments: asInt(metrics.total_payments, 0),
      grossRevenue: asInt(metrics.gross_revenue, 0),
      transferredRevenue: asInt(metrics.transferred_revenue, 0),
      monthRevenue: asInt(metrics.month_revenue, 0),
      successfulPayments: asInt(metrics.successful_payments, 0),
      pendingPayments: asInt(metrics.pending_payments, 0),
      failedPayments: asInt(metrics.failed_payments, 0),
    },
    recentPayments,
  };
}
