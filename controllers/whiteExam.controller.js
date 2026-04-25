import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { getUserById } from '../models/users.model.js';
import { pickBalancedCandidates } from '../models/ligueWeeklyQuizBank.model.js';
import { listMatieresForClasseAndType } from '../models/matieres.model.js';
import {
  getLigueQuizPayloadByIds,
  listCorrectOptionIdsByQuizIds,
  listLigueQuizCandidatesForMatiere,
} from '../models/quiz.model.js';
import {
  createWhiteExamRun,
  finalizeWhiteExamRun,
  getWhiteExamRunById,
  insertWhiteExamRunAnswers,
  insertWhiteExamRunQuestions,
  listWhiteExamRunQuestions,
} from '../models/whiteExamRuns.model.js';
import { getWhiteExamAccessStatus } from '../models/whiteExamAccess.model.js';
import {
  resolveWhiteExamContext,
  WHITE_EXAM_QUESTIONS_PER_SUBJECT,
} from '../services/whiteExamContext.service.js';
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
  const parsed = Number.parseInt(asString(value), 10);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min) return min;
  if (parsed > max) return max;
  return parsed;
}

function averageSecondsPerQuestion(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return 30;
  const totalSeconds = list.reduce(
    (sum, item) => sum + Math.max(1, Number(item?.timer_seconds) || 0),
    0,
  );
  return Math.max(1, Math.round(totalSeconds / list.length));
}

function buildQuestionPayload(questions, timersByQuizId) {
  return questions.map((question) => ({
    ...question,
    timer_seconds:
      timersByQuizId.get(Number(question.id_quiz)) ??
      Math.max(1, Number(question.timer_seconds) || 30),
  }));
}

function whiteExamPaymentConfig() {
  const parsedAmount = Number.parseInt(asString(env.PAYMENT_WHITE_EXAM_AMOUNT), 10);
  return {
    planKey: 'white_exam_access',
    amount: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : 250,
    currencyIso: asString(env.PAYMENT_CURRENCY_ISO || 'XOF') || 'XOF',
  };
}

function isWhiteExamPaymentDisabled() {
  return Boolean(env.WHITE_EXAM_PAYMENT_DISABLED);
}

function serializeWhiteExamPayment(access) {
  const config = whiteExamPaymentConfig();
  if (isWhiteExamPaymentDisabled()) {
    return {
      required: false,
      plan_key: config.planKey,
      amount: config.amount,
      currency_iso: config.currencyIso,
      approved: true,
      transaction_id: access?.transaction_id || null,
      approved_at: access?.approved_at
        ? new Date(access.approved_at).toISOString()
        : null,
      status: access?.status || 'bypass_disabled',
    };
  }
  return {
    required: true,
    plan_key: config.planKey,
    amount: config.amount,
    currency_iso: config.currencyIso,
    approved: Boolean(access),
    transaction_id: access?.transaction_id || null,
    approved_at: access?.approved_at
      ? new Date(access.approved_at).toISOString()
      : null,
    status: access?.status || (access ? 'approved' : 'pending'),
  };
}

async function resolveSubject({ id_classe, id_type, subjectId }) {
  const subjects = await listMatieresForClasseAndType({
    id_classe,
    id_type: id_type ?? null,
  });
  const subject = subjects.find(
    (item) => Number(item.id_matiere) === Number(subjectId),
  );
  return { subject, subjects };
}

export async function listWhiteExamSubjects(req, res, next) {
  try {
    const userId = asString(req.user?.idUser).trim();
    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: {
          code: 'USER_AUTH_REQUIRED',
          message: 'Connexion utilisateur requise.',
        },
      });
    }

    const classe = asString(req.query?.classe).trim();
    if (!classe) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Parametre requis: ?classe=',
        },
      });
    }

    const now = new Date();
    const requestedWeekKey = asString(req.query?.weekKey).trim();
    const weekKey = requestedWeekKey || weekKeyFromDateUtc(now) || '';
    const { classRow, serieKey, typeRow } = await resolveWhiteExamContext({
      classe,
    });
    const access = await getWhiteExamAccessStatus({
      userId,
      weekKey,
      classe: classRow.nom_classe,
    });

    const subjects = await listMatieresForClasseAndType({
      id_classe: classRow.id_classe,
      id_type: typeRow?.id_type ?? null,
    });

    const subjectPlans = [];
    for (const subject of subjects) {
      const subjectId = Number(subject.id_matiere);
      if (!subjectId) continue;

      const candidates = await listLigueQuizCandidatesForMatiere({
        id_classe: classRow.id_classe,
        id_type: typeRow?.id_type ?? null,
        id_matiere: subjectId,
        eligible_at: now,
        limit: WHITE_EXAM_QUESTIONS_PER_SUBJECT,
        seed: `white-exam-plan:${weekKey}:${classRow.id_classe}:${typeRow?.id_type ?? 0}:${subjectId}`,
      });

      const questionCount = Math.min(
        WHITE_EXAM_QUESTIONS_PER_SUBJECT,
        candidates.length,
      );
      const durationSeconds = candidates
        .slice(0, questionCount)
        .reduce(
          (sum, candidate) =>
            sum + Math.max(1, Number(candidate.timer_seconds) || 30),
          0,
        );

      subjectPlans.push({
        id_matiere: subjectId,
        nom_matiere: subject.nom_matiere,
        question_count: questionCount,
        target_question_count: WHITE_EXAM_QUESTIONS_PER_SUBJECT,
        ready: questionCount >= WHITE_EXAM_QUESTIONS_PER_SUBJECT,
        average_seconds_per_question:
          questionCount > 0
            ? Math.max(1, Math.round(durationSeconds / questionCount))
            : 30,
        duration_seconds: durationSeconds,
      });
    }

    return res.json({
      ok: true,
      weekKey,
      classe: classRow.nom_classe,
      serieKey,
      questionTarget: WHITE_EXAM_QUESTIONS_PER_SUBJECT,
      payment: serializeWhiteExamPayment(access),
      subjects: subjectPlans,
    });
  } catch (err) {
    return next(err);
  }
}

export async function startWhiteExamRun(req, res, next) {
  try {
    const subjectId = asInt(req.params?.subjectId);
    const classe = asString(req.query?.classe).trim();
    const requestedWeekKey = asString(req.query?.weekKey).trim();
    const userId = asString(req.user?.idUser).trim();

    if (!subjectId || !classe || !userId) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Champs requis: subjectId + query ?classe=',
        },
      });
    }

    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: { code: 'USER_NOT_FOUND', message: 'Utilisateur introuvable' },
      });
    }

    const now = new Date();
    const weekKey = requestedWeekKey || weekKeyFromDateUtc(now) || '';
    const { classRow, serieKey, typeRow } = await resolveWhiteExamContext({
      classe,
    });
    const access = await getWhiteExamAccessStatus({
      userId,
      weekKey,
      classe: classRow.nom_classe,
    });
    if (!access && !isWhiteExamPaymentDisabled()) {
      return res.status(402).json({
        ok: false,
        error: {
          code: 'WHITE_EXAM_PAYMENT_REQUIRED',
          message:
            "Paiement requis: règle 250 F pour débloquer l'examen blanc de cette semaine.",
        },
      });
    }
    const { subject } = await resolveSubject({
      id_classe: classRow.id_classe,
      id_type: typeRow?.id_type ?? null,
      subjectId,
    });

    if (!subject) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Matiere introuvable pour cette classe/serie',
        },
      });
    }

    const runId = crypto.randomUUID();
    const seed = `white-exam-run:${weekKey}:${classRow.id_classe}:${typeRow?.id_type ?? 0}:${subjectId}:${userId}:${runId}`;
    const candidates = await listLigueQuizCandidatesForMatiere({
      id_classe: classRow.id_classe,
      id_type: typeRow?.id_type ?? null,
      id_matiere: subjectId,
      eligible_at: now,
      seed,
    });
    const selected = pickBalancedCandidates({
      candidates,
      limit: WHITE_EXAM_QUESTIONS_PER_SUBJECT,
      seed,
    });

    if (selected.length < WHITE_EXAM_QUESTIONS_PER_SUBJECT) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'NOT_ENOUGH_QUIZ',
          message: `Pas assez de quiz pour cette matiere (${selected.length}/${WHITE_EXAM_QUESTIONS_PER_SUBJECT}).`,
        },
      });
    }

    const run = await createWhiteExamRun({
      id_run: runId,
      week_key: weekKey,
      id_user: userId,
      id_classe: classRow.id_classe,
      id_type: typeRow?.id_type ?? null,
      id_matiere: subjectId,
      total_questions: selected.length,
    });

    await insertWhiteExamRunQuestions(
      runId,
      selected.map((candidate, index) => ({
        question_index: index,
        id_quiz: candidate.id_quiz,
        timer_seconds: candidate.timer_seconds,
      })),
    );

    const runQuestions = await listWhiteExamRunQuestions(runId);
    const quizIdsOrdered = runQuestions.map((item) => Number(item.id_quiz));
    const timersByQuizId = new Map(
      runQuestions.map((item) => [
        Number(item.id_quiz),
        Math.max(1, Number(item.timer_seconds) || 30),
      ]),
    );
    const questions = buildQuestionPayload(
      await getLigueQuizPayloadByIds(quizIdsOrdered),
      timersByQuizId,
    );
    const durationSeconds = runQuestions.reduce(
      (sum, item) => sum + Math.max(1, Number(item.timer_seconds) || 30),
      0,
    );

    return res.json({
      ok: true,
      weekKey,
      classe: classRow.nom_classe,
      room: {
        id: `white-exam:${classRow.id_classe}:${typeRow?.id_type ?? 0}`,
        nom_serie: serieKey || 'commun',
        id_type: typeRow?.id_type ?? null,
      },
      subject: {
        id_matiere: Number(subject.id_matiere),
        nom_matiere: subject.nom_matiere,
      },
      serverNow: now.toISOString(),
      quiz: {
        timerSource: 'per_quiz',
        secondsPerQuestion: averageSecondsPerQuestion(runQuestions),
        questionsPerSubject: runQuestions.length,
        durationSeconds,
        questionTimers: runQuestions.map((item) =>
          Math.max(1, Number(item.timer_seconds) || 30),
        ),
        useSocket: false,
        submitMode: 'white_exam',
      },
      run: {
        id_run: run.id_run,
        started_at: run.started_at,
        submitted_at: run.submitted_at,
        use_socket: false,
        submit_mode: 'white_exam',
      },
      questions,
    });
  } catch (err) {
    return next(err);
  }
}

export async function submitWhiteExamRun(req, res, next) {
  try {
    const runId = asString(req.params?.runId).trim();
    const userId = asString(req.user?.idUser).trim();
    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];

    if (!runId || !userId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'Champs requis: runId' },
      });
    }

    const run = await getWhiteExamRunById(runId);
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
        error: {
          code: 'ALREADY_SUBMITTED',
          message: 'Ce run est deja soumis.',
        },
        run,
      });
    }

    const runQuestions = await listWhiteExamRunQuestions(runId);
    if (runQuestions.length === 0) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'RUN_NOT_READY',
          message: 'Aucune question associee a ce run',
        },
      });
    }

    const questionQuizIds = runQuestions
      .sort((a, b) => a.question_index - b.question_index)
      .map((item) => Number(item.id_quiz));
    const quizIdSet = new Set(questionQuizIds);
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

    const correctOptionByQuizId = await listCorrectOptionIdsByQuizIds(
      questionQuizIds,
    );

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

    await insertWhiteExamRunAnswers(runId, rowsToInsert);

    const totalQuestions =
      Number(run.total_questions ?? questionQuizIds.length) ||
      questionQuizIds.length;
    const scorePercent =
      totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
    const updated = await finalizeWhiteExamRun({
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
