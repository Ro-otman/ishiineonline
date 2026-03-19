import { getClasseByName } from '../models/classes.model.js';
import { getLatestLigueSettings } from '../models/ligueSettings.model.js';
import { listMatieresForClasseAndType } from '../models/matieres.model.js';
import { listPresence } from '../models/liguePresence.model.js';
import { getSerieByIdOrName, listSeriesForClasse } from '../models/series.model.js';
import { buildSchedule } from '../services/ligueSchedule.service.js';

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

export async function getRooms(req, res, next) {
  try {
    const classe = String(req.query?.classe ?? '').trim();
    if (!classe) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Parametre "classe" requis (ex: ?classe=Tle)' },
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

    if (!roomId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'roomId requis' },
      });
    }

    if (!classe) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Parametre "classe" requis (ex: ?classe=Tle)' },
      });
    }

    const room = await getSerieByIdOrName(roomId);
    if (!room) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Salle introuvable' } });
    }

    const classRow = await getClasseByName(classe);
    if (!classRow) {
      return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Classe introuvable' } });
    }

    const settings = await getLatestLigueSettings({ id_classe: classRow.id_classe, id_type: room.id_type });
    if (!settings) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'LIGUE_NOT_CONFIGURED',
          message: "La ligue n'est pas encore configuree par l'administrateur pour cette classe/serie.",
        },
      });
    }

    const configuredStartBase =
      settings.starts_at instanceof Date ? settings.starts_at : new Date(settings.starts_at);
    if (Number.isNaN(configuredStartBase.getTime())) {
      return res.status(500).json({
        ok: false,
        error: { code: 'LIGUE_BAD_CONFIG', message: 'starts_at invalide dans ligue_settings' },
      });
    }

    const secondsPerQuestion = Number(settings.seconds_per_question);
    const questionsPerSubject = Number(settings.questions_per_subject);
    const marginSeconds = Number(settings.margin_seconds);
    const breakSeconds = Number(settings.break_seconds);

    const subjects = await listMatieresForClasseAndType({ id_classe: classRow.id_classe, id_type: room.id_type });

    const schedule = buildSchedule({
      startBase: configuredStartBase,
      subjects,
      secondsPerQuestion,
      questionsPerSubject,
      marginSeconds,
      breakSeconds,
    });

    return res.json({
      ok: true,
      classe: classRow.nom_classe,
      room,
      settings: {
        startsAt: schedule.startBase,
        configuredStartsAt: configuredStartBase.toISOString(),
        secondsPerQuestion,
        questionsPerSubject,
        marginSeconds,
        breakSeconds,
        updatedAt: toISO(settings.updated_at),
      },
      schedule,
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
