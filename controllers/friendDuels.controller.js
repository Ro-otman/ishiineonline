import crypto from 'node:crypto';

import {
  createFriendDuel,
  createFriendDuelRun,
  finalizeFriendDuelRun,
  getFriendDuelByCode,
  getFriendDuelRunContextById,
  insertFriendDuelRunAnswers,
  listLatestFriendDuelParticipants,
  listFriendDuelHistoryForUser,
} from '../models/friendDuels.model.js';
import {
  getLigueQuizPayloadByIds,
  getSaContextById,
  listCorrectOptionIdsByQuizIds,
  listQuizCandidatesForSa,
} from '../models/quiz.model.js';
import { getUserById } from '../models/users.model.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asInt(value) {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInt(value, { min = 0, max = 2147483647 } = {}) {
  const parsed = Number.parseInt(asString(value), 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function pickQuestionCount(requestedCount, availableCount) {
  if (!Number.isFinite(availableCount) || availableCount <= 0) return 0;
  const safeRequested = Number.isFinite(requestedCount) ? requestedCount : availableCount;
  return Math.max(1, Math.min(availableCount, safeRequested));
}

function buildDuelCode() {
  const token = crypto
    .randomBytes(6)
    .toString('base64url')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 8);
  return `IDUEL-${token}`;
}

async function generateUniqueDuelCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = buildDuelCode();
    const existing = await getFriendDuelByCode(code);
    if (!existing) return code;
  }
  const error = new Error('Impossible de generer un code duel unique.');
  error.statusCode = 503;
  error.code = 'DUEL_CODE_UNAVAILABLE';
  throw error;
}

function serializeDuel(duel, { createdByMe = false, savedAt = null } = {}) {
  if (!duel) return null;
  return {
    id_duel: asString(duel.id_duel),
    duel_code: asString(duel.duel_code),
    id_sa: Number(duel.id_sa),
    classe: asString(duel.classe_label),
    subject: asString(duel.subject_name),
    sa_name: asString(duel.sa_name),
    timer_seconds: Number(duel.timer_seconds),
    question_count: Number(duel.question_count),
    mode: asString(duel.mode) || 'exam',
    created_at: duel.created_at ? new Date(duel.created_at).toISOString() : null,
    created_by_me: Boolean(createdByMe),
    saved_at: savedAt ? new Date(savedAt).toISOString() : null,
  };
}

function buildParticipantFullName(participant) {
  const firstName = asString(participant?.prenoms);
  const lastName = asString(participant?.nom);
  return [firstName, lastName].filter(Boolean).join(' ').trim();
}

function participantSortScore(a, b) {
  const aSubmitted = Boolean(a?.has_submitted);
  const bSubmitted = Boolean(b?.has_submitted);
  if (aSubmitted !== bSubmitted) return aSubmitted ? -1 : 1;

  const correctDiff = Number(b?.correct_count ?? 0) - Number(a?.correct_count ?? 0);
  if (correctDiff !== 0) return correctDiff;

  const percentDiff = Number(b?.score_percent ?? 0) - Number(a?.score_percent ?? 0);
  if (Math.abs(percentDiff) > 0.001) return percentDiff > 0 ? 1 : -1;

  const aTime = Number(a?.total_response_time_ms ?? 0);
  const bTime = Number(b?.total_response_time_ms ?? 0);
  if (aTime > 0 && bTime > 0 && aTime !== bTime) return aTime - bTime;

  const aSubmittedAt = a?.submitted_at ? new Date(a.submitted_at).getTime() : 0;
  const bSubmittedAt = b?.submitted_at ? new Date(b.submitted_at).getTime() : 0;
  return aSubmittedAt - bSubmittedAt;
}

function determineWinnerUserId(participants) {
  const submitted = (Array.isArray(participants) ? participants : []).filter(
    (item) => item?.has_submitted,
  );
  if (submitted.length < 2) return null;

  const ranked = [...submitted].sort(participantSortScore);
  const first = ranked[0];
  const second = ranked[1];
  if (!first) return null;
  if (!second) return asString(first.id_user) || null;

  const sameScore =
    Number(first.correct_count ?? 0) === Number(second.correct_count ?? 0) &&
    Math.abs(Number(first.score_percent ?? 0) - Number(second.score_percent ?? 0)) <= 0.001;
  const firstTime = Number(first.total_response_time_ms ?? 0);
  const secondTime = Number(second.total_response_time_ms ?? 0);
  const sameTime =
    (firstTime <= 0 && secondTime <= 0) ||
    (firstTime > 0 && secondTime > 0 && firstTime === secondTime);
  if (sameScore && sameTime) return null;

  return asString(first.id_user) || null;
}

function resolveDuelStatus({ participants, participantCount, submittedCount }) {
  if (submittedCount >= 2) return 'finished';
  if (submittedCount >= 1) return 'waiting_opponent';
  if ((participants?.length ?? 0) > 0) return 'in_progress';
  if (participantCount > 0) return 'open';
  return 'open';
}

async function buildDuelResultPayload(duel, currentUserId) {
  const rawParticipants = await listLatestFriendDuelParticipants(duel.id_duel);
  const creatorId = asString(duel.id_user_creator);
  const currentUser = asString(currentUserId);

  const participants = rawParticipants.map((participant) => ({
    ...participant,
    full_name: buildParticipantFullName(participant),
    has_submitted: Boolean(participant?.submitted_at),
  }));

  if (
    creatorId &&
    creatorId !== currentUser &&
    !participants.some((item) => asString(item.id_user) === creatorId)
  ) {
    const creator = await getUserById(creatorId);
    participants.push({
      id_run: '',
      id_duel: duel.id_duel,
      id_user: creatorId,
      nom: asString(creator?.nom),
      prenoms: asString(creator?.prenoms),
      img_path: asString(creator?.img_path) || null,
      total_questions: 0,
      correct_count: 0,
      total_response_time_ms: 0,
      score_percent: 0,
      started_at: null,
      submitted_at: null,
      updated_at: null,
      full_name: buildParticipantFullName(creator),
      has_submitted: false,
    });
  }

  const submittedCount = participants.filter((item) => item.has_submitted).length;
  const participantCount = Math.max(2, participants.length);
  const winnerUserId = determineWinnerUserId(participants);

  const orderedParticipants = [...participants].sort((a, b) => {
    const aIsMe = asString(a.id_user) === currentUser;
    const bIsMe = asString(b.id_user) === currentUser;
    if (aIsMe !== bIsMe) return aIsMe ? -1 : 1;
    return participantSortScore(a, b);
  });

  const updatedAt = orderedParticipants
    .map((item) => item.updated_at || item.submitted_at || item.started_at)
    .filter(Boolean)
    .map((value) => new Date(value))
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return {
    ok: true,
    duel: serializeDuel(duel, {
      createdByMe: creatorId === currentUser,
      savedAt: updatedAt || duel.updated_at || duel.created_at,
    }),
    status: resolveDuelStatus({
      participants: orderedParticipants,
      participantCount,
      submittedCount,
    }),
    participant_count: participantCount,
    participantCount,
    participants_count: participantCount,
    participantsCount: participantCount,
    submitted_count: submittedCount,
    submittedCount,
    winner_user_id: winnerUserId,
    winnerUserId,
    updated_at: updatedAt ? updatedAt.toISOString() : null,
    updatedAt: updatedAt ? updatedAt.toISOString() : null,
    participants: orderedParticipants.map((participant) => ({
      id_user: asString(participant.id_user),
      prenoms: asString(participant.prenoms),
      nom: asString(participant.nom),
      full_name: asString(participant.full_name),
      img_path: participant.img_path || null,
      has_submitted: Boolean(participant.has_submitted),
      submitted_at: participant.submitted_at
        ? new Date(participant.submitted_at).toISOString()
        : null,
      total_questions: Number(participant.total_questions ?? 0),
      correct_count: Number(participant.correct_count ?? 0),
      score_percent: Number(participant.score_percent ?? 0),
      total_response_time_ms: Number(participant.total_response_time_ms ?? 0),
      is_winner:
        Boolean(winnerUserId) && asString(participant.id_user) === winnerUserId,
      is_me: asString(participant.id_user) === currentUser,
    })),
    results: orderedParticipants.map((participant) => ({
      id_user: asString(participant.id_user),
      prenoms: asString(participant.prenoms),
      nom: asString(participant.nom),
      full_name: asString(participant.full_name),
      img_path: participant.img_path || null,
      has_submitted: Boolean(participant.has_submitted),
      submitted_at: participant.submitted_at
        ? new Date(participant.submitted_at).toISOString()
        : null,
      total_questions: Number(participant.total_questions ?? 0),
      correct_count: Number(participant.correct_count ?? 0),
      score_percent: Number(participant.score_percent ?? 0),
      total_response_time_ms: Number(participant.total_response_time_ms ?? 0),
      is_winner:
        Boolean(winnerUserId) && asString(participant.id_user) === winnerUserId,
      is_me: asString(participant.id_user) === currentUser,
    })),
  };
}

function buildQuestionPayload(questions, timerSeconds) {
  const safeTimer = Math.max(1, Number(timerSeconds) || 30);
  return questions.map((question) => ({
    ...question,
    timer_seconds: safeTimer,
  }));
}

async function resolveAuthenticatedUser(userId) {
  const safeUserId = asString(userId);
  if (!safeUserId) return null;
  return getUserById(safeUserId);
}

export async function createDuelInvite(req, res, next) {
  try {
    const userId = asString(req.user?.idUser);
    const idSa = asInt(req.body?.idSa ?? req.body?.id_sa);
    const requestedTimerSeconds = clampInt(
      req.body?.timerSeconds ?? req.body?.timer_seconds,
      { min: 5, max: 600 },
    );
    const requestedQuestionCount = clampInt(
      req.body?.questionCount ?? req.body?.question_count,
      { min: 1, max: 200 },
    );
    const mode = asString(req.body?.mode) || 'exam';

    if (!userId || !idSa) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Champs requis: idSa.',
        },
      });
    }

    const user = await resolveAuthenticatedUser(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Utilisateur introuvable.',
        },
      });
    }

    const saContext = await getSaContextById(idSa);
    if (!saContext) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'SA_NOT_FOUND',
          message: 'Chapitre introuvable pour ce duel.',
        },
      });
    }

    const candidates = await listQuizCandidatesForSa({
      id_sa: idSa,
      seed: `friend-duel:${userId}:${idSa}:${Date.now()}`,
    });

    if (candidates.length === 0) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'NOT_ENOUGH_QUIZ',
          message: 'Aucun quiz disponible pour ce chapitre.',
        },
      });
    }

    const questionCount = pickQuestionCount(
      requestedQuestionCount,
      candidates.length,
    );
    const selectedQuizIds = candidates
      .slice(0, questionCount)
      .map((item) => Number(item.id_quiz))
      .filter((item) => item > 0);

    const duel = await createFriendDuel({
      id_duel: crypto.randomUUID(),
      duel_code: await generateUniqueDuelCode(),
      id_user_creator: userId,
      id_sa: idSa,
      classe_label: saContext.nom_classe,
      subject_name: saContext.nom_matiere,
      sa_name: saContext.nom_sa,
      timer_seconds: requestedTimerSeconds ?? 30,
      question_count: selectedQuizIds.length,
      mode,
      quiz_ids: selectedQuizIds,
    });

    return res.status(201).json({
      ok: true,
      duel: serializeDuel(duel, { createdByMe: true, savedAt: duel?.created_at }),
    });
  } catch (error) {
    return next(error);
  }
}

export async function getDuelInvite(req, res, next) {
  try {
    const userId = asString(req.user?.idUser);
    const code = asString(req.params?.code);
    if (!userId || !code) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Code duel invalide.',
        },
      });
    }

    const duel = await getFriendDuelByCode(code);
    if (!duel) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'DUEL_NOT_FOUND',
          message: 'Code duel introuvable.',
        },
      });
    }

    return res.json({
      ok: true,
      duel: serializeDuel(duel, {
        createdByMe: asString(duel.id_user_creator) === userId,
        savedAt: duel.created_at,
      }),
    });
  } catch (error) {
    return next(error);
  }
}

export async function listMyDuels(req, res, next) {
  try {
    const userId = asString(req.user?.idUser);
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'USER_AUTH_REQUIRED',
          message: 'Connexion utilisateur requise.',
        },
      });
    }

    const history = await listFriendDuelHistoryForUser(userId, 10);
    return res.json({
      ok: true,
      history: history.map((entry) =>
        serializeDuel(entry, {
          createdByMe: entry.created_by_me,
          savedAt: entry.saved_at,
        })),
    });
  } catch (error) {
    return next(error);
  }
}

export async function getDuelResult(req, res, next) {
  try {
    const userId = asString(req.user?.idUser);
    const code = asString(req.params?.code);
    if (!userId || !code) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Code duel invalide.',
        },
      });
    }

    const duel = await getFriendDuelByCode(code);
    if (!duel) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'DUEL_NOT_FOUND',
          message: 'Code duel introuvable.',
        },
      });
    }

    return res.json(await buildDuelResultPayload(duel, userId));
  } catch (error) {
    return next(error);
  }
}

export async function startDuelRun(req, res, next) {
  try {
    const userId = asString(req.user?.idUser);
    const code = asString(req.params?.code);
    if (!userId || !code) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Code duel invalide.',
        },
      });
    }

    const user = await resolveAuthenticatedUser(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'Utilisateur introuvable.',
        },
      });
    }

    const duel = await getFriendDuelByCode(code);
    if (!duel) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'DUEL_NOT_FOUND',
          message: 'Code duel introuvable.',
        },
      });
    }

    const quizIds = Array.isArray(duel.quiz_ids)
      ? duel.quiz_ids.map((item) => Number(item)).filter((item) => item > 0)
      : [];
    if (quizIds.length === 0) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'DUEL_EMPTY',
          message: 'Ce duel ne contient aucune question exploitable.',
        },
      });
    }

    const run = await createFriendDuelRun({
      id_run: crypto.randomUUID(),
      id_duel: duel.id_duel,
      id_user: userId,
      total_questions: quizIds.length,
    });

    const questions = buildQuestionPayload(
      await getLigueQuizPayloadByIds(quizIds),
      duel.timer_seconds,
    );

    return res.json({
      ok: true,
      duel: serializeDuel(duel, {
        createdByMe: asString(duel.id_user_creator) === userId,
        savedAt: run.started_at,
      }),
      room: {
        id: `friend-duel:${duel.id_duel}`,
        nom_serie: 'duel',
        id_type: null,
      },
      subject: {
        id_matiere: Number(duel.id_sa),
        nom_matiere: duel.subject_name,
      },
      weekKey: '',
      serverNow: new Date().toISOString(),
      quiz: {
        timerSource: 'duel_fixed',
        secondsPerQuestion: Number(duel.timer_seconds),
        questionsPerSubject: questions.length,
        durationSeconds: questions.length * Number(duel.timer_seconds),
        questionTimers: questions.map(() => Number(duel.timer_seconds)),
        useSocket: false,
        submitMode: 'duel',
      },
      run: {
        id_run: run.id_run,
        started_at: run.started_at,
        submitted_at: run.submitted_at,
        use_socket: false,
        submit_mode: 'duel',
      },
      questions,
    });
  } catch (error) {
    return next(error);
  }
}

export async function submitDuelRun(req, res, next) {
  try {
    const runId = asString(req.params?.runId);
    const userId = asString(req.user?.idUser);
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    if (!runId || !userId) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Run duel invalide.',
        },
      });
    }

    const runContext = await getFriendDuelRunContextById(runId);
    if (!runContext) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'RUN_NOT_FOUND',
          message: 'Run duel introuvable.',
        },
      });
    }

    if (asString(runContext.id_user) !== userId) {
      return res.status(403).json({
        ok: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Run duel non autorise.',
        },
      });
    }

    if (runContext.submitted_at) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'ALREADY_SUBMITTED',
          message: 'Ce run duel est deja soumis.',
        },
      });
    }

    const quizIds = Array.isArray(runContext.quiz_ids)
      ? runContext.quiz_ids.map((item) => Number(item)).filter((item) => item > 0)
      : [];
    if (quizIds.length === 0) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'RUN_NOT_READY',
          message: 'Aucune question associee a ce duel.',
        },
      });
    }

    const quizIdSet = new Set(quizIds);
    const answersByQuizId = new Map();
    for (const answer of answers) {
      const quizId = asInt(answer?.quizId ?? answer?.id_quiz);
      if (!quizId || !quizIdSet.has(quizId)) continue;
      answersByQuizId.set(quizId, {
        id_quiz: quizId,
        id_options: asInt(answer?.optionId ?? answer?.id_options),
        response_time_ms: clampInt(
          answer?.responseTimeMs ?? answer?.response_time_ms,
          { min: 0, max: 60 * 60 * 1000 },
        ),
      });
    }

    const correctOptionByQuizId = await listCorrectOptionIdsByQuizIds(quizIds);
    let correctCount = 0;
    let totalResponseTimeMs = 0;
    const rowsToInsert = [];

    for (const quizId of quizIds) {
      const answer = answersByQuizId.get(quizId) ?? {
        id_quiz: quizId,
        id_options: null,
        response_time_ms: null,
      };
      const correctOptionId = correctOptionByQuizId.get(quizId) ?? null;
      const isCorrect =
        answer.id_options &&
        correctOptionId &&
        Number(answer.id_options) === Number(correctOptionId)
          ? 1
          : 0;

      if (isCorrect) correctCount += 1;
      if (Number.isFinite(answer.response_time_ms)) {
        totalResponseTimeMs += answer.response_time_ms;
      }

      rowsToInsert.push({
        id_quiz: quizId,
        id_options: answer.id_options,
        is_correct: isCorrect,
        response_time_ms: answer.response_time_ms,
      });
    }

    await insertFriendDuelRunAnswers(runId, rowsToInsert);

    const totalQuestions =
      Number(runContext.total_questions ?? quizIds.length) || quizIds.length;
    const scorePercent =
      totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
    const updated = await finalizeFriendDuelRun({
      id_run: runId,
      correct_count: correctCount,
      total_response_time_ms: totalResponseTimeMs,
      score_percent: scorePercent,
    });

    return res.json({
      ok: true,
      run: {
        id_run: updated.id_run,
        submitted_at: updated.submitted_at,
        total_questions: Number(updated.total_questions),
        correct_count: Number(updated.correct_count),
        score_percent: Number(updated.score_percent),
        total_response_time_ms: Number(updated.total_response_time_ms),
      },
    });
  } catch (error) {
    return next(error);
  }
}
