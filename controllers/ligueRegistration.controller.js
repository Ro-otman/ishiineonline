import crypto from 'node:crypto';

import {
  getLigueProfileByUserId,
  upsertLigueProfile,
} from '../models/ligueProfiles.model.js';
import {
  getUserById,
  getUserByIdentity,
  rekeyUserId,
  upsertUser,
} from '../models/users.model.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value);
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

function splitClasseLigue(rawClasse) {
  const clean = asString(rawClasse).trim();
  if (!clean) {
    return { salleKey: '', serieKey: '' };
  }

  const parts = clean
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    salleKey: normalizeSalleKey(parts[0] ?? ''),
    serieKey: parts.length > 1 ? parts[1] : '',
  };
}

function sanitizeHandle(raw) {
  return asString(raw)
    .trim()
    .replace(/^@+/, '')
    .replace(/[^a-zA-Z0-9_.-]/g, '')
    .slice(0, 64);
}

export async function registerToLigue(req, res, next) {
  try {
    const body = req.body || {};

    const requestedUserId =
      asString(body.id_users || body.id_user).trim() || crypto.randomUUID();
    const nom = asString(body.nom).trim();
    const prenoms = asString(body.prenoms).trim();
    const email = asString(body.email).trim();
    const classe = asString(body.classe).trim();
    const phone = asString(body.phone).trim();
    const handle = sanitizeHandle(body.handle || body.pseudo || body.username);
    const requestedSalle = asString(body.salle).trim();

    const classeParts = splitClasseLigue(classe);
    const salle_key = normalizeSalleKey(requestedSalle || classeParts.salleKey);
    const serie_key = asString(body.serie).trim() || classeParts.serieKey;

    if (!nom || !prenoms || !classe || !phone || !handle || !salle_key) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message:
            'Champs requis: nom, prenoms, classe, phone, handle, salle',
        },
      });
    }

    const img_path = req.file ? `/uploads/users/${req.file.filename}` : null;

    let id_users = requestedUserId;
    const existingUserById = await getUserById(id_users);
    if (!existingUserById) {
      const matchedUser = await getUserByIdentity({ email, phone });
      if (matchedUser?.id_users && matchedUser.id_users !== id_users) {
        await rekeyUserId({
          fromUserId: matchedUser.id_users,
          toUserId: id_users,
        });
      }
    }

    const user = await upsertUser({
      id_users,
      nom,
      prenoms,
      email,
      classe,
      phone,
      img_path,
      is_subscribed: Number(body.is_subscribed ?? 0) ? 1 : 0,
      subscription_date: body.subscription_date
        ? asString(body.subscription_date)
        : null,
      subscription_expiry: body.subscription_expiry
        ? asString(body.subscription_expiry)
        : null,
      first_use_time: body.first_use_time
        ? asString(body.first_use_time)
        : null,
    });

    const existingProfile = await getLigueProfileByUserId(id_users);
    if (
      existingProfile &&
      normalizeSalleKey(existingProfile.salle_key) !== salle_key
    ) {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'SALLE_LOCKED',
          message:
            'La salle ligue est deja definie pour cet utilisateur et ne peut pas etre changee.',
        },
        ligueProfile: existingProfile,
      });
    }

    const ligueProfile = await upsertLigueProfile({
      id_user: id_users,
      handle,
      salle_key,
      serie_key,
    });

    return res.status(existingProfile ? 200 : 201).json({
      ok: true,
      user,
      ligueProfile,
      restored: true,
    });
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        ok: false,
        error: {
          code: 'HANDLE_TAKEN',
          message: 'Ce pseudo ligue est deja utilise.',
        },
      });
    }

    return next(err);
  }
}

export async function getLigueProfile(req, res, next) {
  try {
    const userId = asString(req.params?.userId).trim();
    if (!userId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'BAD_REQUEST', message: 'userId requis' },
      });
    }

    const ligueProfile = await getLigueProfileByUserId(userId);
    return res.json({
      ok: true,
      registered: Boolean(ligueProfile),
      ligueProfile,
    });
  } catch (err) {
    return next(err);
  }
}
