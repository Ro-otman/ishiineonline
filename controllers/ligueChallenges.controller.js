import {
  createChallengeComment,
  getChallengeById,
  listWeeklyChallenges,
  toggleChallengeLike,
  upsertChallengeSubmission,
} from '../models/ligueChallenges.model.js';
import { getUserById } from '../models/users.model.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asBool(value) {
  if (value === true || value === false) return value;
  const normalized = asString(value).toLowerCase();
  return normalized === '1' || normalized === 'true';
}

function currentWeekKey() {
  const now = new Date();
  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const mondayOffset = (utcMidnight.getUTCDay() + 6) % 7;
  utcMidnight.setUTCDate(utcMidnight.getUTCDate() - mondayOffset);
  return utcMidnight.toISOString().slice(0, 10);
}

function sanitizeWeekKey(raw) {
  const weekKey = asString(raw);
  return /^\d{4}-\d{2}-\d{2}$/.test(weekKey) ? weekKey : currentWeekKey();
}

function buildAuthorName(user) {
  const firstName = asString(user?.prenoms);
  const lastName = asString(user?.nom);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (fullName) return fullName;

  const email = asString(user?.email);
  if (email) return email;

  const phone = asString(user?.phone);
  if (phone) return phone;

  return 'Utilisateur';
}

function serializeComment(comment) {
  return {
    id_comment: Number(comment.id_comment),
    id_challenge: Number(comment.id_challenge),
    author_name: asString(comment.author_name),
    verified_blue: Number(comment.verified_blue) === 1,
    text: asString(comment.text),
    created_at: comment.created_at instanceof Date
      ? comment.created_at.toISOString()
      : new Date(comment.created_at).toISOString(),
  };
}

function serializeSubmission(submission) {
  if (!submission) return null;
  return {
    id_submission: Number(submission.id_submission),
    id_challenge: Number(submission.id_challenge),
    id_user: asString(submission.id_user),
    week_key: asString(submission.week_key),
    answer_text: asString(submission.answer_text),
    status: asString(submission.status),
    completed_at: submission.completed_at ? new Date(submission.completed_at).toISOString() : null,
    created_at: submission.created_at ? new Date(submission.created_at).toISOString() : null,
    updated_at: submission.updated_at ? new Date(submission.updated_at).toISOString() : null,
  };
}

function serializeChallenge(challenge) {
  return {
    id_challenge: Number(challenge.id_challenge),
    week_key: asString(challenge.week_key),
    title: asString(challenge.title),
    prompt: asString(challenge.prompt),
    subject: asString(challenge.subject),
    difficulty: asString(challenge.difficulty),
    author_name: asString(challenge.author_name),
    author_verified_blue: Number(challenge.author_verified_blue) === 1,
    likes: Number(challenge.likes ?? 0),
    liked_by_me: Number(challenge.liked_by_me ?? 0) === 1,
    reward_points: Number(challenge.reward_points ?? 0),
    participants: Number(challenge.participants ?? 0),
    estimated_minutes: Number(challenge.estimated_minutes ?? 0),
    deadline_at: new Date(challenge.deadline_at).toISOString(),
    featured: Number(challenge.featured ?? 0) === 1,
    comments: Array.isArray(challenge.comments)
      ? challenge.comments.map(serializeComment)
      : [],
    submission: serializeSubmission(challenge.submission),
  };
}

export async function listChallenges(req, res, next) {
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

    const weekKey = sanitizeWeekKey(req.query?.weekKey);
    const challenges = await listWeeklyChallenges({ weekKey, userId });

    return res.json({
      ok: true,
      weekKey,
      challenges: challenges.map(serializeChallenge),
    });
  } catch (err) {
    return next(err);
  }
}

export async function postChallengeComment(req, res, next) {
  try {
    const idChallenge = Number(req.params?.challengeId);
    const userId = asString(req.user?.idUser);
    const text = asString(req.body?.text);
    const verifiedBlue = asBool(req.body?.verifiedBlue);

    if (!Number.isFinite(idChallenge) || idChallenge <= 0) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'challengeId invalide.' },
      });
    }

    if (!userId || !text) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Champs requis: text.',
        },
      });
    }

    const user = await getUserById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: { code: 'USER_NOT_FOUND', message: 'Utilisateur introuvable.' },
      });
    }

    const challenge = await getChallengeById(idChallenge);
    if (!challenge) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Défi introuvable.' },
      });
    }

    const comment = await createChallengeComment({
      idChallenge,
      userId,
      authorName: buildAuthorName(user),
      verifiedBlue,
      text,
    });

    return res.status(201).json({
      ok: true,
      comment: comment ? serializeComment(comment) : null,
    });
  } catch (err) {
    return next(err);
  }
}

export async function toggleLikeOnChallenge(req, res, next) {
  try {
    const idChallenge = Number(req.params?.challengeId);
    const userId = asString(req.user?.idUser);

    if (!Number.isFinite(idChallenge) || idChallenge <= 0) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'challengeId invalide.' },
      });
    }

    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'USER_AUTH_REQUIRED',
          message: 'Connexion utilisateur requise.',
        },
      });
    }

    const challenge = await getChallengeById(idChallenge);
    if (!challenge) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Défi introuvable.' },
      });
    }

    const likeState = await toggleChallengeLike({ idChallenge, userId });
    return res.json({
      ok: true,
      likes: Number(likeState.likes ?? 0),
      likedByMe: Number(likeState.liked_by_me ?? 0) === 1,
    });
  } catch (err) {
    return next(err);
  }
}

export async function saveChallengeSubmission(req, res, next) {
  try {
    const idChallenge = Number(req.params?.challengeId);
    const userId = asString(req.user?.idUser);
    const weekKey = sanitizeWeekKey(req.body?.weekKey);
    const answerText = asString(req.body?.answer);
    const status = asString(req.body?.status).toLowerCase() === 'completed'
      ? 'completed'
      : 'draft';

    if (!Number.isFinite(idChallenge) || idChallenge <= 0) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'challengeId invalide.' },
      });
    }

    if (!userId || !answerText) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Champs requis: answer.',
        },
      });
    }

    const challenge = await getChallengeById(idChallenge);
    if (!challenge) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Défi introuvable.' },
      });
    }

    const submission = await upsertChallengeSubmission({
      idChallenge,
      userId,
      weekKey,
      answerText,
      status,
    });

    return res.json({
      ok: true,
      submission: serializeSubmission(submission),
    });
  } catch (err) {
    return next(err);
  }
}
