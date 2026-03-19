export function computeTotalCompetitionSeconds({
  subjectCount,
  slotDurationSeconds,
  breakSeconds,
}) {
  const safeSubjectCount = Number(subjectCount) || 0;
  if (safeSubjectCount <= 0) return 0;

  const safeSlotDuration = Math.max(0, Number(slotDurationSeconds) || 0);
  const safeBreakSeconds = Math.max(0, Number(breakSeconds) || 0);

  return safeSubjectCount * safeSlotDuration + Math.max(0, safeSubjectCount - 1) * safeBreakSeconds;
}

export function computeRecurringStart({
  startBase,
  totalCompetitionSeconds,
  now = new Date(),
}) {
  const base = startBase instanceof Date ? startBase : new Date(startBase);
  if (Number.isNaN(base.getTime())) {
    const err = new Error('startBase invalide');
    err.statusCode = 500;
    err.code = 'LIGUE_BAD_CONFIG';
    throw err;
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) {
    return new Date(base.getTime());
  }

  const totalMs = Math.max(0, Number(totalCompetitionSeconds) || 0) * 1000;
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const baseMs = base.getTime();
  const nowMs = nowDate.getTime();

  if (nowMs < baseMs) {
    return new Date(baseMs);
  }

  const elapsedSinceBaseMs = nowMs - baseMs;
  const weeksElapsed = Math.floor(elapsedSinceBaseMs / weekMs);
  let cycleStartMs = baseMs + weeksElapsed * weekMs;

  if (totalMs > 0 && nowMs >= cycleStartMs + totalMs) {
    cycleStartMs += weekMs;
  }

  return new Date(cycleStartMs);
}

export function computeQuestionWindow({
  slot,
  secondsPerQuestion,
  totalQuestions,
  now = new Date(),
}) {
  if (!slot || totalQuestions <= 0 || secondsPerQuestion <= 0) {
    return null;
  }

  const slotStartMs = Date.parse(slot.startAt);
  if (!Number.isFinite(slotStartMs)) return null;

  const nowDate = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(nowDate.getTime())) return null;

  const questionDurationMs = Math.max(1, Number(secondsPerQuestion)) * 1000;
  const baseRunEndMs = slotStartMs + questionDurationMs * Math.max(1, Number(totalQuestions));
  const slotEndMs = Date.parse(slot.endAt);
  const runEndMs = Number.isFinite(slotEndMs) && slotEndMs > baseRunEndMs ? slotEndMs : baseRunEndMs;
  const nowMs = nowDate.getTime();

  if (nowMs < slotStartMs || nowMs >= runEndMs) {
    return null;
  }

  const elapsedMs = nowMs - slotStartMs;
  const rawIndex = Math.floor(elapsedMs / questionDurationMs);
  const questionIndex = Math.min(
    Math.max(0, totalQuestions - 1),
    rawIndex,
  );
  const questionStartMs = slotStartMs + questionIndex * questionDurationMs;
  const questionEndMs = questionIndex >= totalQuestions - 1
    ? runEndMs
    : Math.min(runEndMs, questionStartMs + questionDurationMs);
  const remainingSeconds = Math.max(
    0,
    Math.ceil((questionEndMs - nowMs) / 1000),
  );

  return {
    questionIndex,
    remainingSeconds,
    missedQuestions: Math.max(0, Math.min(totalQuestions - 1, rawIndex)),
    questionStartAt: new Date(questionStartMs).toISOString(),
    questionEndAt: new Date(questionEndMs).toISOString(),
    runEndAt: new Date(runEndMs).toISOString(),
  };
}

export function buildSchedule({
  startBase,
  subjects,
  secondsPerQuestion,
  questionsPerSubject,
  marginSeconds,
  breakSeconds,
  now = new Date(),
}) {
  const base = startBase instanceof Date ? startBase : new Date(startBase);
  if (Number.isNaN(base.getTime())) {
    const err = new Error('startBase invalide');
    err.statusCode = 500;
    err.code = 'LIGUE_BAD_CONFIG';
    throw err;
  }

  const slotDurationSeconds =
    Math.max(1, Number(secondsPerQuestion) || 1) * Math.max(1, Number(questionsPerSubject) || 1) +
    Math.max(0, Number(marginSeconds) || 0);

  const totalCompetitionSeconds = computeTotalCompetitionSeconds({
    subjectCount: Array.isArray(subjects) ? subjects.length : 0,
    slotDurationSeconds,
    breakSeconds,
  });

  const effectiveBase = computeRecurringStart({
    startBase: base,
    totalCompetitionSeconds,
    now,
  });

  let cursorMs = effectiveBase.getTime();

  const slots = (Array.isArray(subjects) ? subjects : []).map((subject, index) => {
    const startAt = new Date(cursorMs);
    const endAt = new Date(cursorMs + slotDurationSeconds * 1000);

    cursorMs = endAt.getTime() + Math.max(0, Number(breakSeconds) || 0) * 1000;

    return {
      index,
      ...subject,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      durationSeconds: slotDurationSeconds,
    };
  });

  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const current =
    slots.find((slot) => nowMs >= Date.parse(slot.startAt) && nowMs < Date.parse(slot.endAt)) ?? null;
  const next = slots.find((slot) => nowMs < Date.parse(slot.startAt)) ?? null;

  let status = 'waiting_next_cycle';
  if (current) {
    status = 'subject_live';
  } else if (next) {
    status = next.index > 0 ? 'break' : 'countdown';
  }

  return {
    configuredStartBase: base.toISOString(),
    startBase: effectiveBase.toISOString(),
    slotDurationSeconds,
    breakSeconds: Math.max(0, Number(breakSeconds) || 0),
    totalCompetitionSeconds,
    slots,
    current,
    next,
    status,
  };
}
