import { execute } from '../config/db.js';

export async function getLatestLigueSettings({ id_classe, id_type }) {
  const byType = await execute(
    `
      SELECT
        starts_at,
        questions_per_subject,
        margin_seconds,
        break_minutes,
        updated_at
      FROM ligue_settings
      WHERE id_classe = ? AND id_type = ?
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [id_classe, id_type],
  );

  if (byType.length > 0) return byType[0];

  const fallback = await execute(
    `
      SELECT
        starts_at,
        questions_per_subject,
        margin_seconds,
        break_minutes,
        updated_at
      FROM ligue_settings
      WHERE id_classe = ? AND id_type IS NULL
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    [id_classe],
  );

  return fallback[0] ?? null;
}
