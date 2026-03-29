import { env } from '../config/env.js';
import { execute, getPool } from '../config/db.js';
import { getPaymentsDashboardData } from './payments.model.js';

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value, { required = false, maxLength = 0 } = {}) {
  const text = String(value ?? '').trim();
  if (required && !text) {
    const err = new Error('Tous les champs obligatoires du quiz doivent etre renseignes.');
    err.statusCode = 400;
    throw err;
  }
  if (!text) return '';
  if (maxLength > 0 && text.length > maxLength) return text.slice(0, maxLength);
  return text;
}

function normalizeTimerSeconds(value) {
  const seconds = asInt(value, 0);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    const err = new Error('Le minuteur doit etre un nombre de secondes valide.');
    err.statusCode = 400;
    throw err;
  }
  if (seconds < 10 || seconds > 600) {
    const err = new Error('Le minuteur doit etre compris entre 10 et 600 secondes.');
    err.statusCode = 400;
    throw err;
  }
  return seconds;
}

function normalizePositiveInt(value, fieldLabel, { min = 1, max = 1000 } = {}) {
  const parsed = asInt(value, Number.NaN);
  if (!Number.isFinite(parsed)) {
    const err = new Error(`${fieldLabel} doit etre un nombre valide.`);
    err.statusCode = 400;
    throw err;
  }
  if (parsed < min || parsed > max) {
    const err = new Error(`${fieldLabel} doit etre compris entre ${min} et ${max}.`);
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function normalizeOptionalInt(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = asInt(raw, Number.NaN);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    const err = new Error('Le type de serie selectionne est invalide.');
    err.statusCode = 400;
    throw err;
  }
  return parsed;
}

function normalizeDateTimeLocal(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    const err = new Error('Selectionne la date et l heure de debut.');
    err.statusCode = 400;
    throw err;
  }

  const normalized = raw.replace(' ', 'T');
  const matches = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!matches) {
    const err = new Error('Le format de debut est invalide.');
    err.statusCode = 400;
    throw err;
  }

  const [, year, month, day, hours, minutes, seconds = '00'] = matches;
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function toDateTimeLocalValue(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const normalized = raw.replace(' ', 'T');
  return normalized.length >= 16 ? normalized.slice(0, 16) : normalized;
}

function currentIso() {
  return new Date().toISOString();
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function buildLigueDefaults(setting) {
  return {
    edit_setting_id: setting?.id_setting ? String(setting.id_setting) : '',
    id_classe: setting?.id_classe ? String(setting.id_classe) : '',
    id_type: setting?.id_type ? String(setting.id_type) : '',
    starts_at: toDateTimeLocalValue(setting?.starts_at),
    questions_per_subject: String(setting?.questions_per_subject ?? 10),
    margin_seconds: String(setting?.margin_seconds ?? 15),
    break_minutes: String(setting?.break_minutes ?? 5),
  };
}

async function hasTimerSecondsColumn(connection) {
  const [rows] = await connection.query("SHOW COLUMNS FROM quiz_explanations LIKE 'timer_seconds'");
  return Array.isArray(rows) && rows.length > 0;
}

async function getMetricsBundle() {
  const nowIso = currentIso();
  const monthStart = monthStartIso();
  const overviewRows = await execute(
    `
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM users WHERE COALESCE(subscription_date, '') <> '') AS subscribed_users,
        (SELECT COUNT(*) FROM users WHERE COALESCE(subscription_expiry, '') <> '' AND subscription_expiry >= ?) AS active_subscribers,
        (SELECT COUNT(*) FROM users WHERE COALESCE(subscription_date, '') <> '' AND subscription_date >= ?) AS new_subscriptions_this_month,
        (SELECT COUNT(*) FROM quiz) AS total_quiz,
        (SELECT COUNT(*) FROM sa) AS total_sa,
        (SELECT COUNT(*) FROM matieres) AS total_matieres,
        (SELECT COUNT(*) FROM programme) AS total_programmes,
        (SELECT COUNT(*) FROM attempts) AS total_attempts,
        (SELECT COALESCE(ROUND(AVG(is_correct) * 100, 1), 0) FROM attempts) AS average_score
    `,
    [nowIso, monthStart],
  );

  const overview = overviewRows[0] ?? {};
  const premiumAmount = asInt(env.PAYMENT_PREMIUM_AMOUNT, 375);
  const totalUsers = asInt(overview.total_users);
  const subscribedUsers = asInt(overview.subscribed_users);
  const activeSubscribers = asInt(overview.active_subscribers);

  return {
    generatedAt: nowIso,
    premiumAmount,
    metrics: {
      totalUsers,
      subscribedUsers,
      activeSubscribers,
      freeUsers: Math.max(totalUsers - activeSubscribers, 0),
      newSubscriptionsThisMonth: asInt(overview.new_subscriptions_this_month),
      totalQuiz: asInt(overview.total_quiz),
      totalSa: asInt(overview.total_sa),
      totalMatieres: asInt(overview.total_matieres),
      totalProgrammes: asInt(overview.total_programmes),
      totalAttempts: asInt(overview.total_attempts),
      averageScore: asNumber(overview.average_score, 0),
      estimatedRevenue: subscribedUsers * premiumAmount,
      estimatedActiveRevenue: activeSubscribers * premiumAmount,
    },
  };
}

async function listRecentUsers(limit = 8) {
  return execute(
    `
      SELECT prenoms, nom, email, classe, phone, is_subscribed, subscription_date, subscription_expiry,
             COALESCE(NULLIF(first_use_time, ''), NULLIF(subscription_date, ''), '') AS registered_at
      FROM users
      ORDER BY registered_at DESC
      LIMIT ?
    `,
    [asInt(limit, 8)],
  );
}

async function listClassBreakdown(limit = 10) {
  return execute(
    `SELECT classe, COUNT(*) AS total FROM users GROUP BY classe ORDER BY total DESC, classe ASC LIMIT ?`,
    [asInt(limit, 10)],
  );
}

async function listSubjectBreakdown(limit = 10) {
  return execute(
    `
      SELECT m.nom_matiere, COUNT(DISTINCT s.id_sa) AS sa_count, COUNT(DISTINCT q.id_quiz) AS quiz_count
      FROM matieres m
      LEFT JOIN programme p ON p.id_matiere = m.id_matiere
      LEFT JOIN sa s ON s.id_programme = p.id_programme
      LEFT JOIN quiz q ON q.id_sa = s.id_sa
      GROUP BY m.id_matiere, m.nom_matiere
      HAVING sa_count > 0 OR quiz_count > 0
      ORDER BY quiz_count DESC, sa_count DESC, m.nom_matiere ASC
      LIMIT ?
    `,
    [asInt(limit, 10)],
  );
}

async function listRecentQuizzes(limit = 10) {
  return execute(
    `
      SELECT q.id_quiz, q.question, s.nom_sa, m.nom_matiere, c.nom_classe, COALESCE(ts.nom_type, 'Commun') AS nom_type
      FROM quiz q
      JOIN sa s ON s.id_sa = q.id_sa
      JOIN programme p ON p.id_programme = s.id_programme
      JOIN matieres m ON m.id_matiere = p.id_matiere
      JOIN classes c ON c.id_classe = p.id_classe
      LEFT JOIN type_series ts ON ts.id_type = p.id_type
      ORDER BY q.id_quiz DESC
      LIMIT ?
    `,
    [asInt(limit, 10)],
  );
}

async function listProgrammes(limit = 200) {
  const rows = await execute(
    `
      SELECT p.id_programme, c.nom_classe, COALESCE(ts.nom_type, 'Commun') AS nom_type, m.nom_matiere,
             COUNT(DISTINCT s.id_sa) AS sa_count, COUNT(DISTINCT q.id_quiz) AS quiz_count
      FROM programme p
      JOIN classes c ON c.id_classe = p.id_classe
      JOIN matieres m ON m.id_matiere = p.id_matiere
      LEFT JOIN type_series ts ON ts.id_type = p.id_type
      LEFT JOIN sa s ON s.id_programme = p.id_programme
      LEFT JOIN quiz q ON q.id_sa = s.id_sa
      GROUP BY p.id_programme, c.nom_classe, nom_type, m.nom_matiere
      ORDER BY c.nom_classe ASC, nom_type ASC, m.nom_matiere ASC
      LIMIT ?
    `,
    [asInt(limit, 200)],
  );
  return rows.map((item) => ({ ...item, label: `${item.nom_classe} / ${item.nom_type} / ${item.nom_matiere}` }));
}

async function listRecentSubscriptions(limit = 16) {
  return execute(
    `
      SELECT prenoms, nom, email, classe, subscription_date, subscription_expiry, is_subscribed
      FROM users
      WHERE COALESCE(subscription_date, '') <> ''
      ORDER BY subscription_date DESC
      LIMIT ?
    `,
    [asInt(limit, 16)],
  );
}

async function listAdminClasses() {
  return execute(
    `SELECT id_classe, nom_classe FROM classes ORDER BY id_classe ASC, nom_classe ASC`,
  );
}

async function listAdminTypeSeries() {
  return execute(
    `SELECT id_type, nom_type FROM type_series ORDER BY nom_type ASC`,
  );
}

async function listAdminLigueSettings(limit = 100) {
  return execute(
    `
      SELECT
        ls.id_setting,
        ls.id_classe,
        ls.id_type,
        c.nom_classe,
        COALESCE(ts.nom_type, 'Commun') AS nom_type,
        ls.starts_at,
        ls.questions_per_subject,
        ls.margin_seconds,
        ls.break_minutes,
        ls.updated_at
      FROM ligue_settings ls
      JOIN classes c ON c.id_classe = ls.id_classe
      LEFT JOIN type_series ts ON ts.id_type = ls.id_type
      ORDER BY ls.updated_at DESC, c.nom_classe ASC, nom_type ASC
      LIMIT ?
    `,
    [asInt(limit, 100)],
  );
}

async function getAdminLigueSettingById(idSetting) {
  const targetId = asInt(idSetting, 0);
  if (!targetId) return null;
  const rows = await execute(
    `
      SELECT
        ls.id_setting,
        ls.id_classe,
        ls.id_type,
        c.nom_classe,
        COALESCE(ts.nom_type, 'Commun') AS nom_type,
        ls.starts_at,
        ls.questions_per_subject,
        ls.margin_seconds,
        ls.break_minutes,
        ls.updated_at
      FROM ligue_settings ls
      JOIN classes c ON c.id_classe = ls.id_classe
      LEFT JOIN type_series ts ON ts.id_type = ls.id_type
      WHERE ls.id_setting = ?
      LIMIT 1
    `,
    [targetId],
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function getAdminOverviewPageData() {
  const [base, recentUsers, classBreakdown, subjectBreakdown, recentQuizzes] = await Promise.all([
    getMetricsBundle(), listRecentUsers(6), listClassBreakdown(6), listSubjectBreakdown(6), listRecentQuizzes(8),
  ]);
  return { ...base, recentUsers, classBreakdown, subjectBreakdown, recentQuizzes };
}

export async function getAdminUsersPageData() {
  const [base, users, classBreakdown, recentSubscriptions] = await Promise.all([
    getMetricsBundle(), listRecentUsers(60), listClassBreakdown(12), listRecentSubscriptions(12),
  ]);
  return { ...base, users, classBreakdown, recentSubscriptions };
}

export async function getAdminContentPageData() {
  const [base, programmes, subjectBreakdown, recentQuizzes] = await Promise.all([
    getMetricsBundle(), listProgrammes(240), listSubjectBreakdown(10), listRecentQuizzes(14),
  ]);
  return { ...base, programmes, subjectBreakdown, recentQuizzes };
}

export async function getAdminLiguePageData({ editSettingId = null } = {}) {
  const [base, classes, typeSeries, settings, editingSetting] = await Promise.all([
    getMetricsBundle(),
    listAdminClasses(),
    listAdminTypeSeries(),
    listAdminLigueSettings(120),
    editSettingId ? getAdminLigueSettingById(editSettingId) : Promise.resolve(null),
  ]);
  const selectedSetting = editingSetting || settings[0] || null;
  return {
    ...base,
    classes,
    typeSeries,
    settings,
    editingSetting,
    defaults: buildLigueDefaults(selectedSetting),
  };
}

export async function getAdminPaymentsPageData() {
  const [base, recentSubscriptions, paymentData] = await Promise.all([
    getMetricsBundle(),
    listRecentSubscriptions(12),
    getPaymentsDashboardData(24),
  ]);
  return {
    ...base,
    recentSubscriptions,
    paymentMetrics: paymentData.metrics,
    recentPayments: paymentData.recentPayments,
  };
}

export async function createQuizFromDashboard(input) {
  const idProgramme = asInt(input.id_programme);
  if (!idProgramme) {
    const err = new Error('Selectionne un programme avant d ajouter un quiz.');
    err.statusCode = 400;
    throw err;
  }

  const saName = cleanText(input.sa_name, { required: true, maxLength: 255 });
  const question = cleanText(input.question, { required: true });
  const explanation = cleanText(input.explanation);
  const tip = cleanText(input.tip);
  const difficulty = cleanText(input.difficulty, { maxLength: 64 }) || 'moyen';
  const timerSeconds = normalizeTimerSeconds(input.timer_seconds);
  const correctOptionIndex = asInt(input.correct_option, -1);
  const options = [
    cleanText(input.option_a, { required: true }),
    cleanText(input.option_b, { required: true }),
    cleanText(input.option_c, { required: true }),
    cleanText(input.option_d, { required: true }),
  ];

  if (correctOptionIndex < 0 || correctOptionIndex >= options.length) {
    const err = new Error('Choisis la bonne reponse du quiz.');
    err.statusCode = 400;
    throw err;
  }

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [programmeRows] = await connection.execute(
      `SELECT p.id_programme FROM programme p WHERE p.id_programme = ? LIMIT 1`,
      [idProgramme],
    );
    const programme = Array.isArray(programmeRows) ? programmeRows[0] : null;
    if (!programme) {
      const err = new Error('Programme introuvable pour ce quiz.');
      err.statusCode = 404;
      throw err;
    }

    const [saRows] = await connection.execute(
      `SELECT id_sa FROM sa WHERE id_programme = ? AND LOWER(nom_sa) = LOWER(?) LIMIT 1`,
      [idProgramme, saName],
    );

    let idSa = Array.isArray(saRows) && saRows[0] ? Number(saRows[0].id_sa) : 0;
    if (!idSa) {
      const [saResult] = await connection.execute('INSERT INTO sa (nom_sa, id_programme) VALUES (?, ?)', [saName, idProgramme]);
      idSa = Number(saResult.insertId);
    }

    const [quizResult] = await connection.execute('INSERT INTO quiz (question, id_sa) VALUES (?, ?)', [question, idSa]);
    const idQuiz = Number(quizResult.insertId);

    const optionPlaceholders = options.map(() => '(?, ?, ?)').join(', ');
    const optionValues = [];
    for (let index = 0; index < options.length; index += 1) {
      optionValues.push(options[index], index === correctOptionIndex ? 1 : 0, idQuiz);
    }
    await connection.execute(`INSERT INTO \`options\` (opt_text, is_correct, id_quiz) VALUES ${optionPlaceholders}`, optionValues);

    const canStoreTimer = await hasTimerSecondsColumn(connection);
    if (canStoreTimer) {
      await connection.execute(
        `INSERT INTO quiz_explanations (id_quiz, explanation, tip, distractor_note, difficulty, timer_seconds) VALUES (?, ?, ?, NULL, ?, ?)`,
        [idQuiz, explanation || null, tip || null, difficulty || null, timerSeconds],
      );
    } else {
      await connection.execute(
        `INSERT INTO quiz_explanations (id_quiz, explanation, tip, distractor_note, difficulty) VALUES (?, ?, ?, NULL, ?)`,
        [idQuiz, explanation || null, tip || null, difficulty || null],
      );
    }

    await connection.commit();
    return { id_quiz: idQuiz, id_sa: idSa, timer_seconds: timerSeconds };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}

export async function saveLigueSettingsFromDashboard(input) {
  const idClasse = normalizePositiveInt(input.id_classe, 'La classe', { min: 1, max: 9999 });
  const idType = normalizeOptionalInt(input.id_type);
  const startsAt = normalizeDateTimeLocal(input.starts_at);
  const questionsPerSubject = normalizePositiveInt(input.questions_per_subject, 'Le nombre de questions par matiere', { min: 1, max: 200 });
  const marginSeconds = normalizePositiveInt(input.margin_seconds, 'La marge technique', { min: 0, max: 3600 });
  const breakMinutes = normalizePositiveInt(input.break_minutes, 'La pause entre matieres', { min: 0, max: 720 });

  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();

    const [classRows] = await connection.execute(
      `SELECT id_classe, nom_classe FROM classes WHERE id_classe = ? LIMIT 1`,
      [idClasse],
    );
    const classe = Array.isArray(classRows) && classRows[0] ? classRows[0] : null;
    if (!classe) {
      const err = new Error('La classe selectionnee est introuvable.');
      err.statusCode = 404;
      throw err;
    }

    let type = null;
    if (idType !== null) {
      const [typeRows] = await connection.execute(
        `SELECT id_type, nom_type FROM type_series WHERE id_type = ? LIMIT 1`,
        [idType],
      );
      type = Array.isArray(typeRows) && typeRows[0] ? typeRows[0] : null;
      if (!type) {
        const err = new Error('Le type de serie selectionne est introuvable.');
        err.statusCode = 404;
        throw err;
      }
    }

    let existing = null;
    if (idType === null) {
      const [rows] = await connection.execute(
        `SELECT id_setting FROM ligue_settings WHERE id_classe = ? AND id_type IS NULL ORDER BY updated_at DESC, id_setting DESC LIMIT 1`,
        [idClasse],
      );
      existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } else {
      const [rows] = await connection.execute(
        `SELECT id_setting FROM ligue_settings WHERE id_classe = ? AND id_type = ? ORDER BY updated_at DESC, id_setting DESC LIMIT 1`,
        [idClasse, idType],
      );
      existing = Array.isArray(rows) && rows[0] ? rows[0] : null;
    }

    let idSetting = existing ? Number(existing.id_setting) : 0;
    if (idSetting) {
      await connection.execute(
        `
          UPDATE ligue_settings
          SET starts_at = ?, questions_per_subject = ?, margin_seconds = ?, break_minutes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id_setting = ?
        `,
        [startsAt, questionsPerSubject, marginSeconds, breakMinutes, idSetting],
      );
    } else {
      const [result] = await connection.execute(
        `
          INSERT INTO ligue_settings (id_classe, id_type, starts_at, questions_per_subject, margin_seconds, break_minutes)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        [idClasse, idType, startsAt, questionsPerSubject, marginSeconds, breakMinutes],
      );
      idSetting = Number(result.insertId);
    }

    await connection.commit();
    return {
      id_setting: idSetting,
      id_classe: idClasse,
      id_type: idType,
      nom_classe: String(classe.nom_classe || ''),
      nom_type: String(type?.nom_type || 'Commun'),
      starts_at: startsAt,
      questions_per_subject: questionsPerSubject,
      margin_seconds: marginSeconds,
      break_minutes: breakMinutes,
    };
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
  }
}
