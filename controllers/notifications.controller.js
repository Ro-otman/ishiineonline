import {
  acknowledgeAllNotifications,
  acknowledgeNotification,
  listUserNotifications,
  notifyAnnouncement,
} from '../services/notifications.service.js';
import { runNotificationAutomationCycle, sendAdminCampaign } from '../services/notificationAutomation.service.js';
import { getLatestAdminPushTarget } from '../models/adminDashboard.model.js';
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

function redirectAdminOverviewWithFeedback(res, kind, message) {
  const key = kind === 'error' ? 'error' : 'success';
  const encoded = encodeURIComponent(asString(message) || 'Action terminee.');
  return res.redirect('/admin?' + key + '=' + encoded);
}

export async function listNotifications(req, res, next) {
  try {
    const userId = asString(req.user?.idUser);
    if (!userId) {
      throw buildError('Connexion utilisateur requise.', 401, 'USER_AUTH_REQUIRED');
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
    const userId = asString(req.user?.idUser);
    const fcmToken = asString(body.fcmToken || body.token || body.fcm_token);
    if (!userId || !fcmToken) {
      throw buildError('Connexion utilisateur et fcmToken requis.', 400, 'DEVICE_TOKEN_REQUIRED');
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
    const userId = asString(req.user?.idUser);
    if (!userId) {
      throw buildError('Connexion utilisateur requise.', 401, 'USER_AUTH_REQUIRED');
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
    const userId = asString(req.user?.idUser);
    if (!userId) {
      throw buildError('Connexion utilisateur requise.', 401, 'USER_AUTH_REQUIRED');
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

export async function sendAdminTestPushFromDashboard(req, res, next) {
  try {
    const body = req.body || {};
    const title = asString(body.title) || 'iShiine \u2713 Test';
    const message = asString(body.message) || 'Ceci est une notification de test envoyee depuis l\'admin.';
    const target = await getLatestAdminPushTarget();
    const userId = asString(body.userId || body.user_id || target?.id_user);

    if (!userId) {
      return redirectAdminOverviewWithFeedback(
        res,
        'error',
        "Aucun appareil actif n'a ete detecte pour envoyer la notification test.",
      );
    }

    const notification = await notifyAnnouncement({
      userId,
      title,
      message,
      category: 'info',
      payload: {
        source: 'admin_dashboard_test',
        requestedBy: asString(req.admin?.idAdmin || req.admin?.id_admin || req.admin?.displayName || 'admin'),
        targetPlatform: asString(target?.platform),
      },
    });

    if (!notification) {
      return redirectAdminOverviewWithFeedback(
        res,
        'error',
        "La notification test n'a pas pu etre creee.",
      );
    }

    const targetLabel = asString(target?.display_name || target?.id_user || userId);
    return redirectAdminOverviewWithFeedback(
      res,
      'success',
      'Notification test envoyee a ' + targetLabel + '.',
    );
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


