import { execute } from '../config/db.js';

export async function getLigueRunById(id_run) {
  const rows = await execute('SELECT * FROM ligue_runs WHERE id_run = ? LIMIT 1', [id_run]);
  return rows[0] ?? null;
}

export async function getLigueRunByUnique({ week_key, id_user, id_classe, id_serie, id_matiere }) {
  const rows = await execute(
    `
      SELECT *
      FROM ligue_runs
      WHERE week_key = ?
        AND id_user = ?
        AND id_classe = ?
        AND id_serie = ?
        AND id_matiere = ?
      LIMIT 1
    `,
    [week_key, id_user, id_classe, id_serie, id_matiere],
  );

  return rows[0] ?? null;
}

export async function createLigueRun({ id_run, week_key, id_user, id_classe, id_serie, id_matiere, total_questions }) {
  await execute(
    `
      INSERT INTO ligue_runs (
        id_run,
        week_key,
        id_user,
        id_classe,
        id_serie,
        id_matiere,
        total_questions
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [id_run, week_key, id_user, id_classe, id_serie, id_matiere, total_questions],
  );

  return getLigueRunById(id_run);
}

export async function listLigueRunQuestions(id_run) {
  const rows = await execute(
    `
      SELECT question_index, id_quiz
      FROM ligue_run_questions
      WHERE id_run = ?
      ORDER BY question_index ASC
    `,
    [id_run],
  );

  return rows.map((r) => ({
    question_index: Number(r.question_index),
    id_quiz: Number(r.id_quiz)
  }));
}

export async function insertLigueRunQuestions(id_run, quizIds) {
  if (!Array.isArray(quizIds) || quizIds.length === 0) return;

  const values = [];
  const placeholders = quizIds
    .map((quizId, index) => {
      values.push(id_run, index, quizId);
      return '(?, ?, ?)';
    })
    .join(',');

  await execute(
    `
      INSERT INTO ligue_run_questions (id_run, question_index, id_quiz)
      VALUES ${placeholders}
    `,
    values,
  );
}

export async function insertLigueRunAnswers(id_run, answers) {
  if (!Array.isArray(answers) || answers.length === 0) return;

  const values = [];
  const placeholders = answers
    .map((a) => {
      values.push(id_run, a.id_quiz, a.id_options, a.is_correct, a.response_time_ms);
      return '(?, ?, ?, ?, ?)';
    })
    .join(',');

  await execute(
    `
      INSERT INTO ligue_run_answers (
        id_run,
        id_quiz,
        id_options,
        is_correct,
        response_time_ms
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        id_options = VALUES(id_options),
        is_correct = VALUES(is_correct),
        response_time_ms = VALUES(response_time_ms),
        answered_at = CURRENT_TIMESTAMP
    `,
    values,
  );
}

export async function finalizeLigueRun({ id_run, correct_count, total_response_time_ms, score_percent }) {
  await execute(
    `
      UPDATE ligue_runs
      SET
        submitted_at = CURRENT_TIMESTAMP,
        correct_count = ?,
        total_response_time_ms = ?,
        score_percent = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id_run = ?
        AND submitted_at IS NULL
    `,
    [correct_count, total_response_time_ms, score_percent, id_run],
  );

  return getLigueRunById(id_run);
}

export async function getLigueLeaderboard({ week_key, id_classe, id_serie, limit = 50 }) {
  const safeLimit = Number.parseInt(String(limit ?? 50), 10);

  const rows = await execute(
    `
      SELECT
        lr.id_user,
        u.nom,
        u.prenoms,
        u.img_path,
        SUM(lr.correct_count) AS correct_total,
        SUM(lr.total_questions) AS questions_total,
        SUM(lr.total_response_time_ms) AS time_total,
        COUNT(*) AS subjects_played,
        (SUM(lr.correct_count) / NULLIF(SUM(lr.total_questions), 0)) * 100 AS score_percent
      FROM ligue_runs lr
      JOIN users u ON u.id_users = lr.id_user
      WHERE lr.week_key = ?
        AND lr.id_classe = ?
        AND lr.id_serie = ?
        AND lr.submitted_at IS NOT NULL
      GROUP BY lr.id_user, u.nom, u.prenoms, u.img_path
      ORDER BY score_percent DESC, time_total ASC
      LIMIT ?
    `,
    [week_key, id_classe, id_serie, safeLimit],
  );

  return rows.map((r, index) => ({
    rank: index + 1,
    id_user: r.id_user,
    nom: r.nom,
    prenoms: r.prenoms,
    img_path: r.img_path,
    correct_total: Number(r.correct_total ?? 0),
    questions_total: Number(r.questions_total ?? 0),
    time_total: Number(r.time_total ?? 0),
    subjects_played: Number(r.subjects_played ?? 0),
    score_percent: Number(r.score_percent ?? 0)
  }));
}
