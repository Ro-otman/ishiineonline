import { execute } from '../config/db.js';

export async function getUserById(id_users) {
  const rows = await execute('SELECT * FROM users WHERE id_users = ? LIMIT 1', [id_users]);
  return rows[0] ?? null;
}

export async function getUserByEmail(email) {
  const safeEmail = String(email ?? '').trim();
  if (!safeEmail) return null;
  const rows = await execute(
    'SELECT * FROM users WHERE LOWER(email) = LOWER(?) LIMIT 1',
    [safeEmail],
  );
  return rows[0] ?? null;
}

export async function getUserByPhone(phone) {
  const safePhone = String(phone ?? '').trim();
  if (!safePhone) return null;
  const rows = await execute('SELECT * FROM users WHERE phone = ? LIMIT 1', [
    safePhone,
  ]);
  return rows[0] ?? null;
}

export async function getUserByIdentity({ email, phone }) {
  const byEmail = await getUserByEmail(email);
  if (byEmail) return byEmail;
  return getUserByPhone(phone);
}

export async function rekeyUserId({ fromUserId, toUserId }) {
  const sourceId = String(fromUserId ?? '').trim();
  const targetId = String(toUserId ?? '').trim();
  if (!sourceId && !targetId) return null;
  if (!sourceId || !targetId || sourceId === targetId) {
    return getUserById(targetId || sourceId);
  }

  await execute('UPDATE users SET id_users = ? WHERE id_users = ?', [
    targetId,
    sourceId,
  ]);
  return getUserById(targetId);
}

export async function activateUserSubscription({ userId, durationDays = 30 }) {
  const safeUserId = String(userId ?? '').trim();
  if (!safeUserId) return null;

  const now = new Date();
  const expiry = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  await execute(
    `
      UPDATE users
      SET
        is_subscribed = 1,
        subscription_date = ?,
        subscription_expiry = ?
      WHERE id_users = ?
    `,
    [now.toISOString(), expiry.toISOString(), safeUserId],
  );

  return getUserById(safeUserId);
}

export async function upsertUser(user) {
  await execute(
    `
      INSERT INTO users (
        id_users,
        nom,
        prenoms,
        email,
        classe,
        phone,
        img_path,
        is_subscribed,
        subscription_date,
        subscription_expiry,
        first_use_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        nom = VALUES(nom),
        prenoms = VALUES(prenoms),
        email = VALUES(email),
        classe = VALUES(classe),
        phone = VALUES(phone),
        img_path = COALESCE(VALUES(img_path), img_path),
        is_subscribed = VALUES(is_subscribed),
        subscription_date = VALUES(subscription_date),
        subscription_expiry = VALUES(subscription_expiry),
        first_use_time = COALESCE(first_use_time, VALUES(first_use_time))
    `,
    [
      user.id_users,
      user.nom,
      user.prenoms,
      user.email,
      user.classe,
      user.phone,
      user.img_path,
      user.is_subscribed,
      user.subscription_date,
      user.subscription_expiry,
      user.first_use_time,
    ],
  );

  return getUserById(user.id_users);
}
