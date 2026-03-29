export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function asDate(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}

function asInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeQuestionTimers(questionTimers) {
  if (!Array.isArray(questionTimers)) return [];
  return questionTimers
    .map((value) => Math.max(1, asInt(value, 0)))
    .filter((value) => value > 0);
}

export function computeTotalCompetitionSeconds({
  subjects,
  breakSeconds,
}) {
  const safeSubjects = Array.isArray(subjects) ? subjects : [];
  const safeBreakSeconds = Math.max(0, asInt(breakSeconds, 0));
  if (safeSubjects.length === 0) return 0;

  const slotsTotal = safeSubjects.reduce(
    (sum, subject) => sum + Math.max(1, asInt(subject?.durationSeconds, 1)),
    0,
  );

  return slotsTotal + Math.max(0, safeSubjects.length - 1) * safeBreakSeconds;
}

export function latestWeeklyOccurrence({ startBase, now = new Date() }) {
  const base = asDate(startBase);
  if (Number.isNaN(base.getTime())) {
    const err = new Error('startBase invalide');
    err.statusCode = 500;
    err.code = 'LIGUE_BAD_CONFIG';
    throw err;
  }

  const current = asDate(now);
  if (Number.isNaN(current.getTime()) || current.getTime() <= base.getTime()) {
    return new Date(base.getTime());
  }

  const elapsedMs = current.getTime() - base.getTime();
  const weeksElapsed = Math.floor(elapsedMs / WEEK_MS);
  return new Date(base.getTime() + weeksElapsed * WEEK_MS);
}

export function nextWeeklyOccurrence(start) {
  const base = asDate(start);
  return new Date(base.getTime() + WEEK_MS);
}

export function computeQuestionWindow({
  slot,
  questionTimers,
  now = new Date(),
}) {
  const timers = normalizeQuestionTimers(questionTimers);
  if (!slot || timers.length === 0) return null;

  const slotStartMs = Date.parse(slot.startAt);
  if (!Number.isFinite(slotStartMs)) return null;

  const slotEndMs = Date.parse(slot.endAt);
  const totalQuizSeconds = timers.reduce((sum, value) => sum + value, 0);
  const baseRunEndMs = slotStartMs + totalQuizSeconds * 1000;
  const runEndMs = Number.isFinite(slotEndMs) && slotEndMs > baseRunEndMs
    ? slotEndMs
    : baseRunEndMs;

  const current = asDate(now);
  if (Number.isNaN(current.getTime())) return null;
  const nowMs = current.getTime();

  if (nowMs < slotStartMs || nowMs >= runEndMs) {
    return null;
  }

  let cursorMs = slotStartMs;
  for (let index = 0; index < timers.length; index += 1) {
    const timerSeconds = timers[index];
    const isLast = index >= timers.length - 1;
    const questionEndMs = isLast ? runEndMs : cursorMs + timerSeconds * 1000;

    if (nowMs < questionEndMs) {
      return {
        questionIndex: index,
        remainingSeconds: Math.max(0, Math.ceil((questionEndMs - nowMs) / 1000)),
        missedQuestions: index,
        questionStartAt: new Date(cursorMs).toISOString(),
        questionEndAt: new Date(questionEndMs).toISOString(),
        runEndAt: new Date(runEndMs).toISOString(),
        questionTimerSeconds: timerSeconds,
      };
    }

    cursorMs += timerSeconds * 1000;
  }

  return null;
}

export function buildSchedule({
  cycleStart,
  subjects,
  breakSeconds,
  now = new Date(),
}) {
  const base = asDate(cycleStart);
  if (Number.isNaN(base.getTime())) {
    const err = new Error('cycleStart invalide');
    err.statusCode = 500;
    err.code = 'LIGUE_BAD_CONFIG';
    throw err;
  }

  const safeSubjects = Array.isArray(subjects) ? subjects : [];
  const safeBreakSeconds = Math.max(0, asInt(breakSeconds, 0));
  let cursorMs = base.getTime();

  const slots = safeSubjects.map((subject, index) => {
    const questionTimers = normalizeQuestionTimers(subject?.questionTimers);
    const questionCount = Math.max(0, asInt(subject?.questionCount, questionTimers.length));
    const totalQuizSeconds = questionTimers.reduce((sum, value) => sum + value, 0);
    const durationSeconds = Math.max(
      Math.max(1, totalQuizSeconds),
      asInt(subject?.durationSeconds, totalQuizSeconds || 1),
    );

    const startAt = new Date(cursorMs);
    const endAt = new Date(cursorMs + durationSeconds * 1000);

    cursorMs = endAt.getTime() + safeBreakSeconds * 1000;

    return {
      index,
      ...subject,
      questionCount,
      questionTimers,
      totalQuizSeconds,
      durationSeconds,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
    };
  });

  const totalCompetitionSeconds = computeTotalCompetitionSeconds({
    subjects: slots,
    breakSeconds: safeBreakSeconds,
  });

  const cycleEndAt = slots.length > 0
    ? slots[slots.length - 1].endAt
    : new Date(base.getTime()).toISOString();

  const currentNow = asDate(now);
  const nowMs = currentNow.getTime();
  const current = slots.find((slot) => {
    const startMs = Date.parse(slot.startAt);
    const endMs = Date.parse(slot.endAt);
    return Number.isFinite(startMs) && Number.isFinite(endMs) && nowMs >= startMs && nowMs < endMs;
  }) ?? null;
  const next = slots.find((slot) => nowMs < Date.parse(slot.startAt)) ?? null;

  let status = 'waiting_next_cycle';
  if (current) {
    status = 'subject_live';
  } else if (next) {
    status = next.index > 0 ? 'break' : 'countdown';
  }

  return {
    startBase: base.toISOString(),
    breakSeconds: safeBreakSeconds,
    totalCompetitionSeconds,
    cycleEndAt,
    slots,
    current,
    next,
    status,
  };
}
