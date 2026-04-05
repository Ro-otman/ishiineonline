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

export async function listLatestLigueSettingsForAutomation() {
  return execute(
    `
      SELECT
        ls.id_setting,
        ls.id_classe,
        ls.id_type,
        ls.starts_at,
        ls.questions_per_subject,
        ls.margin_seconds,
        ls.break_minutes,
        ls.updated_at,
        c.nom_classe,
        COALESCE(ts.nom_type, 'Commun') AS nom_type
      FROM ligue_settings ls
      JOIN (
        SELECT
          id_classe,
          COALESCE(id_type, -1) AS type_key,
          MAX(updated_at) AS latest_updated_at
        FROM ligue_settings
        GROUP BY id_classe, COALESCE(id_type, -1)
      ) latest
        ON latest.id_classe = ls.id_classe
       AND latest.type_key = COALESCE(ls.id_type, -1)
       AND latest.latest_updated_at = ls.updated_at
      JOIN classes c ON c.id_classe = ls.id_classe
      LEFT JOIN type_series ts ON ts.id_type = ls.id_type
      ORDER BY c.nom_classe ASC, nom_type ASC
    `,
    [],
  );
}
