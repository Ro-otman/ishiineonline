import { getPool } from '../config/db.js';
import { listLigueQuizCandidatesForMatiere } from './quiz.model.js';

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeTimerSeconds(value, fallback = 30) {
  const parsed = asInt(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function normalizeBankRow(row) {
  return {
    week_key: String(row.week_key ?? '').trim(),
    id_classe: asInt(row.id_classe),
    id_serie: asInt(row.id_serie),
    id_matiere: asInt(row.id_matiere),
    question_index: asInt(row.question_index),
    id_quiz: asInt(row.id_quiz),
    timer_seconds: normalizeTimerSeconds(row.timer_seconds),
  };
}

export function groupWeeklyQuizBankBySubject(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const safe = normalizeBankRow(row);
    if (!map.has(safe.id_matiere)) map.set(safe.id_matiere, []);
    map.get(safe.id_matiere).push(safe);
  }

  for (const [key, value] of map.entries()) {
    map.set(
      key,
      [...value].sort((a, b) => a.question_index - b.question_index),
    );
  }

  return map;
}

export async function listWeeklyLigueQuizBank({ week_key, id_classe, id_serie, id_matiere = null }) {
  const pool = getPool();
  const params = [week_key, id_classe, id_serie];
  let sql = `
    SELECT week_key, id_classe, id_serie, id_matiere, question_index, id_quiz, timer_seconds
    FROM ligue_weekly_quiz_bank
    WHERE week_key = ?
      AND id_classe = ?
      AND id_serie = ?
  `;

  if (id_matiere != null) {
    sql += ' AND id_matiere = ?';
    params.push(id_matiere);
  }

  sql += ' ORDER BY id_matiere ASC, question_index ASC';
  const [rows] = await pool.query(sql, params);
  return rows.map(normalizeBankRow);
}

export async function ensureWeeklyLigueQuizBank({
  week_key,
  id_classe,
  room,
  subjects,
  questions_per_subject,
}) {
  const idSerie = asInt(room?.id_serie ?? room?.idSerie ?? room?.id);
  const idType = asInt(room?.id_type ?? room?.idType, 0);
  const safeQuestionCount = Math.max(1, asInt(questions_per_subject, 1));
  const safeSubjects = Array.isArray(subjects)
    ? subjects.filter((subject) => asInt(subject?.id_matiere ?? subject?.idMatiere) > 0)
    : [];

  if (!week_key || !id_classe || !idSerie || safeSubjects.length === 0) {
    return [];
  }

  const existing = await listWeeklyLigueQuizBank({
    week_key,
    id_classe,
    id_serie: idSerie,
  });
  const expectedRows = safeSubjects.length * safeQuestionCount;
  const groupedExisting = groupWeeklyQuizBankBySubject(existing);
  const isComplete =
    existing.length === expectedRows &&
    safeSubjects.every((subject) => {
      const subjectId = asInt(subject.id_matiere ?? subject.idMatiere);
      return (groupedExisting.get(subjectId)?.length ?? 0) === safeQuestionCount;
    });

  if (isComplete) {
    return existing;
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `
        DELETE FROM ligue_weekly_quiz_bank
        WHERE week_key = ?
          AND id_classe = ?
          AND id_serie = ?
      `,
      [week_key, id_classe, idSerie],
    );

    for (const subject of safeSubjects) {
      const subjectId = asInt(subject.id_matiere ?? subject.idMatiere);
      const seed = `${week_key}:${id_classe}:${idSerie}:${subjectId}`;
      const candidates = await listLigueQuizCandidatesForMatiere({
        id_classe,
        id_type: idType,
        id_matiere: subjectId,
        limit: safeQuestionCount,
        seed,
      });

      if (candidates.length < safeQuestionCount) {
        const err = new Error(
          `Pas assez de quiz minuteres pour la matiere ${subject.nom_matiere ?? subject.nomMatiere ?? subjectId} (${candidates.length}/${safeQuestionCount}).`,
        );
        err.statusCode = 409;
        err.code = 'NOT_ENOUGH_QUIZ';
        throw err;
      }

      const placeholders = candidates.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values = [];
      candidates.forEach((candidate, index) => {
        values.push(
          week_key,
          id_classe,
          idSerie,
          subjectId,
          index,
          candidate.id_quiz,
          normalizeTimerSeconds(candidate.timer_seconds),
        );
      });

      await connection.execute(
        `
          INSERT INTO ligue_weekly_quiz_bank (
            week_key,
            id_classe,
            id_serie,
            id_matiere,
            question_index,
            id_quiz,
            timer_seconds
          ) VALUES ${placeholders}
        `,
        values,
      );
    }

    await connection.commit();
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    throw error;
  } finally {
    connection.release();
  }

  return listWeeklyLigueQuizBank({
    week_key,
    id_classe,
    id_serie: idSerie,
  });
}
