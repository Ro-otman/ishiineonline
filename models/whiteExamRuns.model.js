import { execute } from '../config/db.js';

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimerSeconds(value, fallback = 30) {
  const parsed = asInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

export async function getWhiteExamRunById(id_run) {
  const rows = await execute(
    'SELECT * FROM white_exam_runs WHERE id_run = ? LIMIT 1',
    [id_run],
  );
  return rows[0] ?? null;
}

export async function createWhiteExamRun({
  id_run,
  week_key,
  id_user,
  id_classe,
  id_type,
  id_matiere,
  total_questions,
}) {
  await execute(
    `
      INSERT INTO white_exam_runs (
        id_run,
        week_key,
        id_user,
        id_classe,
        id_type,
        id_matiere,
        total_questions
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      id_run,
      week_key,
      id_user,
      id_classe,
      id_type ?? null,
      id_matiere,
      total_questions,
    ],
  );

  return getWhiteExamRunById(id_run);
}

export async function listWhiteExamRunQuestions(id_run) {
  const rows = await execute(
    `
      SELECT question_index, id_quiz, timer_seconds
      FROM white_exam_run_questions
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

export async function insertWhiteExamRunQuestions(id_run, questions) {
  if (!Array.isArray(questions) || questions.length === 0) return;

  const normalized = questions
    .map((item, index) => ({
      question_index: asInt(item?.question_index, index),
      id_quiz: asInt(item?.id_quiz ?? item?.quizId ?? item?.idQuiz ?? item?.id),
      timer_seconds: normalizeTimerSeconds(
        item?.timer_seconds ?? item?.timerSeconds,
      ),
    }))
    .filter((item) => item.id_quiz > 0);

  if (normalized.length === 0) return;

  const values = [];
  const placeholders = normalized
    .map((item) => {
      values.push(id_run, item.question_index, item.id_quiz, item.timer_seconds);
      return '(?, ?, ?, ?)';
    })
    .join(', ');

  await execute(
    `
      INSERT INTO white_exam_run_questions (
        id_run,
        question_index,
        id_quiz,
        timer_seconds
      ) VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        id_quiz = VALUES(id_quiz),
        timer_seconds = VALUES(timer_seconds)
    `,
    values,
  );
}

export async function insertWhiteExamRunAnswers(id_run, answers) {
  if (!Array.isArray(answers) || answers.length === 0) return;

  const values = [];
  const placeholders = answers
    .map((answer) => {
      values.push(
        id_run,
        answer.id_quiz,
        answer.id_options,
        answer.is_correct,
        answer.response_time_ms,
      );
      return '(?, ?, ?, ?, ?)';
    })
    .join(', ');

  await execute(
    `
      INSERT INTO white_exam_run_answers (
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

export async function finalizeWhiteExamRun({
  id_run,
  correct_count,
  total_response_time_ms,
  score_percent,
}) {
  await execute(
    `
      UPDATE white_exam_runs
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

  return getWhiteExamRunById(id_run);
}
