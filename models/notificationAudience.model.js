import { execute } from '../config/db.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeSalleKey(raw) {
  const clean = asString(raw);
  if (!clean) return '';

  const root = clean.split('/')[0].trim();
  const lower = root.toLowerCase();
  if (lower.startsWith('3')) return '3eme';
  if (lower.startsWith('2')) return '2nde';
  if (lower.startsWith('1')) return '1ere';
  if (lower.includes('tle') || lower.includes('term')) return 'Tle';
  return root;
}

function normalizeTypeKey(raw) {
  return asString(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function seriesKeysForType(typeName) {
  const safeType = normalizeTypeKey(typeName);
  if (!safeType || safeType === 'commun') return [];
  if (safeType === 'scientifique') return ['C', 'D'];
  if (safeType === 'litteraire') return ['A1', 'A2'];
  if (safeType === 'economique') return ['B'];
  return [];
}

export async function listLigueRecipientsForSetting({ className, typeName } = {}) {
  const salleKey = normalizeSalleKey(className);
  if (!salleKey) return [];

  const serieKeys = seriesKeysForType(typeName);
  const params = [salleKey];

  let sql = `
    SELECT
      u.id_users,
      u.nom,
      u.prenoms,
      u.email,
      u.phone,
      u.classe,
      u.is_subscribed,
      u.subscription_expiry,
      lp.handle,
      lp.salle_key,
      lp.serie_key
    FROM ligue_profiles lp
    JOIN users u ON u.id_users = lp.id_user
    WHERE lp.salle_key = ?
  `;

  if (serieKeys.length > 0) {
    sql += ` AND UPPER(COALESCE(lp.serie_key, '')) IN (${serieKeys.map(() => '?').join(', ')})`;
    params.push(...serieKeys);
  } else {
    sql += " AND (lp.serie_key IS NULL OR TRIM(lp.serie_key) = '' OR UPPER(lp.serie_key) = '3EME')";
  }

  sql += ' ORDER BY u.id_users ASC';
  return execute(sql, params);
}

export async function listUsersWithSubscriptionDates() {
  return execute(
    `
      SELECT
        id_users,
        nom,
        prenoms,
        email,
        phone,
        classe,
        is_subscribed,
        subscription_expiry
      FROM users
      WHERE subscription_expiry IS NOT NULL
      ORDER BY subscription_expiry ASC, id_users ASC
    `,
    [],
  );
}

export async function listUsersDueForReviewReminders({ dueBefore = new Date().toISOString() } = {}) {
  const safeDueBefore = asString(dueBefore) || new Date().toISOString();

  return execute(
    `
      SELECT
        u.id_users,
        u.nom,
        u.prenoms,
        u.email,
        u.phone,
        u.classe,
        u.is_subscribed,
        u.subscription_expiry,
        COUNT(DISTINCT ri.id_review) AS due_reviews,
        MIN(ri.next_review_at) AS next_review_at
      FROM users u
      JOIN review_items ri
        ON ri.id_user = u.id_users
       AND ri.next_review_at <= ?
      JOIN device_push_tokens dpt
        ON dpt.id_user = u.id_users
       AND dpt.is_active = 1
      GROUP BY
        u.id_users,
        u.nom,
        u.prenoms,
        u.email,
        u.phone,
        u.classe,
        u.is_subscribed,
        u.subscription_expiry
      ORDER BY due_reviews DESC, next_review_at ASC, u.id_users ASC
    `,
    [safeDueBefore],
  );
}

export async function getUserDueForReviewReminder({
  userId,
  dueBefore = new Date().toISOString(),
} = {}) {
  const safeUserId = asString(userId);
  const safeDueBefore = asString(dueBefore) || new Date().toISOString();
  if (!safeUserId) return null;

  const rows = await execute(
    `
      SELECT
        u.id_users,
        u.nom,
        u.prenoms,
        u.email,
        u.phone,
        u.classe,
        u.is_subscribed,
        u.subscription_expiry,
        COUNT(DISTINCT ri.id_review) AS due_reviews,
        MIN(ri.next_review_at) AS next_review_at
      FROM users u
      JOIN review_items ri
        ON ri.id_user = u.id_users
       AND ri.next_review_at <= ?
      WHERE u.id_users = ?
      GROUP BY
        u.id_users,
        u.nom,
        u.prenoms,
        u.email,
        u.phone,
        u.classe,
        u.is_subscribed,
        u.subscription_expiry
      LIMIT 1
    `,
    [safeDueBefore, safeUserId],
  );

  return rows[0] ?? null;
}

export async function listUsersForCampaign({ audience = 'all' } = {}) {
  const safeAudience = asString(audience).toLowerCase() || 'all';

  if (safeAudience === 'ligue') {
    return execute(
      `
        SELECT DISTINCT
          u.id_users,
          u.nom,
          u.prenoms,
          u.email,
          u.phone,
          u.classe,
          u.is_subscribed,
          u.subscription_expiry
        FROM users u
        JOIN ligue_profiles lp ON lp.id_user = u.id_users
        ORDER BY u.id_users ASC
      `,
      [],
    );
  }

  if (safeAudience === 'subscribed') {
    return execute(
      `
        SELECT
          id_users,
          nom,
          prenoms,
          email,
          phone,
          classe,
          is_subscribed,
          subscription_expiry
        FROM users
        WHERE is_subscribed = 1
        ORDER BY id_users ASC
      `,
      [],
    );
  }

  return execute(
    `
      SELECT
        id_users,
        nom,
        prenoms,
        email,
        phone,
        classe,
        is_subscribed,
        subscription_expiry
      FROM users
      ORDER BY id_users ASC
    `,
    [],
  );
}
