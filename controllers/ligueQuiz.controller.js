import crypto from 'node:crypto';

import { getUserById } from '../models/users.model.js';
import {
  findLatestNonEmptyLeaderboardWeekKey,
  createLigueRun,
  finalizeLigueRun,
  getLigueLeaderboard,
  getLigueRunById,
  getLigueRunByUnique,
  insertLigueRunAnswers,
  insertLigueRunQuestions,
  listLigueRunQuestions,
} from '../models/ligueRuns.model.js';
import {
  getLigueQuizPayloadByIds,
  listCorrectOptionIdsByQuizIds,
} from '../models/quiz.model.js';
import { getLigueProfileByUserId } from '../models/ligueProfiles.model.js';
import { resolveLigueRoomContext } from '../services/ligueRoomContext.service.js';
import { computeQuestionWindow } from '../services/ligueSchedule.service.js';
import { getSubscriptionStatus } from '../services/subscription.service.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function asInt(value) {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampInt(value, { min = 0, max = 2147483647 } = {}) {
  const n = Number.parseInt(asString(value), 10);
  if (!Number.isFinite(n)) return null;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeSalleKey(raw) {
  const clean = asString(raw).trim();
  if (!clean) return '';

  const root = clean.split('/')[0].trim();
  const lower = root.toLowerCase();

  if (lower.startsWith('3')) return '3eme';
  if (lower.startsWith('2')) return '2nde';
  if (lower.startsWith('1')) return '1ere';
  if (lower.includes('tle') || lower.includes('term')) return 'Tle';
  return root;
}

function httpError(statusCode, code, message, details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.details = details;
  return err;
}

function averageSecondsPerQuestion(runQuestions) {
  const list = Array.isArray(runQuestions) ? runQuestions : [];
  if (list.length === 0) return 30;
  const totalSeconds = list.reduce(
    (sum, item) => sum + Math.max(1, Number(item?.timer_seconds) || 0),
    0,
  );
  return Math.max(1, Math.round(totalSeconds / list.length));
}

function questionTimersFromRun(runQuestions) {
  return (Array.isArray(runQuestions) ? runQuestions : [])
    .sort((a, b) => Number(a.question_index) - Number(b.question_index))
    .map((item) => Math.max(1, Number(item.timer_seconds) || 30));
}

async function resolveContext({ roomId, classe }) {
  return resolveLigueRoomContext({ roomId, classe });
}

export async function startSubjectRun(req, res, next) {
  try {
    const roomId = asString(req.params?.roomId).trim();
    const subjectId = asInt(req.params?.subjectId);
    const classe = asString(req.query?.classe).trim();
    const devBypass = asString(req.query?.dev).trim() === '1';

    const body = req.body || {};
    const userId = asString(body.userId || body.id_user || body.id_users).trim();

    if (!roomId || !classe || !subjectId || !userId) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Champs requis: roomId, subjectId, userId + query ?classe=',
        },
      });
    }

    const context = await resolveContext({ roomId, classe });
    const {
      room,
      classRow,
      startBase,
      schedule,
      weekKey,
      questionsPerSubject,
      subjectPlansByMatiereId,
      weeklyQuizBank,
    } = context;

    const slot = schedule.slots.find((entry) => Number(entry.id_matiere) === subjectId);
    const subjectPlan = subjectPlansByMatiereId.get(subjectId) ?? null;
    if (!slot || !subjectPlan) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Matiere introuvable pour cette classe/serie' },
      });
    }

    const now = Date.now();
    const slotStartMs = Date.parse(slot.startAt);
    const slotEndMs = Date.parse(slot.endAt);
    const questionWindow = computeQuestionWindow({
      slot,
      questionTimers: subjectPlan.questionTimers,
      now: new Date(now),
    });
    const quizEndMs = Number.isFinite(slotEndMs)
      ? slotEndMs
      : slotStartMs + Math.max(1, Number(subjectPlan.totalQuizSeconds) || 1) * 1000;

    if (!devBypass) {
      const user = await getUserById(userId);
      if (!user) {
        return res.status(404).json({
          ok: false,
          error: { code: 'USER_NOT_FOUND', message: 'Utilisateur introuvable' },
        });
      }

      const subscription = getSubscriptionStatus(user);
      if (!subscription.active) {
        return res.status(403).json({
          ok: false,
          error: {
            code: 'SUBSCRIPTION_REQUIRED',
            message: subscription.reason === 'EXPIRED' ? 'Abonnement expire' : 'Abonnement requis',
          },
        });
      }

      const ligueProfile = await getLigueProfileByUserId(userId);
      if (!ligueProfile) {
        return res.status(403).json({
          ok: false,
          error: {
            code: 'LIGUE_PROFILE_REQUIRED',
            message: 'Inscription ligue requise avant de rejoindre une salle.',
          },
        });
      }

      const requestedSalleKey = normalizeSalleKey(classe);
      const lockedSalleKey = normalizeSalleKey(ligueProfile.salle_key);
      if (lockedSalleKey && requestedSalleKey && lockedSalleKey !== requestedSalleKey) {
        return res.status(403).json({
          ok: false,
          error: {
            code: 'SALLE_LOCKED',
            message: 'Cette salle ne correspond pas a celle choisie lors de l inscription.',
          },
          ligueProfile,
        });
      }

      const lockedSerieKey = asString(ligueProfile.serie_key).trim().toUpperCase();
      const requestedSerieKey = asString(room.nom_serie).trim().toUpperCase();
      if (lockedSerieKey && requestedSerieKey && lockedSerieKey !== requestedSerieKey) {
        return res.status(403).json({
          ok: false,
          error: {
            code: 'SERIE_LOCKED',
            message: 'Cette serie ne correspond pas a la salle validee par l utilisateur.',
          },
          ligueProfile,
        });
      }

      const currentId = schedule.current ? Number(schedule.current.id_matiere) : null;
      if (!currentId) {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'NO_ACTIVE_SUBJECT',
            message: "Aucune matiere n'est active pour le moment.",
          },
          serverNow: new Date().toISOString(),
          startBase: startBase.toISOString(),
        });
      }

      if (currentId !== subjectId) {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'NOT_CURRENT_SUBJECT',
            message: 'Seule la matiere en cours est jouable.',
          },
          serverNow: new Date().toISOString(),
          current: schedule.current,
        });
      }

      if (Number.isFinite(slotStartMs) && now < slotStartMs) {
        return res.status(409).json({
          ok: false,
          error: { code: 'NOT_STARTED', message: "Le quiz de cette matiere n'a pas encore commence." },
          serverNow: new Date().toISOString(),
          startsAt: slot.startAt,
        });
      }

      if (!questionWindow || (Number.isFinite(quizEndMs) && now >= quizEndMs)) {
        return res.status(409).json({
          ok: false,
          error: { code: 'ENDED', message: 'Le quiz de cette matiere est termine.' },
          serverNow: new Date().toISOString(),
          endedAt: new Date(quizEndMs).toISOString(),
        });
      }
    }

    let run = await getLigueRunByUnique({
      week_key: weekKey,
      id_user: userId,
      id_classe: classRow.id_classe,
      id_serie: room.id_serie,
      id_matiere: subjectId,
    });

    if (run?.submitted_at) {
      return res.status(409).json({
        ok: false,
        error: { code: 'ALREADY_SUBMITTED', message: 'Tu as deja compose cette matiere.' },
        run,
      });
    }

    if (!run) {
      run = await createLigueRun({
        id_run: crypto.randomUUID(),
        week_key: weekKey,
        id_user: userId,
        id_classe: classRow.id_classe,
        id_serie: room.id_serie,
        id_matiere: subjectId,
        total_questions: questionsPerSubject,
      });
    }

    let runQuestions = await listLigueRunQuestions(run.id_run);

    if (runQuestions.length === 0) {
      const weeklyQuestions = weeklyQuizBank
        .filter((row) => Number(row.id_matiere) === subjectId)
        .sort((a, b) => Number(a.question_index) - Number(b.question_index));

      if (weeklyQuestions.length < questionsPerSubject) {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'NOT_ENOUGH_QUIZ',
            message: `Pas assez de quiz pour cette matiere (${weeklyQuestions.length}/${questionsPerSubject}).`,
          },
        });
      }

      await insertLigueRunQuestions(run.id_run, weeklyQuestions);
      runQuestions = await listLigueRunQuestions(run.id_run);
    }

    const orderedRunQuestions = [...runQuestions].sort(
      (a, b) => Number(a.question_index) - Number(b.question_index),
    );
    const quizIdsOrdered = orderedRunQuestions.map((item) => Number(item.id_quiz));
    const timersByQuizId = new Map(
      orderedRunQuestions.map((item) => [Number(item.id_quiz), Math.max(1, Number(item.timer_seconds) || 30)]),
    );

    const questions = (await getLigueQuizPayloadByIds(quizIdsOrdered)).map((question) => ({
      ...question,
      timer_seconds: timersByQuizId.get(Number(question.id_quiz)) ?? Math.max(1, Number(question.timer_seconds) || 30),
    }));
    const totalQuizDurationSeconds = orderedRunQuestions.reduce(
      (sum, item) => sum + Math.max(1, Number(item.timer_seconds) || 30),
      0,
    );

    return res.json({
      ok: true,
      devBypass,
      weekKey,
      classe: classRow.nom_classe,
      room,
      subject: { id_matiere: Number(slot.id_matiere), nom_matiere: slot.nom_matiere },
      slot,
      serverNow: new Date().toISOString(),
      quiz: {
        timerSource: 'per_quiz',
        secondsPerQuestion: averageSecondsPerQuestion(orderedRunQuestions),
        questionsPerSubject: orderedRunQuestions.length,
        durationSeconds: totalQuizDurationSeconds,
        questionTimers: orderedRunQuestions.map((item) => Math.max(1, Number(item.timer_seconds) || 30)),
      },
      run: {
        id_run: run.id_run,
        started_at: run.started_at,
        submitted_at: run.submitted_at,
      },
      questions,
    });
  } catch (err) {
    return next(err);
  }
}

export async function submitRun(req, res, next) {
  try {
    const runId = asString(req.params?.runId).trim();
    const body = req.body || {};

    const userId = asString(body.userId || body.id_user || body.id_users).trim();
    const answers = Array.isArray(body.answers) ? body.answers : [];

    if (!runId || !userId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Champs requis: runId + userId' },
      });
    }

    const run = await getLigueRunById(runId);
    if (!run) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Run introuvable' },
      });
    }

    if (String(run.id_user) !== userId) {
      return res.status(403).json({
        ok: false,
        error: { code: 'FORBIDDEN', message: 'Run non autorise' },
      });
    }

    if (run.submitted_at) {
      return res.status(409).json({
        ok: false,
        error: { code: 'ALREADY_SUBMITTED', message: 'Ce run est deja soumis.' },
        run,
      });
    }

    const runQuestions = await listLigueRunQuestions(runId);
    if (runQuestions.length === 0) {
      throw httpError(400, 'RUN_NOT_READY', 'Aucune question associee a ce run');
    }

    const questionQuizIds = [...runQuestions]
      .sort((a, b) => a.question_index - b.question_index)
      .map((item) => Number(item.id_quiz));

    const quizIdSet = new Set(questionQuizIds);

    const answersByQuizId = new Map();
    for (const answer of answers) {
      const quizId = asInt(answer?.quizId ?? answer?.id_quiz);
      if (!quizId || !quizIdSet.has(quizId)) continue;

      const optionId = asInt(answer?.optionId ?? answer?.id_options);
      const responseTimeMs = clampInt(answer?.responseTimeMs ?? answer?.response_time_ms, {
        min: 0,
        max: 60 * 60 * 1000,
      });

      answersByQuizId.set(quizId, {
        id_quiz: quizId,
        id_options: optionId,
        response_time_ms: responseTimeMs,
      });
    }

    const correctOptionByQuizId = await listCorrectOptionIdsByQuizIds(questionQuizIds);

    let correctCount = 0;
    let totalResponseTimeMs = 0;
    const rowsToInsert = [];

    for (const quizId of questionQuizIds) {
      const answer = answersByQuizId.get(quizId) ?? {
        id_quiz: quizId,
        id_options: null,
        response_time_ms: null,
      };
      const correctOptionId = correctOptionByQuizId.get(quizId) ?? null;

      const isCorrect =
        answer.id_options && correctOptionId && Number(answer.id_options) === Number(correctOptionId) ? 1 : 0;

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

    await insertLigueRunAnswers(runId, rowsToInsert);

    const totalQuestions = Number(run.total_questions ?? questionQuizIds.length) || questionQuizIds.length;
    const scorePercent = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;

    const updated = await finalizeLigueRun({
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
  } catch (err) {
    return next(err);
  }
}

export async function leaderboard(req, res, next) {
  try {
    const roomId = asString(req.params?.roomId).trim();
    const classe = asString(req.query?.classe).trim();

    if (!roomId || !classe) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Parametres requis: roomId + ?classe=' },
      });
    }

    const desiredWeekKey = asString(req.query?.weekKey).trim();
    const { room, classRow, weekKey } = await resolveContext({ roomId, classe });
    let effectiveWeekKey = desiredWeekKey || weekKey;

    let leaderboardRows = await getLigueLeaderboard({
      week_key: effectiveWeekKey,
      id_classe: classRow.id_classe,
      id_serie: room.id_serie,
      limit: req.query?.limit,
    });

    if (!desiredWeekKey && leaderboardRows.length === 0) {
      const fallbackWeekKey = await findLatestNonEmptyLeaderboardWeekKey({
        id_classe: classRow.id_classe,
        id_serie: room.id_serie,
        beforeOrEqualWeekKey: effectiveWeekKey,
      });

      if (fallbackWeekKey && fallbackWeekKey !== effectiveWeekKey) {
        const fallbackRows = await getLigueLeaderboard({
          week_key: fallbackWeekKey,
          id_classe: classRow.id_classe,
          id_serie: room.id_serie,
          limit: req.query?.limit,
        });

        if (fallbackRows.length > 0) {
          effectiveWeekKey = fallbackWeekKey;
          leaderboardRows = fallbackRows;
        }
      }
    }

    return res.json({
      ok: true,
      weekKey: effectiveWeekKey,
      classe: classRow.nom_classe,
      room,
      count: leaderboardRows.length,
      winners: leaderboardRows.slice(0, 3),
      leaderboard: leaderboardRows,
    });
  } catch (err) {
    return next(err);
  }
}
