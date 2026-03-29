import { execute } from '../config/db.js';

function inPlaceholders(list) {
  return list.map(() => '?').join(',');
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimerSeconds(value, fallback = 30) {
  const parsed = asInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export async function listLigueQuizCandidatesForMatiere({
  id_classe,
  id_type,
  id_matiere,
  eligible_at = null,
  exclude_quiz_ids = [],
  limit = null,
  seed = '',
}) {
  const safeSeed = String(seed ?? '').trim() || 'default';
  const eligibleDate = eligible_at ? new Date(eligible_at) : null;
  const safeEligibleAt = eligibleDate && !Number.isNaN(eligibleDate.getTime())
    ? eligibleDate.toISOString().slice(0, 19).replace('T', ' ')
    : null;
  const excludedQuizIds = Array.isArray(exclude_quiz_ids)
    ? exclude_quiz_ids.map((value) => asInt(value)).filter((value) => value > 0)
    : [];
  const params = [id_classe, id_matiere, id_type];

  let sql = `
    SELECT
      q.id_quiz,
      s.id_sa,
      s.nom_sa,
      COALESCE(NULLIF(qe.timer_seconds, 0), 30) AS timer_seconds
    FROM programme p
    JOIN sa s ON s.id_programme = p.id_programme
    JOIN quiz q ON q.id_sa = s.id_sa
    JOIN \`options\` o ON o.id_quiz = q.id_quiz
    LEFT JOIN quiz_explanations qe ON qe.id_quiz = q.id_quiz
    LEFT JOIN sa_release_schedule srs ON srs.id_sa = s.id_sa
    WHERE p.id_classe = ?
      AND p.id_matiere = ?
      AND (p.id_type IS NULL OR p.id_type = ?)
      AND (
        LOWER(s.nom_sa) NOT LIKE 'ligue %'
        OR NOT EXISTS (
          SELECT 1
          FROM sa s2
          JOIN quiz q2 ON q2.id_sa = s2.id_sa
          WHERE s2.id_programme = s.id_programme
            AND LOWER(s2.nom_sa) NOT LIKE 'ligue %'
        )
      )
  `;

  if (safeEligibleAt) {
    sql += `
      AND (
        srs.id_sa IS NULL
        OR (
          srs.is_active = 1
          AND (srs.available_from_at IS NULL OR srs.available_from_at <= ?)
          AND (srs.available_until_at IS NULL OR srs.available_until_at >= ?)
        )
      )
    `;
    params.push(safeEligibleAt, safeEligibleAt);
  } else {
    sql += `
      AND (
        srs.id_sa IS NULL
        OR srs.is_active = 1
      )
    `;
  }

  if (excludedQuizIds.length > 0) {
    sql += ` AND q.id_quiz NOT IN (${inPlaceholders(excludedQuizIds)})`;
    params.push(...excludedQuizIds);
  }

  sql += `
    GROUP BY q.id_quiz, s.id_sa, qe.timer_seconds
    HAVING COUNT(DISTINCT o.id_options) >= 4
       AND SUM(CASE WHEN o.is_correct = 1 THEN 1 ELSE 0 END) >= 1
    ORDER BY SHA2(CONCAT(?, ':', q.id_quiz), 256) ASC, q.id_quiz ASC
  `;
  params.push(safeSeed);

  if (limit != null) {
    const safeLimit = Math.max(1, asInt(limit, 1));
    sql += ' LIMIT ?';
    params.push(safeLimit);
  }

  const rows = await execute(sql, params);

  return rows
    .map((row) => ({
      id_quiz: asInt(row.id_quiz),
      id_sa: asInt(row.id_sa),
      sa_name: row.nom_sa,
      timer_seconds: normalizeTimerSeconds(row.timer_seconds),
    }))
    .filter((row) => row.id_quiz > 0 && row.id_sa > 0);
}

export async function getQuizzesByIds(quizIds) {
  if (!Array.isArray(quizIds) || quizIds.length === 0) return [];

  const placeholders = inPlaceholders(quizIds);
  const rows = await execute(
    `
      SELECT
        q.id_quiz,
        q.question,
        COALESCE(NULLIF(qe.timer_seconds, 0), 30) AS timer_seconds
      FROM quiz q
      LEFT JOIN quiz_explanations qe ON qe.id_quiz = q.id_quiz
      WHERE q.id_quiz IN (${placeholders})
    `,
    quizIds,
  );

  const byId = new Map(
    rows.map((row) => [
      asInt(row.id_quiz),
      {
        id_quiz: asInt(row.id_quiz),
        question: row.question,
        timer_seconds: normalizeTimerSeconds(row.timer_seconds),
      },
    ]),
  );

  return quizIds
    .map((id) => byId.get(asInt(id)))
    .filter(Boolean);
}

export async function listOptionsByQuizIds(quizIds) {
  if (!Array.isArray(quizIds) || quizIds.length === 0) return [];

  const placeholders = inPlaceholders(quizIds);
  return execute(
    `
      SELECT id_options, opt_text, id_quiz, is_correct
      FROM \`options\`
      WHERE id_quiz IN (${placeholders})
      ORDER BY id_quiz ASC, id_options ASC
    `,
    quizIds,
  );
}

export async function listCorrectOptionIdsByQuizIds(quizIds) {
  if (!Array.isArray(quizIds) || quizIds.length === 0) return new Map();

  const placeholders = inPlaceholders(quizIds);
  const rows = await execute(
    `
      SELECT id_quiz, id_options
      FROM \`options\`
      WHERE id_quiz IN (${placeholders}) AND is_correct = 1
    `,
    quizIds,
  );

  const map = new Map();
  for (const row of rows) {
    const quizId = asInt(row.id_quiz);
    const optionId = asInt(row.id_options);
    if (!quizId || !optionId) continue;
    if (!map.has(quizId)) map.set(quizId, optionId);
  }

  return map;
}

export async function getLigueQuizPayloadByIds(quizIds) {
  const quizzes = await getQuizzesByIds(quizIds);
  const optionsRows = await listOptionsByQuizIds(quizIds);

  const optionsByQuizId = new Map();
  for (const row of optionsRows) {
    const quizId = asInt(row.id_quiz);
    if (!optionsByQuizId.has(quizId)) optionsByQuizId.set(quizId, []);

    optionsByQuizId.get(quizId).push({
      id_options: asInt(row.id_options),
      opt_text: row.opt_text,
      is_correct: asInt(row.is_correct) === 1 ? 1 : 0,
    });
  }

  return quizzes.map((quiz) => ({
    id_quiz: quiz.id_quiz,
    question: quiz.question,
    timer_seconds: normalizeTimerSeconds(quiz.timer_seconds),
    options: optionsByQuizId.get(quiz.id_quiz) ?? [],
  }));
}
