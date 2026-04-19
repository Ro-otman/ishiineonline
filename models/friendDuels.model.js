import { execute } from '../config/db.js';

let ensureTablesPromise = null;

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeDuelCode(value) {
  return asString(value).toUpperCase();
}

function parseQuizIds(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => asInt(item))
      .filter((item) => item > 0);
  } catch (_) {
    return [];
  }
}

function serializeQuizIds(quizIds) {
  return JSON.stringify(
    (Array.isArray(quizIds) ? quizIds : [])
      .map((item) => asInt(item))
      .filter((item) => item > 0),
  );
}

function hydrateDuel(row) {
  if (!row) return null;
  return {
    id_duel: asString(row.id_duel),
    duel_code: asString(row.duel_code),
    id_user_creator: asString(row.id_user_creator),
    id_sa: asInt(row.id_sa),
    classe_label: asString(row.classe_label),
    subject_name: asString(row.subject_name),
    sa_name: asString(row.sa_name),
    timer_seconds: asInt(row.timer_seconds, 30),
    question_count: asInt(row.question_count),
    mode: asString(row.mode) || 'exam',
    quiz_ids: parseQuizIds(row.quiz_ids_json),
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
  };
}

function hydrateRun(row) {
  if (!row) return null;
  return {
    id_run: asString(row.id_run),
    id_duel: asString(row.id_duel),
    id_user: asString(row.id_user),
    total_questions: asInt(row.total_questions),
    correct_count: asInt(row.correct_count),
    total_response_time_ms: asInt(row.total_response_time_ms),
    score_percent: Number(row.score_percent ?? 0) || 0,
    started_at: row.started_at,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
  };
}

function hydrateResultParticipant(row) {
  if (!row) return null;
  return {
    id_run: asString(row.id_run),
    id_duel: asString(row.id_duel),
    id_user: asString(row.id_user),
    nom: asString(row.nom),
    prenoms: asString(row.prenoms),
    img_path: asString(row.img_path) || null,
    total_questions: asInt(row.total_questions),
    correct_count: asInt(row.correct_count),
    total_response_time_ms: asInt(row.total_response_time_ms),
    score_percent: Number(row.score_percent ?? 0) || 0,
    started_at: row.started_at,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
  };
}

export async function ensureFriendDuelTables() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = (async () => {
      await execute(
        `
          CREATE TABLE IF NOT EXISTS friend_duels (
            id_duel VARCHAR(64) PRIMARY KEY,
            duel_code VARCHAR(48) NOT NULL,
            id_user_creator VARCHAR(255) NOT NULL,
            id_sa INT NOT NULL,
            classe_label VARCHAR(120) NOT NULL,
            subject_name VARCHAR(120) NOT NULL,
            sa_name VARCHAR(255) NOT NULL,
            timer_seconds INT NOT NULL DEFAULT 30,
            question_count INT NOT NULL DEFAULT 0,
            mode VARCHAR(32) NOT NULL DEFAULT 'exam',
            quiz_ids_json LONGTEXT NOT NULL,
            expires_at DATETIME NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_friend_duels_code (duel_code),
            KEY idx_friend_duels_creator (id_user_creator, created_at),
            KEY idx_friend_duels_sa (id_sa),
            CONSTRAINT fk_friend_duels_creator FOREIGN KEY (id_user_creator)
              REFERENCES users(id_users)
              ON DELETE CASCADE,
            CONSTRAINT fk_friend_duels_sa FOREIGN KEY (id_sa)
              REFERENCES sa(id_sa)
              ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        [],
      );

      await execute(
        `
          CREATE TABLE IF NOT EXISTS friend_duel_runs (
            id_run VARCHAR(64) PRIMARY KEY,
            id_duel VARCHAR(64) NOT NULL,
            id_user VARCHAR(255) NOT NULL,
            total_questions INT NOT NULL DEFAULT 0,
            correct_count INT NOT NULL DEFAULT 0,
            total_response_time_ms INT NOT NULL DEFAULT 0,
            score_percent DECIMAL(6,2) NOT NULL DEFAULT 0,
            started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            submitted_at DATETIME NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            KEY idx_friend_duel_runs_duel (id_duel, started_at),
            KEY idx_friend_duel_runs_user (id_user, started_at),
            CONSTRAINT fk_friend_duel_runs_duel FOREIGN KEY (id_duel)
              REFERENCES friend_duels(id_duel)
              ON DELETE CASCADE,
            CONSTRAINT fk_friend_duel_runs_user FOREIGN KEY (id_user)
              REFERENCES users(id_users)
              ON DELETE CASCADE
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        [],
      );

      await execute(
        `
          CREATE TABLE IF NOT EXISTS friend_duel_run_answers (
            id_run VARCHAR(64) NOT NULL,
            id_quiz INT NOT NULL,
            id_options INT NULL,
            is_correct TINYINT(1) NOT NULL DEFAULT 0,
            response_time_ms INT NULL,
            answered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id_run, id_quiz),
            KEY idx_friend_duel_run_answers_quiz (id_quiz),
            CONSTRAINT fk_friend_duel_run_answers_run FOREIGN KEY (id_run)
              REFERENCES friend_duel_runs(id_run)
              ON DELETE CASCADE,
            CONSTRAINT fk_friend_duel_run_answers_quiz FOREIGN KEY (id_quiz)
              REFERENCES quiz(id_quiz)
              ON DELETE CASCADE,
            CONSTRAINT fk_friend_duel_run_answers_option FOREIGN KEY (id_options)
              REFERENCES \`options\`(id_options)
              ON DELETE SET NULL
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `,
        [],
      );
    })().catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  }

  return ensureTablesPromise;
}

export async function getFriendDuelById(id_duel) {
  await ensureFriendDuelTables();
  const rows = await execute(
    'SELECT * FROM friend_duels WHERE id_duel = ? LIMIT 1',
    [id_duel],
  );
  return hydrateDuel(rows[0]);
}

export async function getFriendDuelByCode(duel_code) {
  await ensureFriendDuelTables();
  const rows = await execute(
    `
      SELECT *
      FROM friend_duels
      WHERE duel_code = ?
        AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP())
      LIMIT 1
    `,
    [normalizeDuelCode(duel_code)],
  );
  return hydrateDuel(rows[0]);
}

export async function createFriendDuel({
  id_duel,
  duel_code,
  id_user_creator,
  id_sa,
  classe_label,
  subject_name,
  sa_name,
  timer_seconds,
  question_count,
  mode = 'exam',
  quiz_ids,
  expires_at = null,
}) {
  await ensureFriendDuelTables();
  await execute(
    `
      INSERT INTO friend_duels (
        id_duel,
        duel_code,
        id_user_creator,
        id_sa,
        classe_label,
        subject_name,
        sa_name,
        timer_seconds,
        question_count,
        mode,
        quiz_ids_json,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      asString(id_duel),
      normalizeDuelCode(duel_code),
      asString(id_user_creator),
      asInt(id_sa),
      asString(classe_label),
      asString(subject_name),
      asString(sa_name),
      Math.max(1, asInt(timer_seconds, 30)),
      Math.max(0, asInt(question_count)),
      asString(mode) || 'exam',
      serializeQuizIds(quiz_ids),
      expires_at,
    ],
  );

  return getFriendDuelById(id_duel);
}

export async function getFriendDuelRunById(id_run) {
  await ensureFriendDuelTables();
  const rows = await execute(
    'SELECT * FROM friend_duel_runs WHERE id_run = ? LIMIT 1',
    [id_run],
  );
  return hydrateRun(rows[0]);
}

export async function getFriendDuelRunContextById(id_run) {
  await ensureFriendDuelTables();
  const rows = await execute(
    `
      SELECT
        r.*,
        d.duel_code,
        d.id_sa,
        d.classe_label,
        d.subject_name,
        d.sa_name,
        d.timer_seconds,
        d.question_count AS duel_question_count,
        d.mode,
        d.quiz_ids_json
      FROM friend_duel_runs r
      JOIN friend_duels d ON d.id_duel = r.id_duel
      WHERE r.id_run = ?
      LIMIT 1
    `,
    [id_run],
  );

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    ...hydrateRun(row),
    duel_code: asString(row.duel_code),
    id_sa: asInt(row.id_sa),
    classe_label: asString(row.classe_label),
    subject_name: asString(row.subject_name),
    sa_name: asString(row.sa_name),
    timer_seconds: asInt(row.timer_seconds, 30),
    duel_question_count: asInt(row.duel_question_count),
    mode: asString(row.mode) || 'exam',
    quiz_ids: parseQuizIds(row.quiz_ids_json),
  };
}

export async function createFriendDuelRun({
  id_run,
  id_duel,
  id_user,
  total_questions,
}) {
  await ensureFriendDuelTables();
  await execute(
    `
      INSERT INTO friend_duel_runs (
        id_run,
        id_duel,
        id_user,
        total_questions
      ) VALUES (?, ?, ?, ?)
    `,
    [
      asString(id_run),
      asString(id_duel),
      asString(id_user),
      Math.max(0, asInt(total_questions)),
    ],
  );
  return getFriendDuelRunById(id_run);
}

export async function insertFriendDuelRunAnswers(id_run, answers) {
  await ensureFriendDuelTables();
  if (!Array.isArray(answers) || answers.length === 0) return;

  const values = [];
  const placeholders = answers
    .map((answer) => {
      values.push(
        asString(id_run),
        asInt(answer?.id_quiz),
        answer?.id_options == null ? null : asInt(answer.id_options),
        asInt(answer?.is_correct),
        answer?.response_time_ms == null ? null : asInt(answer.response_time_ms),
      );
      return '(?, ?, ?, ?, ?)';
    })
    .join(', ');

  await execute(
    `
      INSERT INTO friend_duel_run_answers (
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

export async function finalizeFriendDuelRun({
  id_run,
  correct_count,
  total_response_time_ms,
  score_percent,
}) {
  await ensureFriendDuelTables();
  await execute(
    `
      UPDATE friend_duel_runs
      SET
        submitted_at = CURRENT_TIMESTAMP,
        correct_count = ?,
        total_response_time_ms = ?,
        score_percent = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id_run = ?
    `,
    [
      Math.max(0, asInt(correct_count)),
      Math.max(0, asInt(total_response_time_ms)),
      Number(score_percent ?? 0) || 0,
      asString(id_run),
    ],
  );

  return getFriendDuelRunById(id_run);
}

export async function listFriendDuelHistoryForUser(id_user, limit = 10) {
  await ensureFriendDuelTables();
  const safeUserId = asString(id_user);
  const safeLimit = Math.max(1, asInt(limit, 10));
  const rows = await execute(
    `
      SELECT
        d.*,
        MAX(CASE
          WHEN r.id_user = ? THEN COALESCE(r.submitted_at, r.started_at)
          ELSE NULL
        END) AS last_played_at
      FROM friend_duels d
      LEFT JOIN friend_duel_runs r ON r.id_duel = d.id_duel
      WHERE d.id_user_creator = ?
         OR EXISTS (
           SELECT 1
           FROM friend_duel_runs rr
           WHERE rr.id_duel = d.id_duel
             AND rr.id_user = ?
         )
      GROUP BY
        d.id_duel,
        d.duel_code,
        d.id_user_creator,
        d.id_sa,
        d.classe_label,
        d.subject_name,
        d.sa_name,
        d.timer_seconds,
        d.question_count,
        d.mode,
        d.quiz_ids_json,
        d.expires_at,
        d.created_at,
        d.updated_at
      ORDER BY COALESCE(last_played_at, d.created_at) DESC
      LIMIT ?
    `,
    [safeUserId, safeUserId, safeUserId, safeLimit],
  );

  return rows.map((row) => ({
    ...hydrateDuel(row),
    created_by_me: asString(row.id_user_creator) === safeUserId,
    saved_at: row.last_played_at ?? row.created_at,
  }));
}

export async function listLatestFriendDuelParticipants(id_duel) {
  await ensureFriendDuelTables();
  const safeDuelId = asString(id_duel);
  if (!safeDuelId) return [];

  const rows = await execute(
    `
      SELECT
        r.id_run,
        r.id_duel,
        r.id_user,
        r.total_questions,
        r.correct_count,
        r.total_response_time_ms,
        r.score_percent,
        r.started_at,
        r.submitted_at,
        r.updated_at,
        u.nom,
        u.prenoms,
        u.img_path
      FROM friend_duel_runs r
      LEFT JOIN users u ON u.id_users = r.id_user
      WHERE r.id_duel = ?
        AND r.id_run = (
          SELECT rr.id_run
          FROM friend_duel_runs rr
          WHERE rr.id_duel = r.id_duel
            AND rr.id_user = r.id_user
          ORDER BY
            CASE WHEN rr.submitted_at IS NULL THEN 1 ELSE 0 END ASC,
            COALESCE(rr.submitted_at, rr.started_at) DESC,
            rr.started_at DESC,
            rr.updated_at DESC,
            rr.id_run DESC
          LIMIT 1
        )
      ORDER BY
        CASE WHEN r.submitted_at IS NULL THEN 1 ELSE 0 END ASC,
        r.correct_count DESC,
        r.score_percent DESC,
        CASE
          WHEN r.total_response_time_ms IS NULL OR r.total_response_time_ms <= 0 THEN 2147483647
          ELSE r.total_response_time_ms
        END ASC,
        r.started_at DESC
    `,
    [safeDuelId],
  );

  return rows
    .map((row) => hydrateResultParticipant(row))
    .filter((row) => row && row.id_user);
}
