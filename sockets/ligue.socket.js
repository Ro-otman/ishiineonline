import {
  getPresenceIndex,
  joinPresence,
  leavePresenceBySocketId,
  listPresence,
} from '../models/liguePresence.model.js';
import {
  getLigueRunById,
  listLigueRunQuestions,
} from '../models/ligueRuns.model.js';
import { getLigueQuizPayloadByIds } from '../models/quiz.model.js';
import { resolveLigueRoomContext } from '../services/ligueRoomContext.service.js';
import { computeQuestionWindow } from '../services/ligueSchedule.service.js';

const runtimeByRoomKey = new Map();
const roomMembershipBySocketId = new Map();
const runMembershipBySocketId = new Map();
const runCacheByRunId = new Map();

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
}

function compositeRoomKey(roomId, classe) {
  return `${asString(classe).trim()}::${asString(roomId).trim()}`;
}

function roomChannel(roomKey) {
  return `ligue:${roomKey}`;
}

function runChannel(runId) {
  return `ligue:run:${runId}`;
}

async function resolveRoomContext({ roomId, classe }) {
  return resolveLigueRoomContext({ roomId, classe });
}

async function emitRoomState(io, key, targetSocketId = null) {
  const runtime = runtimeByRoomKey.get(key);
  if (!runtime) return;

  try {
    const context = await resolveRoomContext({ roomId: runtime.roomId, classe: runtime.classe });
    const payload = {
      roomId: runtime.roomId,
      classe: runtime.classe,
      status: context.schedule.status,
      serverNow: new Date().toISOString(),
      cycleStartAt: context.schedule.startBase,
      breakSeconds: context.breakSeconds,
      currentSubject: context.schedule.current
        ? {
            id_matiere: Number(context.schedule.current.id_matiere),
            nom_matiere: context.schedule.current.nom_matiere,
            startAt: context.schedule.current.startAt,
            endAt: context.schedule.current.endAt,
          }
        : null,
      nextSubject: context.schedule.next
        ? {
            id_matiere: Number(context.schedule.next.id_matiere),
            nom_matiere: context.schedule.next.nom_matiere,
            startAt: context.schedule.next.startAt,
            endAt: context.schedule.next.endAt,
          }
        : null,
      participantsCount: listPresence(runtime.key).length,
    };

    if (targetSocketId) {
      io.to(targetSocketId).emit('ligue:room_state', payload);
      return;
    }

    io.to(roomChannel(key)).emit('ligue:room_state', payload);
  } catch (_) {}
}

async function loadRunCache(runId) {
  const cached = runCacheByRunId.get(runId);
  if (cached) return cached;

  const run = await getLigueRunById(runId);
  if (!run) return null;

  const runQuestions = await listLigueRunQuestions(runId);
  if (runQuestions.length === 0) return null;

  const orderedRunQuestions = [...runQuestions].sort(
    (a, b) => a.question_index - b.question_index,
  );
  const quizIdsOrdered = orderedRunQuestions.map((item) => Number(item.id_quiz));
  const timerByQuizId = new Map(
    orderedRunQuestions.map((item) => [
      Number(item.id_quiz),
      Math.max(1, Number(item.timer_seconds) || 30),
    ]),
  );

  const quizPayload = await getLigueQuizPayloadByIds(quizIdsOrdered);
  const questionById = new Map(
    quizPayload.map((question) => [
      Number(question.id_quiz),
      {
        ...question,
        timer_seconds:
          timerByQuizId.get(Number(question.id_quiz)) ??
          Math.max(1, Number(question.timer_seconds) || 30),
      },
    ]),
  );
  const questions = quizIdsOrdered
    .map((quizId) => questionById.get(quizId))
    .filter(Boolean);

  const payload = {
    run,
    runQuestions: orderedRunQuestions,
    questions,
  };
  runCacheByRunId.set(runId, payload);
  return payload;
}

async function emitRunState(io, key, runId, targetSocketId = null) {
  const runtime = runtimeByRoomKey.get(key);
  if (!runtime) return;

  try {
    const cache = await loadRunCache(runId);
    if (!cache) return;

    const context = await resolveRoomContext({ roomId: runtime.roomId, classe: runtime.classe });
    const totalQuestions = cache.questions.length;
    const slot = context.schedule.slots.find(
      (entry) => Number(entry.id_matiere) === Number(cache.run.id_matiere),
    );

    if (!slot) {
      const payload = {
        runId,
        status: 'finished',
        serverNow: new Date().toISOString(),
        subjectId: Number(cache.run.id_matiere),
        questionIndex: -1,
        totalQuestions,
        remainingSeconds: 0,
        missedQuestions: totalQuestions,
        slotStartAt: null,
        slotEndAt: null,
        question: null,
      };
      if (targetSocketId) {
        io.to(targetSocketId).emit('ligue:run_state', payload);
      } else {
        io.to(runChannel(runId)).emit('ligue:run_state', payload);
      }
      return;
    }

    const questionTimers = cache.runQuestions.map((item) => Math.max(1, Number(item.timer_seconds) || 30));
    const now = new Date();
    const questionWindow = computeQuestionWindow({
      slot,
      questionTimers,
      now,
    });

    let payload;
    if (questionWindow) {
      payload = {
        runId,
        status: 'question_live',
        serverNow: now.toISOString(),
        subjectId: Number(cache.run.id_matiere),
        questionIndex: questionWindow.questionIndex,
        totalQuestions,
        remainingSeconds: questionWindow.remainingSeconds,
        missedQuestions: questionWindow.missedQuestions,
        slotStartAt: slot.startAt,
        slotEndAt: questionWindow.runEndAt,
        question: cache.questions[questionWindow.questionIndex] ?? null,
      };
    } else {
      const slotStartMs = Date.parse(slot.startAt);
      const runEndMs = Date.parse(slot.endAt);
      const beforeStart = Number.isFinite(slotStartMs) && now.getTime() < slotStartMs;
      payload = {
        runId,
        status: beforeStart ? 'waiting' : 'finished',
        serverNow: now.toISOString(),
        subjectId: Number(cache.run.id_matiere),
        questionIndex: beforeStart ? 0 : Math.max(0, totalQuestions - 1),
        totalQuestions,
        remainingSeconds: beforeStart ? Math.max(0, Math.ceil((slotStartMs - now.getTime()) / 1000)) : 0,
        missedQuestions: beforeStart ? 0 : totalQuestions,
        slotStartAt: slot.startAt,
        slotEndAt: Number.isFinite(runEndMs) ? new Date(runEndMs).toISOString() : slot.endAt,
        question: beforeStart ? cache.questions[0] ?? null : null,
      };
    }

    if (targetSocketId) {
      io.to(targetSocketId).emit('ligue:run_state', payload);
    } else {
      io.to(runChannel(runId)).emit('ligue:run_state', payload);
    }
  } catch (_) {}
}

async function tickRuntime(io, key) {
  const runtime = runtimeByRoomKey.get(key);
  if (!runtime || runtime.ticking) return;
  runtime.ticking = true;

  try {
    await emitRoomState(io, key);

    const runIds = new Set(runtime.runSubscribers.values());
    for (const runId of runIds) {
      await emitRunState(io, key, runId);
    }
  } finally {
    runtime.ticking = false;
    maybeDisposeRuntime(key);
  }
}

function leaveRunSubscription(socket) {
  const current = runMembershipBySocketId.get(socket.id);
  if (!current) return;

  const runtime = runtimeByRoomKey.get(current.roomKey);
  if (runtime) {
    runtime.runSubscribers.delete(socket.id);
  }

  socket.leave(runChannel(current.runId));
  runMembershipBySocketId.delete(socket.id);
  maybeDisposeRuntime(current.roomKey);
}

function leaveRoomMembership(io, socket) {
  const roomKey = roomMembershipBySocketId.get(socket.id);
  if (!roomKey) return;

  const runtime = runtimeByRoomKey.get(roomKey);
  if (runtime) {
    runtime.sockets.delete(socket.id);
  }

  roomMembershipBySocketId.delete(socket.id);
  socket.leave(roomChannel(roomKey));
  leavePresenceBySocketId(socket.id);
  broadcastParticipants(io, roomKey);
  maybeDisposeRuntime(roomKey);
}

function ensureRuntime(io, roomId, classe) {
  const key = compositeRoomKey(roomId, classe);
  let runtime = runtimeByRoomKey.get(key);
  if (runtime) return runtime;

  runtime = {
    key,
    roomId: asString(roomId).trim(),
    classe: asString(classe).trim(),
    sockets: new Set(),
    runSubscribers: new Map(),
    ticking: false,
    timer: null,
  };

  runtime.timer = setInterval(() => {
    void tickRuntime(io, key);
  }, 1000);

  runtimeByRoomKey.set(key, runtime);
  return runtime;
}

function maybeDisposeRuntime(key) {
  const runtime = runtimeByRoomKey.get(key);
  if (!runtime) return;
  if (runtime.sockets.size > 0 || runtime.runSubscribers.size > 0) return;
  if (runtime.timer) clearInterval(runtime.timer);
  runtimeByRoomKey.delete(key);
}

function serializeParticipantsPayload(runtime) {
  const participants = listPresence(runtime.key);
  return {
    roomId: runtime.roomId,
    classe: runtime.classe,
    count: participants.length,
    participants,
  };
}

function broadcastParticipants(io, key) {
  const runtime = runtimeByRoomKey.get(key);
  if (!runtime) return;
  io.to(roomChannel(key)).emit('ligue:participants', serializeParticipantsPayload(runtime));
}

export function registerLigueSockets(io) {
  io.on('connection', (socket) => {
    socket.on('ligue:join', async (payload, ack) => {
      try {
        const roomId = asString(payload?.roomId).trim();
        const classe = asString(payload?.classe).trim();
        const userId = asString(payload?.userId).trim();
        const fullName = asString(payload?.fullName).trim();
        const photoUrl = payload?.photoUrl ? asString(payload.photoUrl).trim() : null;

        if (!roomId || !classe || !userId || !fullName) {
          return ack?.({
            ok: false,
            error: {
              code: 'BAD_REQUEST',
              message: 'roomId, classe, userId et fullName requis',
            },
          });
        }

        const prev = roomMembershipBySocketId.get(socket.id) ?? getPresenceIndex(socket.id)?.roomId;
        const nextKey = compositeRoomKey(roomId, classe);
        if (prev && prev !== nextKey) {
          leaveRunSubscription(socket);
          leaveRoomMembership(io, socket);
        }

        const runtime = ensureRuntime(io, roomId, classe);
        runtime.sockets.add(socket.id);
        roomMembershipBySocketId.set(socket.id, runtime.key);
        socket.join(roomChannel(runtime.key));

        joinPresence({
          roomId: runtime.key,
          userId,
          fullName,
          photoUrl,
          socketId: socket.id,
        });

        broadcastParticipants(io, runtime.key);
        await emitRoomState(io, runtime.key, socket.id);

        return ack?.({ ok: true, roomId, classe });
      } catch (err) {
        return ack?.({
          ok: false,
          error: {
            code: err?.code || 'INTERNAL_ERROR',
            message: err?.message || 'Erreur interne',
          },
        });
      }
    });

    socket.on('ligue:run_join', async (payload, ack) => {
      try {
        const runId = asString(payload?.runId).trim();
        const roomId = asString(payload?.roomId).trim();
        const classe = asString(payload?.classe).trim();
        const userId = asString(payload?.userId).trim();

        if (!runId || !roomId || !classe || !userId) {
          return ack?.({
            ok: false,
            error: {
              code: 'BAD_REQUEST',
              message: 'runId, roomId, classe et userId requis',
            },
          });
        }

        const runtime = ensureRuntime(io, roomId, classe);
        runtime.sockets.add(socket.id);
        roomMembershipBySocketId.set(socket.id, runtime.key);
        socket.join(roomChannel(runtime.key));

        const cache = await loadRunCache(runId);
        if (!cache) {
          return ack?.({
            ok: false,
            error: { code: 'RUN_NOT_READY', message: 'Run live introuvable ou incomplet' },
          });
        }

        if (String(cache.run.id_user) !== userId) {
          return ack?.({
            ok: false,
            error: { code: 'FORBIDDEN', message: 'Run live non autorise' },
          });
        }

        leaveRunSubscription(socket);
        runtime.runSubscribers.set(socket.id, runId);
        runMembershipBySocketId.set(socket.id, { roomKey: runtime.key, runId });
        socket.join(runChannel(runId));

        await emitRunState(io, runtime.key, runId, socket.id);

        return ack?.({ ok: true, runId });
      } catch (err) {
        return ack?.({
          ok: false,
          error: {
            code: err?.code || 'INTERNAL_ERROR',
            message: err?.message || 'Erreur interne',
          },
        });
      }
    });

    socket.on('ligue:run_leave', (payload, ack) => {
      const requestedRunId = asString(payload?.runId).trim();
      const active = runMembershipBySocketId.get(socket.id);
      if (!active) {
        return ack?.({ ok: true });
      }
      if (requestedRunId && requestedRunId !== active.runId) {
        return ack?.({ ok: true });
      }
      leaveRunSubscription(socket);
      return ack?.({ ok: true });
    });

    socket.on('ligue:leave', (_payload, ack) => {
      leaveRunSubscription(socket);
      leaveRoomMembership(io, socket);
      return ack?.({ ok: true });
    });

    socket.on('disconnect', () => {
      leaveRunSubscription(socket);
      leaveRoomMembership(io, socket);
    });
  });
}
