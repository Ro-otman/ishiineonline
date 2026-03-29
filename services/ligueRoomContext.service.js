import { getClasseByName } from '../models/classes.model.js';
import { getLatestLigueSettings } from '../models/ligueSettings.model.js';
import { listMatieresForClasseAndType } from '../models/matieres.model.js';
import { ensureWeeklyLigueQuizBank, groupWeeklyQuizBankBySubject } from '../models/ligueWeeklyQuizBank.model.js';
import { getSerieByIdOrName } from '../models/series.model.js';
import {
  WEEK_MS,
  buildSchedule,
  latestWeeklyOccurrence,
  nextWeeklyOccurrence,
} from './ligueSchedule.service.js';
import { weekKeyFromDateUtc } from './weekKey.service.js';

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseConfiguredStart(settings) {
  const date = settings?.starts_at instanceof Date
    ? settings.starts_at
    : new Date(settings?.starts_at);
  if (Number.isNaN(date.getTime())) {
    const err = new Error('starts_at invalide dans ligue_settings');
    err.statusCode = 500;
    err.code = 'LIGUE_BAD_CONFIG';
    throw err;
  }
  return date;
}

function resolveBreakSeconds(settings) {
  const breakMinutes = Math.max(0, asInt(settings?.break_minutes, 0));
  if (breakMinutes > 0) return breakMinutes * 60;
  const legacyBreakSeconds = Math.max(0, asInt(settings?.break_seconds, 0));
  return legacyBreakSeconds;
}

function buildTimedSubjects({ subjects, bankRows, questionsPerSubject, marginSeconds }) {
  const grouped = groupWeeklyQuizBankBySubject(bankRows);
  return subjects.map((subject) => {
    const subjectId = asInt(subject.id_matiere ?? subject.idMatiere);
    const rows = grouped.get(subjectId) ?? [];
    if (rows.length < questionsPerSubject) {
      const err = new Error(
        `Banque ligue incomplete pour la matiere ${subject.nom_matiere ?? subject.nomMatiere ?? subjectId}.`,
      );
      err.statusCode = 409;
      err.code = 'RUN_NOT_READY';
      throw err;
    }

    const selected = rows.slice(0, questionsPerSubject);
    const questionTimers = selected.map((row) => Math.max(1, asInt(row.timer_seconds, 30)));
    const totalQuizSeconds = questionTimers.reduce((sum, value) => sum + value, 0);

    return {
      id_matiere: subjectId,
      nom_matiere: subject.nom_matiere ?? subject.nomMatiere ?? '',
      questionCount: selected.length,
      questionTimers,
      totalQuizSeconds,
      averageSecondsPerQuestion: selected.length > 0
        ? Math.max(1, Math.round(totalQuizSeconds / selected.length))
        : 30,
      durationSeconds: totalQuizSeconds + marginSeconds,
    };
  });
}

async function buildPlanForCycle({
  cycleStart,
  weekKey,
  room,
  classRow,
  questionsPerSubject,
  marginSeconds,
  breakSeconds,
}) {
  const subjects = await listMatieresForClasseAndType({
    id_classe: classRow.id_classe,
    id_type: room.id_type,
  });

  const bankRows = await ensureWeeklyLigueQuizBank({
    week_key: weekKey,
    id_classe: classRow.id_classe,
    room,
    subjects,
    questions_per_subject: questionsPerSubject,
    eligible_at: cycleStart,
  });

  const timedSubjects = buildTimedSubjects({
    subjects,
    bankRows,
    questionsPerSubject,
    marginSeconds,
  });

  const schedule = buildSchedule({
    cycleStart,
    subjects: timedSubjects,
    breakSeconds,
  });

  return {
    weekKey,
    schedule,
    subjects: timedSubjects,
    bankRows,
  };
}

export async function resolveLigueRoomContext({ roomId, classe, now = new Date() }) {
  const room = await getSerieByIdOrName(roomId);
  if (!room) {
    const err = new Error('Salle introuvable');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const classRow = await getClasseByName(classe);
  if (!classRow) {
    const err = new Error('Classe introuvable');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const settings = await getLatestLigueSettings({
    id_classe: classRow.id_classe,
    id_type: room.id_type,
  });
  if (!settings) {
    const err = new Error("La ligue n'est pas encore configuree par l'administrateur pour cette classe/serie.");
    err.statusCode = 409;
    err.code = 'LIGUE_NOT_CONFIGURED';
    throw err;
  }

  const configuredStartBase = parseConfiguredStart(settings);
  const questionsPerSubject = Math.max(1, asInt(settings.questions_per_subject, 1));
  const marginSeconds = Math.max(0, asInt(settings.margin_seconds, 0));
  const breakSeconds = resolveBreakSeconds(settings);

  const latestStart = latestWeeklyOccurrence({ startBase: configuredStartBase, now });
  const latestWeekKey = weekKeyFromDateUtc(latestStart) ?? weekKeyFromDateUtc(now) ?? '';
  const currentPlan = await buildPlanForCycle({
    cycleStart: latestStart,
    weekKey: latestWeekKey,
    room,
    classRow,
    questionsPerSubject,
    marginSeconds,
    breakSeconds,
  });

  const currentCycleEndMs = Date.parse(currentPlan.schedule.cycleEndAt);
  let selectedPlan = currentPlan;
  if (Number.isFinite(currentCycleEndMs) && currentCycleEndMs <= new Date(now).getTime()) {
    const nextStart = nextWeeklyOccurrence(latestStart);
    const nextWeekKey = weekKeyFromDateUtc(nextStart) ?? weekKeyFromDateUtc(new Date(latestStart.getTime() + WEEK_MS)) ?? latestWeekKey;
    selectedPlan = await buildPlanForCycle({
      cycleStart: nextStart,
      weekKey: nextWeekKey,
      room,
      classRow,
      questionsPerSubject,
      marginSeconds,
      breakSeconds,
    });
  }

  const subjectPlansByMatiereId = new Map(
    selectedPlan.subjects.map((subject) => [Number(subject.id_matiere), subject]),
  );

  return {
    room,
    classRow,
    settings,
    configuredStartBase,
    startBase: new Date(selectedPlan.schedule.startBase),
    weekKey: selectedPlan.weekKey,
    questionsPerSubject,
    marginSeconds,
    breakSeconds,
    schedule: selectedPlan.schedule,
    subjectPlans: selectedPlan.subjects,
    subjectPlansByMatiereId,
    weeklyQuizBank: selectedPlan.bankRows,
  };
}
