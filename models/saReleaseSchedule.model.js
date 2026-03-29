import { getPool } from '../config/db.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toSqlDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function resolveProgrammeScheduleBase(connection, idProgramme) {
  const [programmeRows] = await connection.execute(
    `
      SELECT id_classe, id_type
      FROM programme
      WHERE id_programme = ?
      LIMIT 1
    `,
    [idProgramme],
  );
  const programme = Array.isArray(programmeRows) ? programmeRows[0] : null;
  if (!programme) return null;

  const [settingRows] = await connection.execute(
    `
      SELECT starts_at
      FROM ligue_settings
      WHERE id_classe = ?
        AND (
          (? IS NULL AND id_type IS NULL)
          OR id_type = ?
        )
      ORDER BY updated_at DESC, id_setting DESC
      LIMIT 1
    `,
    [programme.id_classe, programme.id_type, programme.id_type],
  );

  const startsAt = Array.isArray(settingRows) ? settingRows[0]?.starts_at : null;
  const parsed = startsAt ? new Date(startsAt) : null;
  return parsed instanceof Date && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export async function ensureSaReleaseScheduleForSa(
  connection,
  { id_sa, id_programme },
) {
  const safeSaId = asInt(id_sa);
  const safeProgrammeId = asInt(id_programme);
  if (!safeSaId || !safeProgrammeId) return null;

  const [existingRows] = await connection.execute(
    `
      SELECT id_release, id_sa, available_from_at, available_until_at, is_active
      FROM sa_release_schedule
      WHERE id_sa = ?
      LIMIT 1
    `,
    [safeSaId],
  );
  if (Array.isArray(existingRows) && existingRows[0]) {
    return existingRows[0];
  }

  const [latestRows] = await connection.execute(
    `
      SELECT srs.available_from_at
      FROM sa s
      JOIN sa_release_schedule srs ON srs.id_sa = s.id_sa
      WHERE s.id_programme = ?
      ORDER BY srs.available_from_at DESC, srs.id_release DESC
      LIMIT 1
    `,
    [safeProgrammeId],
  );
  const [countRows] = await connection.execute(
    `
      SELECT COUNT(*) AS total_rows
      FROM sa s
      JOIN sa_release_schedule srs ON srs.id_sa = s.id_sa
      WHERE s.id_programme = ?
    `,
    [safeProgrammeId],
  );

  let availableFrom = null;
  const latestAvailableFrom = Array.isArray(latestRows)
    ? latestRows[0]?.available_from_at
    : null;
  const totalExistingRows = asInt(
    Array.isArray(countRows) ? countRows[0]?.total_rows : 0,
    0,
  );
  if (latestAvailableFrom) {
    const parsedLatest = new Date(latestAvailableFrom);
    if (!Number.isNaN(parsedLatest.getTime())) {
      availableFrom = new Date(parsedLatest.getTime() + WEEK_MS);
    }
  }

  if (!availableFrom) {
    const baseDate = await resolveProgrammeScheduleBase(connection, safeProgrammeId);
    if (baseDate) {
      availableFrom = totalExistingRows > 0
        ? new Date(baseDate.getTime() + totalExistingRows * WEEK_MS)
        : baseDate;
    }
  }

  const sqlAvailableFrom = toSqlDateTime(availableFrom);
  const [result] = await connection.execute(
    `
      INSERT INTO sa_release_schedule (
        id_sa,
        available_from_at,
        available_until_at,
        is_active
      ) VALUES (?, ?, NULL, 1)
    `,
    [safeSaId, sqlAvailableFrom],
  );

  return {
    id_release: Number(result.insertId),
    id_sa: safeSaId,
    available_from_at: sqlAvailableFrom,
    available_until_at: null,
    is_active: 1,
  };
}

export async function seedMissingSaReleaseSchedules(connection) {
  const [programmeRows] = await connection.execute(
    `
      SELECT id_programme
      FROM programme
      ORDER BY id_programme ASC
    `,
  );

  for (const programme of Array.isArray(programmeRows) ? programmeRows : []) {
    const programmeId = asInt(programme.id_programme);
    if (!programmeId) continue;

    const [saRows] = await connection.execute(
      `
        SELECT id_sa
        FROM sa
        WHERE id_programme = ?
        ORDER BY id_sa ASC
      `,
      [programmeId],
    );

    for (const sa of Array.isArray(saRows) ? saRows : []) {
      await ensureSaReleaseScheduleForSa(connection, {
        id_sa: sa.id_sa,
        id_programme: programmeId,
      });
    }
  }
}

export async function getSaReleaseScheduleBySaId(id_sa) {
  const safeSaId = asInt(id_sa);
  if (!safeSaId) return null;

  const [rows] = await getPool().execute(
    `
      SELECT id_release, id_sa, available_from_at, available_until_at, is_active
      FROM sa_release_schedule
      WHERE id_sa = ?
      LIMIT 1
    `,
    [safeSaId],
  );

  return Array.isArray(rows) ? rows[0] ?? null : null;
}
