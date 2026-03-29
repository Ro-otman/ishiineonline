import fs from 'node:fs';
import path from 'node:path';

import { getPool } from '../config/db.js';

function normalizeKey(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function stripBracketPrefix(text) {
  return String(text ?? '').replace(/^\[[^\]]+\]\s*/u, '').trim();
}

function cleanText(text) {
  return stripBracketPrefix(text)
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text) {
  return cleanText(text)
    .split(/\s+/)
    .filter(Boolean).length;
}

function roundToNearestFive(value) {
  return Math.round(value / 5) * 5;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function estimateTimerSeconds({ subjectKey, questionText, options }) {
  const baseBySubject = {
    anglais: 25,
    francais: 35,
    histgeo: 40,
    maths: 45,
    pct: 50,
    svt: 40,
    philosophie: 55,
    economie: 45,
  };

  const base = baseBySubject[normalizeKey(subjectKey)] ?? 30;
  const optionTexts = Array.isArray(options)
    ? options.map((option) => cleanText(option?.text))
    : [];
  const wordCount = countWords(questionText) + optionTexts.reduce((sum, text) => sum + countWords(text), 0);

  let seconds = base;
  if (wordCount >= 36) seconds += 15;
  else if (wordCount >= 24) seconds += 10;
  else if (wordCount >= 14) seconds += 5;

  const lowerQuestion = cleanText(questionText).toLowerCase();
  if (/\d/.test(lowerQuestion)) seconds += 5;
  if (/(pourquoi|comment|explique|justifie|calcule|determine|solve|calculate|determine|why|how)/i.test(lowerQuestion)) {
    seconds += 10;
  }

  return clamp(roundToNearestFive(seconds), 20, 80);
}

function extractSaOrder(item, fallbackIndex) {
  const raw = [
    item?.sa?.key,
    item?.sa?.slug,
    item?.sa?.label,
    item?.sa?.legacy_nom_sa,
    item?.fileName,
  ].find((value) => String(value ?? '').trim().length > 0) ?? '';

  const match = String(raw).match(/(\d+)/);
  if (match) return Number.parseInt(match[1], 10);
  return fallbackIndex + 1;
}

function resolveAcademicYearStart(now = new Date()) {
  const year = now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  return new Date(Date.UTC(year, 8, 1, 0, 0, 0));
}

function toSqlDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function mondayWeekKey(now = new Date()) {
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - day);
  return utc.toISOString().slice(0, 10);
}

function walkJsonFiles(rootDir) {
  const files = [];

  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(fullPath);
      }
    }
  }

  walk(rootDir);
  return files.sort((a, b) => a.localeCompare(b));
}

function parseContentFile(filePath, rootDir) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const relative = path.relative(rootDir, filePath).replace(/\\/g, '/');
  const segments = relative.split('/');
  if (segments.length < 4) {
    throw new Error(`Chemin de contenu invalide: ${relative}`);
  }

  const [classeSegment, groupSegment, matiereSegment, fileName] = segments;
  return {
    filePath,
    relative,
    fileName,
    classeSegment,
    groupSegment,
    matiereSegment,
    raw,
  };
}

async function loadReferenceMaps(connection) {
  const [classesRows] = await connection.query('SELECT id_classe, nom_classe FROM classes');
  const [typeRows] = await connection.query('SELECT id_type, nom_type FROM type_series');
  const [matiereRows] = await connection.query('SELECT id_matiere, nom_matiere FROM matieres');
  const [programmeRows] = await connection.query(`
    SELECT id_programme, id_classe, id_type, id_matiere
    FROM programme
  `);

  const classesByKey = new Map(
    classesRows.map((row) => [normalizeKey(row.nom_classe), row]),
  );
  const typeByKey = new Map(
    typeRows.map((row) => [normalizeKey(row.nom_type), row]),
  );
  const matiereByKey = new Map(
    matiereRows.map((row) => [normalizeKey(row.nom_matiere), row]),
  );
  const programmeByKey = new Map(
    programmeRows.map((row) => [
      `${row.id_classe}:${row.id_type == null ? 'null' : row.id_type}:${row.id_matiere}`,
      row,
    ]),
  );

  return { classesByKey, typeByKey, matiereByKey, programmeByKey };
}

function resolveClasseKey(segment) {
  const key = normalizeKey(segment);
  if (key === '3eme') return '3eme';
  if (key === '2nde' || key === '2nd') return '2nd';
  if (key === '1ere' || key === '1re') return '1ere';
  if (key === 'tle' || key === 'terminale') return 'tle';
  return key;
}

function resolveGroupKey(segment) {
  const key = normalizeKey(segment);
  if (key === 'commun') return 'commun';
  if (key === 'scientifique') return 'scientifique';
  if (key === 'litteraire') return 'litteraire';
  if (key === 'economique') return 'economique';
  return key;
}

async function resolveProgramme(connection, refs, item) {
  const classeKey = resolveClasseKey(item.classeSegment);
  const groupKey = resolveGroupKey(item.groupSegment);
  const matiereKey = normalizeKey(
    item.raw?.route?.matiere_label ?? item.raw?.route?.matiere_key ?? item.matiereSegment,
  );

  const classe = refs.classesByKey.get(classeKey);
  if (!classe) {
    throw new Error(`Classe introuvable pour ${item.relative}`);
  }

  let type = null;
  if (groupKey !== 'commun') {
    type = refs.typeByKey.get(groupKey) ?? null;
    if (!type) {
      throw new Error(`Type de série introuvable pour ${item.relative}`);
    }
  }

  const matiere = refs.matiereByKey.get(matiereKey);
  if (!matiere) {
    throw new Error(`Matière introuvable pour ${item.relative}`);
  }

  const programmeKey = `${classe.id_classe}:${type?.id_type ?? 'null'}:${matiere.id_matiere}`;
  let programme = refs.programmeByKey.get(programmeKey) ?? null;
  if (!programme) {
    const [result] = await connection.execute(
      `
        INSERT INTO programme (id_matiere, id_classe, id_type)
        VALUES (?, ?, ?)
      `,
      [matiere.id_matiere, classe.id_classe, type?.id_type ?? null],
    );
    programme = {
      id_programme: Number(result.insertId),
      id_classe: classe.id_classe,
      id_type: type?.id_type ?? null,
      id_matiere: matiere.id_matiere,
    };
    refs.programmeByKey.set(programmeKey, programme);
  }

  return {
    classe,
    type,
    matiere,
    programme,
  };
}

async function getOrCreateSa(connection, { idProgramme, saName }) {
  const [rows] = await connection.execute(
    `
      SELECT id_sa, nom_sa
      FROM sa
      WHERE id_programme = ?
        AND LOWER(nom_sa) = LOWER(?)
      LIMIT 1
    `,
    [idProgramme, saName],
  );

  if (Array.isArray(rows) && rows[0]) {
    return { id_sa: Number(rows[0].id_sa), nom_sa: rows[0].nom_sa };
  }

  const [result] = await connection.execute(
    `
      INSERT INTO sa (nom_sa, id_programme)
      VALUES (?, ?)
    `,
    [saName, idProgramme],
  );

  return {
    id_sa: Number(result.insertId),
    nom_sa: saName,
  };
}

async function upsertSaReleaseSchedule(connection, { idSa, availableFromAt, isActive }) {
  await connection.execute(
    `
      INSERT INTO sa_release_schedule (
        id_sa,
        available_from_at,
        available_until_at,
        is_active
      ) VALUES (?, ?, NULL, ?)
      ON DUPLICATE KEY UPDATE
        available_from_at = VALUES(available_from_at),
        available_until_at = VALUES(available_until_at),
        is_active = VALUES(is_active),
        updated_at = CURRENT_TIMESTAMP
    `,
    [idSa, availableFromAt, isActive ? 1 : 0],
  );
}

async function loadExistingQuizMapForSa(connection, idSa) {
  const [rows] = await connection.execute(
    `
      SELECT id_quiz, question
      FROM quiz
      WHERE id_sa = ?
    `,
    [idSa],
  );

  return new Map(
    rows.map((row) => [normalizeKey(cleanText(row.question)), { id_quiz: Number(row.id_quiz), question: row.question }]),
  );
}

async function saveQuiz(connection, {
  idSa,
  subjectKey,
  question,
  existingQuizId,
}) {
  const cleanQuestion = cleanText(question.question_text);
  const cleanOptions = (Array.isArray(question.options) ? question.options : [])
    .map((option) => ({
      text: cleanText(option?.text),
      is_correct: option?.is_correct === true || Number(option?.is_correct) === 1 ? 1 : 0,
    }))
    .filter((option) => option.text.length > 0);

  if (cleanQuestion.length === 0 || cleanOptions.length < 4) {
    return { idQuiz: null, inserted: 0, updated: 0, cleanedPrefix: 0 };
  }

  const correctCount = cleanOptions.reduce((sum, option) => sum + (option.is_correct === 1 ? 1 : 0), 0);
  if (correctCount < 1) {
    return { idQuiz: null, inserted: 0, updated: 0, cleanedPrefix: 0 };
  }

  let idQuiz = existingQuizId ?? null;
  let inserted = 0;
  let updated = 0;
  const cleanedPrefix = cleanQuestion !== String(question.question_text ?? '').trim() ? 1 : 0;

  if (idQuiz) {
    await connection.execute(
      `
        UPDATE quiz
        SET question = ?, id_sa = ?
        WHERE id_quiz = ?
      `,
      [cleanQuestion, idSa, idQuiz],
    );
    updated = 1;
    await connection.execute('DELETE FROM `options` WHERE id_quiz = ?', [idQuiz]);
  } else {
    const [result] = await connection.execute(
      `
        INSERT INTO quiz (question, id_sa)
        VALUES (?, ?)
      `,
      [cleanQuestion, idSa],
    );
    idQuiz = Number(result.insertId);
    inserted = 1;
  }

  const optionPlaceholders = cleanOptions.map(() => '(?, ?, ?)').join(', ');
  const optionValues = [];
  for (const option of cleanOptions) {
    optionValues.push(option.text, option.is_correct, idQuiz);
  }
  await connection.execute(
    `
      INSERT INTO \`options\` (opt_text, is_correct, id_quiz)
      VALUES ${optionPlaceholders}
    `,
    optionValues,
  );

  const timerSeconds = estimateTimerSeconds({
    subjectKey,
    questionText: cleanQuestion,
    options: cleanOptions,
  });

  await connection.execute(
    `
      INSERT INTO quiz_explanations (
        id_quiz,
        explanation,
        tip,
        distractor_note,
        difficulty,
        timer_seconds
      ) VALUES (?, ?, ?, NULL, ?, ?)
      ON DUPLICATE KEY UPDATE
        explanation = VALUES(explanation),
        tip = VALUES(tip),
        difficulty = VALUES(difficulty),
        timer_seconds = VALUES(timer_seconds)
    `,
    [
      idQuiz,
      question.explanation ? cleanText(question.explanation) : null,
      question.tip ? cleanText(question.tip) : null,
      question.difficulty ? cleanText(question.difficulty) : null,
      timerSeconds,
    ],
  );

  return { idQuiz, inserted, updated, cleanedPrefix };
}

async function deactivateLegacyLigueSa(connection, idProgramme, importedSaIds) {
  if (!Array.isArray(importedSaIds) || importedSaIds.length === 0) return 0;

  const [rows] = await connection.execute(
    `
      SELECT id_sa
      FROM sa
      WHERE id_programme = ?
        AND id_sa NOT IN (${importedSaIds.map(() => '?').join(',')})
        AND LOWER(nom_sa) LIKE 'ligue %'
    `,
    [idProgramme, ...importedSaIds],
  );

  const ids = rows.map((row) => Number(row.id_sa)).filter((value) => value > 0);
  if (ids.length === 0) return 0;

  await connection.execute(
    `
      INSERT INTO sa_release_schedule (
        id_sa,
        available_from_at,
        available_until_at,
        is_active
      ) VALUES ${ids.map(() => '(?, NULL, NULL, 0)').join(', ')}
      ON DUPLICATE KEY UPDATE
        is_active = 0,
        updated_at = CURRENT_TIMESTAMP
    `,
    ids,
  );

  return ids.length;
}

async function cleanBracketPrefixedQuestions(connection) {
  const [rows] = await connection.query(`
    SELECT id_quiz, question
    FROM quiz
    WHERE question REGEXP '^\\\\[[^]]+\\\\]'
  `);

  let updated = 0;
  for (const row of rows) {
    const nextQuestion = stripBracketPrefix(row.question);
    if (!nextQuestion || nextQuestion === row.question) continue;
    await connection.execute(
      `
        UPDATE quiz
        SET question = ?
        WHERE id_quiz = ?
      `,
      [nextQuestion, row.id_quiz],
    );
    updated += 1;
  }

  return updated;
}

async function invalidateFutureWeeklyBanks(connection) {
  const thresholdWeekKey = mondayWeekKey(new Date());
  const [result] = await connection.execute(
    `
      DELETE bank
      FROM ligue_weekly_quiz_bank bank
      WHERE bank.week_key >= ?
        AND NOT EXISTS (
          SELECT 1
          FROM ligue_runs lr
          WHERE lr.week_key = bank.week_key
            AND lr.id_classe = bank.id_classe
            AND lr.id_serie = bank.id_serie
            AND lr.id_matiere = bank.id_matiere
        )
    `,
    [thresholdWeekKey],
  );

  return Number(result.affectedRows ?? 0);
}

const assetsRootArg = process.argv[2]?.trim();
const assetsRoot = assetsRootArg
  ? path.resolve(assetsRootArg)
  : path.resolve(process.cwd(), '..', 'ishiine', 'assets', 'content', 'programmes');

if (!fs.existsSync(assetsRoot)) {
  console.error(JSON.stringify({
    ok: false,
    message: `Chemin introuvable: ${assetsRoot}`,
  }));
  process.exit(1);
}

const allFiles = walkJsonFiles(assetsRoot).map((filePath) => parseContentFile(filePath, assetsRoot));
const refsConnection = await getPool().getConnection();

try {
  const refs = await loadReferenceMaps(refsConnection);
  const byProgrammeKey = new Map();

  for (const item of allFiles) {
    const resolved = await resolveProgramme(refsConnection, refs, item);
    const programmeKey = `${resolved.programme.id_programme}`;
    if (!byProgrammeKey.has(programmeKey)) {
      byProgrammeKey.set(programmeKey, {
        resolved,
        items: [],
      });
    }
    byProgrammeKey.get(programmeKey).items.push(item);
  }

  refsConnection.release();

  const connection = await getPool().getConnection();
  const stats = {
    programmes: byProgrammeKey.size,
    saInsertedOrMatched: 0,
    quizInserted: 0,
    quizUpdated: 0,
    cleanedPrefixedInImport: 0,
    cleanedLegacyPrefixes: 0,
    legacyLiguesDeactivated: 0,
    futureWeeklyBankRowsDeleted: 0,
  };

  try {
    await connection.beginTransaction();
    const academicYearStart = resolveAcademicYearStart(new Date());

    for (const { resolved, items } of byProgrammeKey.values()) {
      const sortedItems = [...items].sort((a, b) => {
        const aOrder = extractSaOrder(a.raw, 0);
        const bOrder = extractSaOrder(b.raw, 0);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.relative.localeCompare(b.relative);
      });

      const stepDays = sortedItems.length <= 1
        ? 0
        : Math.max(7, Math.floor(210 / sortedItems.length));
      const importedSaIds = [];

      for (let index = 0; index < sortedItems.length; index += 1) {
        const item = sortedItems[index];
        const saName = cleanText(
          item.raw?.sa?.label ??
          item.raw?.sa?.legacy_nom_sa ??
          path.basename(item.fileName, '.json'),
        );
        if (!saName) continue;

        const sa = await getOrCreateSa(connection, {
          idProgramme: resolved.programme.id_programme,
          saName,
        });
        importedSaIds.push(sa.id_sa);
        stats.saInsertedOrMatched += 1;

        const availableFromAt = toSqlDateTime(
          new Date(academicYearStart.getTime() + (index * stepDays * 24 * 60 * 60 * 1000)),
        );
        await upsertSaReleaseSchedule(connection, {
          idSa: sa.id_sa,
          availableFromAt,
          isActive: true,
        });

        const existingQuizMap = await loadExistingQuizMapForSa(connection, sa.id_sa);
        const questions = Array.isArray(item.raw?.questions) ? item.raw.questions : [];

        for (const question of questions) {
          const key = normalizeKey(cleanText(question.question_text));
          const existing = existingQuizMap.get(key) ?? null;
          const saved = await saveQuiz(connection, {
            idSa: sa.id_sa,
            subjectKey: item.raw?.route?.matiere_key ?? item.matiereSegment,
            question,
            existingQuizId: existing?.id_quiz ?? null,
          });
          if (!saved.idQuiz) continue;
          stats.quizInserted += saved.inserted;
          stats.quizUpdated += saved.updated;
          stats.cleanedPrefixedInImport += saved.cleanedPrefix;
          existingQuizMap.set(key, { id_quiz: saved.idQuiz, question: cleanText(question.question_text) });
        }
      }

      stats.legacyLiguesDeactivated += await deactivateLegacyLigueSa(
        connection,
        resolved.programme.id_programme,
        importedSaIds,
      );
    }

    stats.cleanedLegacyPrefixes = await cleanBracketPrefixedQuestions(connection);
    stats.futureWeeklyBankRowsDeleted = await invalidateFutureWeeklyBanks(connection);

    await connection.commit();

    const [summaryRows] = await connection.query(`
      SELECT COUNT(*) AS total_quiz, COUNT(DISTINCT id_sa) AS total_sa
      FROM quiz
    `);

    console.log(JSON.stringify({
      ok: true,
      assetsRoot,
      filesImported: allFiles.length,
      stats,
      totals: summaryRows[0] ?? {},
    }, null, 2));
  } catch (error) {
    try {
      await connection.rollback();
    } catch {}
    console.error(JSON.stringify({
      ok: false,
      message: error?.message ?? String(error),
      code: error?.code ?? null,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    connection.release();
  }
} finally {
  await getPool().end();
}
