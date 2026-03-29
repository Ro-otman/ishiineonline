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

function stringHash(value) {
  const text = String(value ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizeBankRow(row) {
  return {
    week_key: String(row.week_key ?? '').trim(),
    id_classe: asInt(row.id_classe),
    id_serie: asInt(row.id_serie),
    id_matiere: asInt(row.id_matiere),
    id_sa: asInt(row.id_sa),
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
    SELECT week_key, id_classe, id_serie, id_matiere, id_sa, question_index, id_quiz, timer_seconds
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

async function listRecentUsedQuizIds({
  id_classe,
  id_serie,
  id_matiere,
  week_key,
  recent_weeks = 4,
}) {
  const safeRecentWeeks = Math.max(0, asInt(recent_weeks, 0));
  if (!id_classe || !id_serie || !id_matiere || !week_key || safeRecentWeeks <= 0) {
    return [];
  }

  const pool = getPool();
  const [rows] = await pool.query(
    `
      SELECT DISTINCT bank.id_quiz
      FROM ligue_weekly_quiz_bank bank
      JOIN (
        SELECT week_key
        FROM (
          SELECT DISTINCT week_key
          FROM ligue_weekly_quiz_bank
          WHERE id_classe = ?
            AND id_serie = ?
            AND id_matiere = ?
            AND week_key < ?
          ORDER BY week_key DESC
          LIMIT ?
        ) recent_weeks
      ) recent ON recent.week_key = bank.week_key
      WHERE bank.id_classe = ?
        AND bank.id_serie = ?
        AND bank.id_matiere = ?
    `,
    [
      id_classe,
      id_serie,
      id_matiere,
      week_key,
      safeRecentWeeks,
      id_classe,
      id_serie,
      id_matiere,
    ],
  );

  return rows
    .map((row) => asInt(row.id_quiz))
    .filter((value) => value > 0);
}

function pickBalancedCandidates({ candidates, limit, seed }) {
  const safeLimit = Math.max(1, asInt(limit, 1));
  const bySa = new Map();

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const safeSaId = asInt(candidate?.id_sa);
    const safeQuizId = asInt(candidate?.id_quiz);
    if (!safeSaId || !safeQuizId) continue;
    if (!bySa.has(safeSaId)) bySa.set(safeSaId, []);
    bySa.get(safeSaId).push(candidate);
  }

  const groups = [...bySa.entries()]
    .map(([idSa, rows]) => ({ idSa, rows }))
    .filter((group) => group.rows.length > 0)
    .sort((a, b) => a.idSa - b.idSa);

  if (groups.length === 0) return [];

  const startOffset = groups.length > 1 ? stringHash(seed) % groups.length : 0;
  const orderedGroups = groups
    .slice(startOffset)
    .concat(groups.slice(0, startOffset));
  const positions = new Map(orderedGroups.map((group) => [group.idSa, 0]));
  const selected = [];

  while (selected.length < safeLimit) {
    let pickedInRound = false;

    for (const group of orderedGroups) {
      if (selected.length >= safeLimit) break;
      const currentIndex = positions.get(group.idSa) ?? 0;
      if (currentIndex >= group.rows.length) continue;
      selected.push(group.rows[currentIndex]);
      positions.set(group.idSa, currentIndex + 1);
      pickedInRound = true;
    }

    if (!pickedInRound) break;
  }

  return selected;
}

export async function ensureWeeklyLigueQuizBank({
  week_key,
  id_classe,
  room,
  subjects,
  questions_per_subject,
  eligible_at,
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
      const recentUsedQuizIds = await listRecentUsedQuizIds({
        id_classe,
        id_serie: idSerie,
        id_matiere: subjectId,
        week_key,
      });

      const freshCandidates = await listLigueQuizCandidatesForMatiere({
        id_classe,
        id_type: idType,
        id_matiere: subjectId,
        eligible_at,
        exclude_quiz_ids: recentUsedQuizIds,
        seed: `${seed}:fresh`,
      });
      let candidates = pickBalancedCandidates({
        candidates: freshCandidates,
        limit: safeQuestionCount,
        seed: `${seed}:fresh`,
      });

      if (candidates.length < safeQuestionCount) {
        const fallbackCandidates = await listLigueQuizCandidatesForMatiere({
          id_classe,
          id_type: idType,
          id_matiere: subjectId,
          eligible_at,
          exclude_quiz_ids: candidates.map((candidate) => candidate.id_quiz),
          seed: `${seed}:fallback`,
        });
        const fallbackSelection = pickBalancedCandidates({
          candidates: fallbackCandidates,
          limit: safeQuestionCount - candidates.length,
          seed: `${seed}:fallback`,
        });
        candidates = [...candidates, ...fallbackSelection];
      }

      if (candidates.length < safeQuestionCount) {
        const err = new Error(
          `Pas assez de quiz minuteres pour la matiere ${subject.nom_matiere ?? subject.nomMatiere ?? subjectId} (${candidates.length}/${safeQuestionCount}).`,
        );
        err.statusCode = 409;
        err.code = 'NOT_ENOUGH_QUIZ';
        throw err;
      }

      const placeholders = candidates.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const values = [];
      candidates.forEach((candidate, index) => {
        values.push(
          week_key,
          id_classe,
          idSerie,
          subjectId,
          candidate.id_sa,
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
            id_sa,
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
