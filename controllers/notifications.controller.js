import {
  acknowledgeAllNotifications,
  acknowledgeNotification,
  listUserNotifications,
} from '../services/notifications.service.js';
import { runNotificationAutomationCycle, sendAdminCampaign } from '../services/notificationAutomation.service.js';
import {
  registerDevicePush,
  unregisterDevicePush,
} from '../services/pushNotifications.service.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = asString(value).toLowerCase();
  if (['1', 'true', 'yes', 'oui'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'non'].includes(normalized)) return false;
  return fallback;
}

function asInt(value, fallback = 20) {
  const parsed = Number.parseInt(asString(value), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function buildError(message, statusCode = 400, code = 'BAD_REQUEST') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function resolveUserId(source = {}) {
  return asString(
    source.userId || source.id_user || source.id_users || source.user_id,
  );
}

export async function listNotifications(req, res, next) {
  try {
    const userId = resolveUserId(req.query);
    if (!userId) {
      throw buildError('userId requis.', 400, 'USER_ID_REQUIRED');
    }

    const notifications = await listUserNotifications({
      userId,
      unreadOnly: asBool(req.query.unreadOnly, false),
      limit: asInt(req.query.limit, 20),
    });

    res.json({
      ok: true,
      count: notifications.length,
      notifications,
    });
  } catch (error) {
    next(error);
  }
}

export async function registerDevice(req, res, next) {
  try {
    const body = req.body || {};
    const userId = resolveUserId(body);
    const fcmToken = asString(body.fcmToken || body.token || body.fcm_token);
    if (!userId || !fcmToken) {
      throw buildError('userId et fcmToken requis.', 400, 'DEVICE_TOKEN_REQUIRED');
    }

    const device = await registerDevicePush({
      userId,
      fcmToken,
      platform: body.platform,
      appVersion: body.appVersion || body.app_version,
      deviceLabel: body.deviceLabel || body.device_label,
    });

    res.status(201).json({
      ok: true,
      device,
    });
  } catch (error) {
    next(error);
  }
}

export async function unregisterDevice(req, res, next) {
  try {
    const body = req.body || {};
    const fcmToken = asString(body.fcmToken || body.token || body.fcm_token);
    if (!fcmToken) {
      throw buildError('fcmToken requis.', 400, 'DEVICE_TOKEN_REQUIRED');
    }

    const updatedCount = await unregisterDevicePush({ fcmToken });

    res.json({
      ok: true,
      updatedCount,
    });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationAsRead(req, res, next) {
  try {
    const userId = resolveUserId(req.body || {});
    if (!userId) {
      throw buildError('userId requis.', 400, 'USER_ID_REQUIRED');
    }

    const notification = await acknowledgeNotification({
      notificationId: req.params.notificationId,
      userId,
    });

    res.json({
      ok: true,
      notification,
    });
  } catch (error) {
    next(error);
  }
}

export async function markAllNotificationsAsRead(req, res, next) {
  try {
    const userId = resolveUserId(req.body || req.query || {});
    if (!userId) {
      throw buildError('userId requis.', 400, 'USER_ID_REQUIRED');
    }

    const result = await acknowledgeAllNotifications({ userId });

    res.json({
      ok: true,
      updatedCount: result.updatedCount,
    });
  } catch (error) {
    next(error);
  }
}

export async function broadcastAdminCampaign(req, res, next) {
  try {
    const body = req.body || {};
    const kind = asString(body.kind || body.template || 'announcement').toLowerCase();
    const audience = asString(body.audience || 'all').toLowerCase() || 'all';
    const category = asString(body.category || 'info').toLowerCase() || 'info';
    const title = asString(body.title);
    const message = asString(body.message);

    if (kind !== 'announcement' && kind !== 'review_campaign') {
      throw buildError('kind invalide.', 400, 'INVALID_NOTIFICATION_KIND');
    }

    if (!message && kind === 'announcement') {
      throw buildError('message requis pour une annonce.', 400, 'MESSAGE_REQUIRED');
    }

    const result = await sendAdminCampaign({
      kind,
      title,
      message,
      audience,
      category,
      campaignKey: body.campaignKey || body.campaign_key,
      payload: {
        requestedBy: asString(req.admin?.idAdmin || req.admin?.id_admin || req.admin?.displayName),
      },
    });

    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

export async function runAdminNotificationJobs(req, res, next) {
  try {
    const result = await runNotificationAutomationCycle();
    res.json({
      ok: true,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}
