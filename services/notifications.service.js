import {
  createNotification,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
} from '../models/notifications.model.js';
import { emitToUser } from './realtimeGateway.service.js';
import { sendPushNotificationToUser } from './pushNotifications.service.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function normalizeCategory(value) {
  const normalized = asString(value).toLowerCase();
  if (['success', 'warning', 'error'].includes(normalized)) {
    return normalized;
  }
  return 'info';
}

function parsePayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toIsoDateTime(value) {
  const text = asString(value);
  if (!text) return null;
  const normalized = text.includes('T') ? text : text.replace(' ', 'T');
  const date = new Date(normalized.endsWith('Z') ? normalized : `${normalized}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function toNotificationDto(row = {}) {
  return {
    id: asString(row.id_notification),
    userId: asString(row.id_user),
    category: normalizeCategory(row.category),
    title: asString(row.title),
    message: asString(row.message),
    isRead: Number(row.is_read || 0) === 1,
    readAt: toIsoDateTime(row.read_at),
    createdAt: toIsoDateTime(row.created_at),
    payload: parsePayload(row.payload_json),
  };
}

function formatDateFr(value) {
  const iso = toIsoDateTime(value);
  if (!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatNumberFr(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '0';
  return number.toLocaleString('fr-FR');
}

function composeTypeLabel(typeName) {
  const safeType = asString(typeName);
  if (!safeType || safeType.toLowerCase() === 'commun') return '';
  return ` / ${safeType}`;
}

export async function pushNotification(input = {}) {
  const row = await createNotification(input);
  if (!row) return null;

  const notification = toNotificationDto(row);
  emitToUser(notification.userId, 'notifications:new', { notification });

  try {
    await sendPushNotificationToUser({ userId: notification.userId, notification });
  } catch (error) {
    console.error('[notifications] push delivery failed', {
      userId: notification.userId,
      notificationId: notification.id,
      code: error?.code,
      message: error?.message,
    });
  }

  return notification;
}

export async function listUserNotifications({
  userId,
  unreadOnly = false,
  limit = 20,
} = {}) {
  const rows = await listNotificationsForUser({ userId, unreadOnly, limit });
  return rows.map((row) => toNotificationDto(row));
}

export async function acknowledgeNotification({ notificationId, userId } = {}) {
  const row = await markNotificationRead({ notificationId, userId });
  return row ? toNotificationDto(row) : null;
}

export async function acknowledgeAllNotifications({ userId } = {}) {
  const updatedCount = await markAllNotificationsRead({ userId });
  return { updatedCount };
}

export async function notifyPaymentSuccess({
  userId,
  transactionId,
  amount,
  currencyIso = 'XOF',
  planKey = 'premium_monthly',
  subscriptionExpiry,
} = {}) {
  const safeUserId = asString(userId);
  const safeTransactionId = asString(transactionId);
  if (!safeUserId || !safeTransactionId) return null;

  const expiryLabel = formatDateFr(subscriptionExpiry);
  const amountLabel = Number.isFinite(Number(amount)) ? formatNumberFr(amount) : null;
  const messageParts = [];
  if (amountLabel) {
    messageParts.push(`Paiement confirmé : ${amountLabel} ${asString(currencyIso) || 'F CFA'}.`);
  }
  messageParts.push(
    expiryLabel
      ? `Ton abonnement premium est actif jusqu'au ${expiryLabel}.`
      : 'Ton abonnement premium est maintenant actif.',
  );

  return pushNotification({
    userId: safeUserId,
    category: 'success',
    title: 'Abonnement activé',
    message: messageParts.join(' '),
    dedupeKey: `payment-success:${safeTransactionId}`,
    payload: {
      kind: 'payment_success',
      transactionId: safeTransactionId,
      amount,
      currencyIso,
      planKey,
      subscriptionExpiry: subscriptionExpiry || null,
    },
  });
}

export async function notifyLigueStart({
  userId,
  weekKey,
  className,
  typeName,
  startsAt,
} = {}) {
  const safeUserId = asString(userId);
  const safeWeekKey = asString(weekKey);
  if (!safeUserId || !safeWeekKey) return null;

  const classLabel = `${asString(className)}${composeTypeLabel(typeName)}`.trim();
  const startLabel = formatDateFr(startsAt);

  return pushNotification({
    userId: safeUserId,
    category: 'info',
    title: 'Début de ligue',
    message: startLabel
      ? `La ligue ${classLabel} commence maintenant. Bonne chance pour cette session du ${startLabel}.`
      : `La ligue ${classLabel} commence maintenant. Bonne chance.`,
    dedupeKey: `league-start:${safeWeekKey}:${classLabel}`,
    payload: {
      kind: 'league_start',
      weekKey: safeWeekKey,
      className: asString(className),
      typeName: asString(typeName) || 'Commun',
      startsAt: startsAt || null,
    },
  });
}

export async function notifyLigueResult({
  userId,
  runId,
  weekKey,
  subjectName,
  scorePercent,
  correctCount,
  totalQuestions,
} = {}) {
  const safeUserId = asString(userId);
  const safeRunId = asString(runId);
  if (!safeUserId || !safeRunId) return null;

  const safeTotalQuestions = Math.max(0, Number(totalQuestions) || 0);
  const safeCorrectCount = Math.max(0, Number(correctCount) || 0);
  const roundedScore = Math.max(0, Math.round(Number(scorePercent) || 0));

  return pushNotification({
    userId: safeUserId,
    category: roundedScore >= 50 ? 'success' : 'warning',
    title: `iShiine \u2713 R\u00e9sultats ${asString(subjectName) || 'ligue'}`,
    message: asString(subjectName)
      ? `R\u00e9sultats disponibles en ${asString(subjectName)} : ${roundedScore}% (${safeCorrectCount}/${safeTotalQuestions}).`
      : `Tes r\u00e9sultats sont disponibles : ${roundedScore}% (${safeCorrectCount}/${safeTotalQuestions}).`,
    dedupeKey: `league-result:${safeRunId}`,
    payload: {
      kind: 'league_result',
      runId: safeRunId,
      weekKey: asString(weekKey),
      subjectName: asString(subjectName),
      scorePercent: roundedScore,
      correctCount: safeCorrectCount,
      totalQuestions: safeTotalQuestions,
    },
  });
}

export async function notifySubscriptionExpiring({
  userId,
  expiryAt,
  hoursRemaining,
} = {}) {
  const safeUserId = asString(userId);
  const expiryIso = toIsoDateTime(expiryAt);
  if (!safeUserId || !expiryIso) return null;

  const expiryLabel = formatDateFr(expiryIso);
  const roundedHours = Math.max(1, Math.round(Number(hoursRemaining) || 24));

  return pushNotification({
    userId: safeUserId,
    category: 'warning',
    title: 'Abonnement bient\u00f4t expir\u00e9',
    message: `Ton abonnement premium expire bient\u00f4t${expiryLabel ? `, le ${expiryLabel}` : ''}. Pense \u00e0 le renouveler dans les ${roundedHours} prochaines heures.`,
    dedupeKey: `subscription-expiring:${expiryIso.slice(0, 10)}`,
    payload: {
      kind: 'subscription_expiring',
      expiryAt: expiryIso,
      hoursRemaining: roundedHours,
    },
  });
}

export async function notifySubscriptionExpired({
  userId,
  expiryAt,
} = {}) {
  const safeUserId = asString(userId);
  const expiryIso = toIsoDateTime(expiryAt);
  if (!safeUserId || !expiryIso) return null;

  const expiryLabel = formatDateFr(expiryIso);

  return pushNotification({
    userId: safeUserId,
    category: 'error',
    title: 'Abonnement expir\u00e9',
    message: expiryLabel
      ? `Ton abonnement premium a expir\u00e9 le ${expiryLabel}. Reviens vite pour continuer sans interruption.`
      : "Ton abonnement premium a expir\u00e9. Reviens vite pour continuer sans interruption.",
    dedupeKey: `subscription-expired:${expiryIso.slice(0, 10)}`,
    payload: {
      kind: 'subscription_expired',
      expiryAt: expiryIso,
    },
  });
}

export async function notifyAnnouncement({
  userId,
  title,
  message,
  category = 'info',
  campaignKey,
  payload = {},
} = {}) {
  const safeUserId = asString(userId);
  const safeMessage = asString(message);
  if (!safeUserId || !safeMessage) return null;

  return pushNotification({
    userId: safeUserId,
    category,
    title: asString(title) || 'Annonce iShiine',
    message: safeMessage,
    dedupeKey: asString(campaignKey) ? `announcement:${asString(campaignKey)}` : null,
    payload: {
      kind: 'announcement',
      ...payload,
    },
  });
}

export async function notifyReviewCampaign({
  userId,
  title = 'Viens r\u00e9viser',
  message = "C'est un bon moment pour reprendre tes r\u00e9visions et garder le rythme.",
  campaignKey,
  payload = {},
} = {}) {
  const safeUserId = asString(userId);
  if (!safeUserId) return null;

  return pushNotification({
    userId: safeUserId,
    category: 'info',
    title: asString(title) || 'Viens r\u00e9viser',
    message: asString(message) || "C'est un bon moment pour reprendre tes r\u00e9visions et garder le rythme.",
    dedupeKey: asString(campaignKey) ? `review-campaign:${asString(campaignKey)}` : null,
    payload: {
      kind: 'review_campaign',
      ...payload,
    },
  });
}
