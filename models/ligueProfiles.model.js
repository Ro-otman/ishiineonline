import { execute } from '../config/db.js';

export async function getLigueProfileByUserId(id_user) {
  const rows = await execute(
    'SELECT * FROM ligue_profiles WHERE id_user = ? LIMIT 1',
    [id_user],
  );
  return rows[0] ?? null;
}

export async function upsertLigueProfile(profile) {
  await execute(
    `
      INSERT INTO ligue_profiles (
        id_user,
        handle,
        salle_key,
        serie_key
      ) VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        handle = VALUES(handle),
        serie_key = VALUES(serie_key),
        updated_at = CURRENT_TIMESTAMP
    `,
    [
      profile.id_user,
      profile.handle,
      profile.salle_key,
      profile.serie_key || null,
    ],
  );

  return getLigueProfileByUserId(profile.id_user);
}
