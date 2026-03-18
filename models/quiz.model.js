import { execute } from '../config/db.js';

function inPlaceholders(list) {
  return list.map(() => '?').join(',');
}

export async function listLigueQuizIdsForMatiere({ id_classe, id_type, id_matiere, limit }) {
  const safeLimit = Number.parseInt(String(limit ?? 0), 10);

  const rows = await execute(
    `
      SELECT q.id_quiz
      FROM programme p
      JOIN sa s ON s.id_programme = p.id_programme
      JOIN quiz q ON q.id_sa = s.id_sa
      JOIN \`options\` o ON o.id_quiz = q.id_quiz
      WHERE p.id_classe = ?
        AND p.id_matiere = ?
        AND (p.id_type IS NULL OR p.id_type = ?)
      GROUP BY q.id_quiz
      HAVING SUM(o.is_correct) >= 1
      ORDER BY q.id_quiz ASC
      LIMIT ?
    `,
    [id_classe, id_matiere, id_type, safeLimit],
  );

  return rows
    .map((r) => Number(r.id_quiz))
    .filter((n) => Number.isFinite(n));
}

export async function getQuizzesByIds(quizIds) {
  if (!Array.isArray(quizIds) || quizIds.length === 0) return [];

  const placeholders = inPlaceholders(quizIds);
  const rows = await execute(
    `SELECT id_quiz, question FROM quiz WHERE id_quiz IN (${placeholders})`,
    quizIds,
  );

  const byId = new Map(
    rows.map((r) => [Number(r.id_quiz), { id_quiz: Number(r.id_quiz), question: r.question }]),
  );

  return quizIds
    .map((id) => byId.get(Number(id)))
    .filter(Boolean);
}

export async function listOptionsByQuizIds(quizIds) {
  if (!Array.isArray(quizIds) || quizIds.length === 0) return [];

  const placeholders = inPlaceholders(quizIds);
  return execute(
    `
      SELECT id_options, opt_text, id_quiz
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
    const quizId = Number(row.id_quiz);
    const optionId = Number(row.id_options);
    if (!Number.isFinite(quizId) || !Number.isFinite(optionId)) continue;
    if (!map.has(quizId)) map.set(quizId, optionId);
  }

  return map;
}

export async function getLigueQuizPayloadByIds(quizIds) {
  const quizzes = await getQuizzesByIds(quizIds);
  const optionsRows = await listOptionsByQuizIds(quizIds);

  const optionsByQuizId = new Map();
  for (const row of optionsRows) {
    const quizId = Number(row.id_quiz);
    if (!optionsByQuizId.has(quizId)) optionsByQuizId.set(quizId, []);

    optionsByQuizId.get(quizId).push({
      id_options: Number(row.id_options),
      opt_text: row.opt_text
    });
  }

  return quizzes.map((q) => ({
    id_quiz: q.id_quiz,
    question: q.question,
    options: optionsByQuizId.get(q.id_quiz) ?? []
  }));
}
