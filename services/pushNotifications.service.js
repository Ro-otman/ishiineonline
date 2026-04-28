import {
  deactivateDevicePushToken,
  ensurePushTokensTable,
  listActiveDevicePushTokensByUser,
  upsertDevicePushToken,
} from '../models/devicePushTokens.model.js';
import {
  getFirebaseMessagingClient,
  isFirebasePushConfigured,
} from './firebaseAdmin.service.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asNullableText(value) {
  const text = asString(value);
  return text || null;
}

function normalizeCategory(value) {
  const normalized = asString(value).toLowerCase();
  if (['success', 'warning', 'error'].includes(normalized)) {
    return normalized;
  }
  return 'info';
}

function flattenData(input = {}, prefix = '', output = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return output;
  }

  for (const [key, value] of Object.entries(input)) {
    const targetKey = prefix ? `${prefix}.${key}` : key;
    if (value === undefined || value === null) continue;

    if (typeof value === 'object') {
      flattenData(value, targetKey, output);
      continue;
    }

    output[targetKey] = String(value);
  }

  return output;
}

function isTokenInvalid(errorCode) {
  return [
    'messaging/registration-token-not-registered',
    'messaging/invalid-registration-token',
    'messaging/invalid-argument',
  ].includes(asString(errorCode));
}

function buildFirebaseMessage({ token, notification }) {
  const title = asString(notification.title) || 'iShiine';
  const message = asString(notification.message);
  const category = normalizeCategory(notification.category);
  const data = flattenData(notification.payload || {});

  return {
    token,
    notification: {
      title,
      body: message,
    },
    data: {
      notificationId: asString(notification.id),
      title,
      message,
      category,
      ...data,
    },
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
      },
    },
  };
}

export async function registerDevicePush({
  userId,
  fcmToken,
  platform,
  appVersion,
  deviceLabel,
} = {}) {
  return upsertDevicePushToken({
    userId,
    fcmToken,
    platform,
    appVersion,
    deviceLabel,
  });
}

export async function unregisterDevicePush({ fcmToken } = {}) {
  return deactivateDevicePushToken(fcmToken);
}

export async function sendPushNotificationToUser({ userId, notification } = {}) {
  const safeUserId = asString(userId);
  if (!safeUserId || !notification || !isFirebasePushConfigured()) {
    return { sentCount: 0, skipped: true };
  }

  await ensurePushTokensTable();
  const rows = await listActiveDevicePushTokensByUser(safeUserId);
  const tokens = rows
    .map((row) => asString(row.fcm_token))
    .filter((token, index, list) => token && list.indexOf(token) === index);

  if (tokens.length === 0) {
    return { sentCount: 0, skipped: true };
  }

  const messaging = getFirebaseMessagingClient();
  const messages = tokens.map((token) => buildFirebaseMessage({ token, notification }));
  const response = await messaging.sendEach(messages, false);

  const invalidTokens = [];
  response.responses.forEach((item, index) => {
    if (!item.success && isTokenInvalid(item.error?.code)) {
      invalidTokens.push(tokens[index]);
    }
  });

  for (const token of invalidTokens) {
    await deactivateDevicePushToken(token);
  }

  return {
    sentCount: response.successCount,
    failureCount: response.failureCount,
  };
}
