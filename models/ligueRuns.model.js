import { execute } from '../config/db.js';

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimerSeconds(value, fallback = 30) {
  const parsed = asInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

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
      SELECT question_index, id_quiz, timer_seconds
      FROM ligue_run_questions
      WHERE id_run = ?
      ORDER BY question_index ASC
    `,
    [id_run],
  );

  return rows.map((row) => ({
    question_index: asInt(row.question_index),
    id_quiz: asInt(row.id_quiz),
    timer_seconds: normalizeTimerSeconds(row.timer_seconds),
  }));
}

export async function insertLigueRunQuestions(id_run, questions) {
  if (!Array.isArray(questions) || questions.length === 0) return;

  const normalized = questions
    .map((item, index) => {
      if (typeof item === 'number') {
        return {
          question_index: index,
          id_quiz: asInt(item),
          timer_seconds: 30,
        };
      }
      return {
        question_index: asInt(item?.question_index, index),
        id_quiz: asInt(item?.id_quiz ?? item?.quizId ?? item?.idQuiz ?? item?.id),
        timer_seconds: normalizeTimerSeconds(item?.timer_seconds ?? item?.timerSeconds),
      };
    })
    .filter((item) => item.id_quiz > 0);

  if (normalized.length === 0) return;

  const values = [];
  const placeholders = normalized
    .map((item) => {
      values.push(id_run, item.question_index, item.id_quiz, item.timer_seconds);
      return '(?, ?, ?, ?)';
    })
    .join(',');

  await execute(
    `
      INSERT INTO ligue_run_questions (id_run, question_index, id_quiz, timer_seconds)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        id_quiz = VALUES(id_quiz),
        timer_seconds = VALUES(timer_seconds)
    `,
    values,
  );
}

export async function insertLigueRunAnswers(id_run, answers) {
  if (!Array.isArray(answers) || answers.length === 0) return;

  const values = [];
  const placeholders = answers
    .map((answer) => {
      values.push(id_run, answer.id_quiz, answer.id_options, answer.is_correct, answer.response_time_ms);
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

async function getWeeklyLeaderboardBudget({ week_key, id_classe, id_serie }) {
  const rows = await execute(
    `
      SELECT
        COUNT(DISTINCT id_matiere) AS expected_subjects,
        COUNT(*) AS expected_questions,
        COALESCE(SUM(timer_seconds), 0) AS expected_time_seconds
      FROM ligue_weekly_quiz_bank
      WHERE week_key = ?
        AND id_classe = ?
        AND id_serie = ?
    `,
    [week_key, id_classe, id_serie],
  );

  const row = rows[0] ?? {};
  return {
    expectedSubjects: Math.max(1, asInt(row.expected_subjects, 0)),
    expectedQuestions: Math.max(1, asInt(row.expected_questions, 0)),
    expectedTimeMs: Math.max(1, asInt(row.expected_time_seconds, 0) * 1000),
  };
}

export async function getLigueLeaderboard({
  week_key,
  id_classe,
  id_serie,
  limit = 50,
}) {
  const parsedLimit = asInt(limit, 50);
  const safeLimit = parsedLimit > 0 ? parsedLimit : 50;
  const budget = await getWeeklyLeaderboardBudget({ week_key, id_classe, id_serie });

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
        COUNT(*) AS subjects_played
      FROM ligue_runs lr
      JOIN users u ON u.id_users = lr.id_user
      WHERE lr.week_key = ?
        AND lr.id_classe = ?
        AND lr.id_serie = ?
        AND lr.submitted_at IS NOT NULL
      GROUP BY lr.id_user, u.nom, u.prenoms, u.img_path
    `,
    [week_key, id_classe, id_serie],
  );

  const leaderboard = rows
    .map((row) => {
      const correctTotal = asInt(row.correct_total, 0);
      const questionsTotal = asInt(row.questions_total, 0);
      const timeTotal = asInt(row.time_total, 0);
      const subjectsPlayed = asInt(row.subjects_played, 0);
      const rawPercent = questionsTotal > 0 ? (correctTotal / questionsTotal) * 100 : 0;
      const baseAccuracy = budget.expectedQuestions > 0
        ? (20 * correctTotal) / budget.expectedQuestions
        : 0;
      const speedBonus = Math.max(
        0,
        (2 * (subjectsPlayed / budget.expectedSubjects)) -
          ((2 * timeTotal) / budget.expectedTimeMs),
      );
      const averageOn20 = Math.max(0, Math.min(20, baseAccuracy + speedBonus));

      return {
        id_user: row.id_user,
        nom: row.nom,
        prenoms: row.prenoms,
        img_path: row.img_path,
        correct_total: correctTotal,
        questions_total: questionsTotal,
        time_total: timeTotal,
        subjects_played: subjectsPlayed,
        score_percent: rawPercent,
        average_on_20: averageOn20,
      };
    })
    .sort((a, b) => (
      b.average_on_20 - a.average_on_20
      || a.time_total - b.time_total
      || b.subjects_played - a.subjects_played
      || String(a.id_user ?? '').localeCompare(String(b.id_user ?? ''))
    ));

  return leaderboard.slice(0, safeLimit).map((row, index) => ({
    rank: index + 1,
    ...row,
  }));
}

export async function findLatestNonEmptyLeaderboardWeekKey({
  id_classe,
  id_serie,
  beforeOrEqualWeekKey,
}) {
  const safeWeekKey = String(beforeOrEqualWeekKey ?? '').trim();
  if (!safeWeekKey) return null;

  const rows = await execute(
    `
      SELECT MAX(lr.week_key) AS week_key
      FROM ligue_runs lr
      WHERE lr.id_classe = ?
        AND lr.id_serie = ?
        AND lr.submitted_at IS NOT NULL
        AND lr.week_key <= ?
    `,
    [id_classe, id_serie, safeWeekKey],
  );

  const weekKey = rows[0]?.week_key;
  return typeof weekKey === 'string' && weekKey.trim().length > 0
    ? weekKey.trim()
    : null;
}
