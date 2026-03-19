import crypto from 'node:crypto';

import { getClasseByName } from '../models/classes.model.js';
import { getLatestLigueSettings } from '../models/ligueSettings.model.js';
import { listMatieresForClasseAndType } from '../models/matieres.model.js';
import { getSerieByIdOrName } from '../models/series.model.js';
import { getUserById } from '../models/users.model.js';

import {
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
  listLigueQuizIdsForMatiere,
} from '../models/quiz.model.js';

import { getLigueProfileByUserId } from '../models/ligueProfiles.model.js';
import { buildSchedule, computeQuestionWindow } from '../services/ligueSchedule.service.js';
import { getSubscriptionStatus } from '../services/subscription.service.js';
import { weekKeyFromDateUtc } from '../services/weekKey.service.js';

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

async function resolveContext({ roomId, classe }) {
  const room = await getSerieByIdOrName(roomId);
  if (!room) throw httpError(404, 'NOT_FOUND', 'Salle introuvable');

  const classRow = await getClasseByName(classe);
  if (!classRow) throw httpError(404, 'NOT_FOUND', 'Classe introuvable');

  const settings = await getLatestLigueSettings({
    id_classe: classRow.id_classe,
    id_type: room.id_type,
  });

  if (!settings) {
    throw httpError(
      409,
      'LIGUE_NOT_CONFIGURED',
      "La ligue n'est pas encore configuree par l'administrateur pour cette classe/serie.",
    );
  }

  const configuredStartBase =
    settings.starts_at instanceof Date ? settings.starts_at : new Date(settings.starts_at);
  if (Number.isNaN(configuredStartBase.getTime())) {
    throw httpError(500, 'LIGUE_BAD_CONFIG', 'starts_at invalide dans ligue_settings');
  }

  const secondsPerQuestion = Number(settings.seconds_per_question);
  const questionsPerSubject = Number(settings.questions_per_subject);
  const marginSeconds = Number(settings.margin_seconds);
  const breakSeconds = Number(settings.break_seconds);

  const subjects = await listMatieresForClasseAndType({
    id_classe: classRow.id_classe,
    id_type: room.id_type,
  });

  const schedule = buildSchedule({
    startBase: configuredStartBase,
    subjects,
    secondsPerQuestion,
    questionsPerSubject,
    marginSeconds,
    breakSeconds,
  });

  const effectiveStartBase = new Date(schedule.startBase);
  const weekKey = weekKeyFromDateUtc(effectiveStartBase) ?? weekKeyFromDateUtc(new Date());

  return {
    room,
    classRow,
    settings,
    configuredStartBase,
    startBase: effectiveStartBase,
    schedule,
    weekKey,
    secondsPerQuestion,
    questionsPerSubject,
    marginSeconds,
    breakSeconds,
  };
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

    const {
      room,
      classRow,
      startBase,
      schedule,
      weekKey,
      secondsPerQuestion,
      questionsPerSubject,
    } = await resolveContext({ roomId, classe });

    const slot = schedule.slots.find((s) => Number(s.id_matiere) === subjectId);
    if (!slot) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Matiere introuvable pour cette classe/serie' },
      });
    }

    const now = Date.now();
    const slotStartMs = Date.parse(slot.startAt);
    const questionWindow = computeQuestionWindow({
      slot,
      secondsPerQuestion,
      totalQuestions: questionsPerSubject,
      now: new Date(now),
    });
    const slotEndMs = Date.parse(slot.endAt);
    const quizEndMs = Number.isFinite(slotEndMs)
      ? slotEndMs
      : slotStartMs + secondsPerQuestion * questionsPerSubject * 1000;

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
      const quizIds = await listLigueQuizIdsForMatiere({
        id_classe: classRow.id_classe,
        id_type: room.id_type,
        id_matiere: subjectId,
        limit: questionsPerSubject,
      });

      if (quizIds.length < questionsPerSubject) {
        return res.status(409).json({
          ok: false,
          error: {
            code: 'NOT_ENOUGH_QUIZ',
            message: `Pas assez de quiz pour cette matiere (${quizIds.length}/${questionsPerSubject}).`,
          },
        });
      }

      await insertLigueRunQuestions(run.id_run, quizIds);
      runQuestions = await listLigueRunQuestions(run.id_run);
    }

    const quizIdsOrdered = runQuestions
      .sort((a, b) => a.question_index - b.question_index)
      .map((q) => q.id_quiz);

    const questions = await getLigueQuizPayloadByIds(quizIdsOrdered);

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
        secondsPerQuestion,
        questionsPerSubject,
        durationSeconds: secondsPerQuestion * questionsPerSubject,
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

    const questionQuizIds = runQuestions
      .sort((a, b) => a.question_index - b.question_index)
      .map((q) => Number(q.id_quiz));

    const quizIdSet = new Set(questionQuizIds);

    const answersByQuizId = new Map();
    for (const a of answers) {
      const quizId = asInt(a?.quizId ?? a?.id_quiz);
      if (!quizId || !quizIdSet.has(quizId)) continue;

      const optionId = asInt(a?.optionId ?? a?.id_options);
      const responseTimeMs = clampInt(a?.responseTimeMs ?? a?.response_time_ms, { min: 0, max: 60 * 60 * 1000 });

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
      const a = answersByQuizId.get(quizId) ?? { id_quiz: quizId, id_options: null, response_time_ms: null };
      const correctOptionId = correctOptionByQuizId.get(quizId) ?? null;

      const isCorrect =
        a.id_options && correctOptionId && Number(a.id_options) === Number(correctOptionId) ? 1 : 0;

      if (isCorrect) correctCount += 1;
      if (Number.isFinite(a.response_time_ms)) totalResponseTimeMs += a.response_time_ms;

      rowsToInsert.push({
        id_quiz: quizId,
        id_options: a.id_options,
        is_correct: isCorrect,
        response_time_ms: a.response_time_ms,
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

    const leaderboardRows = await getLigueLeaderboard({
      week_key: desiredWeekKey || weekKey,
      id_classe: classRow.id_classe,
      id_serie: room.id_serie,
      limit: req.query?.limit,
    });

    return res.json({
      ok: true,
      weekKey: desiredWeekKey || weekKey,
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
