import { listPresence } from '../models/liguePresence.model.js';
import {
  getSerieByIdOrName,
  listSeriesForClasse,
} from '../models/series.model.js';
import { resolveLigueRoomContext } from '../services/ligueRoomContext.service.js';

function toISO(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function compositeRoomKey(roomId, classe) {
  const safeRoomId = String(roomId ?? '').trim();
  const safeClasse = String(classe ?? '').trim();
  if (!safeRoomId) return '';
  if (!safeClasse) return safeRoomId;
  return `${safeClasse}::${safeRoomId}`;
}

function computeAverageSecondsPerQuestion(subjectPlans) {
  const list = Array.isArray(subjectPlans) ? subjectPlans : [];
  const totalQuestions = list.reduce(
    (sum, subject) => sum + Math.max(0, Number(subject?.questionCount) || 0),
    0,
  );
  const totalQuizSeconds = list.reduce(
    (sum, subject) => sum + Math.max(0, Number(subject?.totalQuizSeconds) || 0),
    0,
  );
  if (totalQuestions <= 0 || totalQuizSeconds <= 0) return 30;
  return Math.max(1, Math.round(totalQuizSeconds / totalQuestions));
}

export async function getRooms(req, res, next) {
  try {
    const classe = String(req.query?.classe ?? '').trim();
    if (!classe) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Parametre "classe" requis (ex: ?classe=Tle)',
        },
      });
    }
    const rooms = await listSeriesForClasse(classe);

    return res.json({
      ok: true,
      classe,
      rooms,
    });
  } catch (err) {
    return next(err);
  }
}

export async function getSubjects(req, res, next) {
  try {
    const roomId = String(req.params?.roomId ?? '').trim();
    const classe = String(req.query?.classe ?? '').trim();
    const weekKey = String(req.query?.weekKey ?? '').trim();

    if (!roomId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'roomId requis' },
      });
    }

    if (!classe) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Parametre "classe" requis (ex: ?classe=Tle)',
        },
      });
    }

    const context = await resolveLigueRoomContext({
      roomId,
      classe,
      requestedWeekKey: weekKey,
    });
    const averageSecondsPerQuestion = computeAverageSecondsPerQuestion(
      context.subjectPlans,
    );

    return res.json({
      ok: true,
      classe: context.classRow.nom_classe,
      room: context.room,
      settings: {
        startsAt: context.schedule.startBase,
        configuredStartsAt: context.configuredStartBase.toISOString(),
        timerSource: 'per_quiz',
        secondsPerQuestion: averageSecondsPerQuestion,
        averageSecondsPerQuestion,
        questionsPerSubject: context.questionsPerSubject,
        marginSeconds: context.marginSeconds,
        breakMinutes: Math.max(0, Math.round(context.breakSeconds / 60)),
        breakSeconds: context.breakSeconds,
        updatedAt: toISO(context.settings.updated_at),
      },
      schedule: context.schedule,
    });
  } catch (err) {
    return next(err);
  }
}

export function listParticipants(req, res) {
  const roomId = String(req.params?.roomId ?? '').trim();
  const classe = String(req.query?.classe ?? '').trim();
  const participants = listPresence(compositeRoomKey(roomId, classe));

  return res.json({
    ok: true,
    roomId,
    classe,
    count: participants.length,
    participants,
  });
}

