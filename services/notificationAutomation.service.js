import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { findNotificationByDedupeKey } from '../models/notifications.model.js';
import { getUserById } from '../models/users.model.js';
import { getUserDueForReviewReminder, listLigueRecipientsForSetting, listUsersDueForReviewReminders, listUsersForCampaign, listUsersForEngagementRelance, listUsersWithSubscriptionDates } from '../models/notificationAudience.model.js';
import { listLatestLigueSettingsForAutomation } from '../models/ligueSettings.model.js';
import { ensurePushTokensTable } from '../models/devicePushTokens.model.js';
import {
  notifyAnnouncement,
  notifyLigueStart,
  notifyReviewCampaign,
  notifySubscriptionExpired,
  notifySubscriptionExpiring,
} from './notifications.service.js';
import { latestWeeklyOccurrence } from './ligueSchedule.service.js';
import { getSubscriptionStatus } from './subscription.service.js';
import { weekKeyFromDateUtc } from './weekKey.service.js';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function uniqueByUserId(rows = []) {
  const seen = new Set();
  const output = [];
  for (const row of rows) {
    const userId = asString(row?.id_users || row?.id_user);
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    output.push(row);
  }
  return output;
}

async function runInBatches(items, handler, batchSize = 20) {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    await Promise.allSettled(batch.map((item) => handler(item)));
  }
}

function campaignKind(value) {
  const normalized = asString(value).toLowerCase();
  return normalized === 'review_campaign' ? 'review_campaign' : 'announcement';
}

function reviewReminderBucketKey(now = new Date()) {
  const intervalHours = Math.max(1, env.REVIEW_REMINDER_INTERVAL_HOURS);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const bucketStart = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
  return bucketStart.toISOString().slice(0, 13);
}

function reviewReminderDedupeKey(campaignKey) {
  return `review-campaign:${asString(campaignKey)}`;
}

function engagementReminderBucketKey(now = new Date()) {
  const intervalHours = Math.max(1, env.ENGAGEMENT_REMINDER_INTERVAL_HOURS);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const bucketStart = new Date(Math.floor(now.getTime() / intervalMs) * intervalMs);
  return bucketStart.toISOString().slice(0, 13);
}

function engagementReminderDedupeKey(campaignKey) {
  return `announcement:${asString(campaignKey)}`;
}

const engagementReminderCopies = [
  {
    title: 'iShiine - Pr\u00eat \u00e0 apprendre ?',
    message: "Quelques minutes aujourd'hui peuvent faire avancer ton niveau. Ouvre iShiine et reprends ton rythme.",
  },
  {
    title: 'iShiine - Garde le rythme',
    message: 'Un petit effort r\u00e9gulier vaut beaucoup. Reviens apprendre une notion maintenant.',
  },
  {
    title: 'iShiine - Tu peux le faire',
    message: 'M\u00eame une courte s\u00e9ance compte. Lance iShiine et avance pas \u00e0 pas.',
  },
  {
    title: 'iShiine - On reprend ?',
    message: 'Ton prochain progr\u00e8s peut commencer aujourd\u2019hui. Reviens apprendre \u00e0 ton rythme.',
  },
];

function buildEngagementReminderCopy(now = new Date()) {
  const intervalHours = Math.max(1, env.ENGAGEMENT_REMINDER_INTERVAL_HOURS);
  const intervalMs = intervalHours * 60 * 60 * 1000;
  const bucketIndex = Math.floor(now.getTime() / intervalMs);
  return engagementReminderCopies[bucketIndex % engagementReminderCopies.length];
}

function subscriptionExpiringDedupeKey(expiryIso) {
  return `subscription-expiring:${asString(expiryIso).slice(0, 10)}`;
}

function subscriptionExpiredDedupeKey(expiryIso) {
  return `subscription-expired:${asString(expiryIso).slice(0, 10)}`;
}

async function hasNotification(userId, dedupeKey) {
  if (!asString(userId) || !asString(dedupeKey)) return false;
  const existing = await findNotificationByDedupeKey({ userId, dedupeKey });
  return !!existing;
}

function buildReviewReminderCopy(user = {}) {
  const dueReviews = Math.max(1, Number(user?.due_reviews) || 0);
  if (dueReviews <= 1) {
    return {
      title: 'iShiine \u{1F38A} R\u00e9vision en attente',
      message: "Tu as 1 r\u00e9vision \u00e0 reprendre. Ouvre iShiine d\u00e8s que tu es connect\u00e9 et garde le rythme.",
    };
  }

  return {
    title: 'iShiine \u{1F38A} R\u00e9visions en attente',
    message: `Tu as ${dueReviews} r\u00e9visions \u00e0 reprendre. Ouvre iShiine d\u00e8s que tu es connect\u00e9 et garde le rythme.`,
  };
}

async function dispatchLeagueStartNotifications(now = new Date()) {
  const settingsRows = await listLatestLigueSettingsForAutomation();
  const windowMs = Math.max(15, env.NOTIFICATION_JOBS_INTERVAL_SECONDS) * 1000;
  let sentCount = 0;

  for (const setting of settingsRows) {
    const configuredStart = toDate(setting.starts_at);
    if (!configuredStart) continue;

    const latestStart = latestWeeklyOccurrence({ startBase: configuredStart, now });
    const deltaMs = now.getTime() - latestStart.getTime();
    if (deltaMs < 0 || deltaMs >= windowMs) continue;

    const weekKey = weekKeyFromDateUtc(latestStart) || '';
    const recipients = uniqueByUserId(
      await listLigueRecipientsForSetting({
        className: setting.nom_classe,
        typeName: setting.nom_type,
      }),
    ).filter((user) => getSubscriptionStatus(user, now).active);

    await runInBatches(recipients, async (user) => {
      const notification = await notifyLigueStart({
        userId: user.id_users,
        weekKey,
        className: setting.nom_classe,
        typeName: setting.nom_type,
        startsAt: latestStart.toISOString(),
      });
      if (notification) sentCount += 1;
    });
  }

  return { sentCount };
}

async function dispatchReviewReminders(now = new Date()) {
  await ensurePushTokensTable();

  if (!env.REVIEW_REMINDER_ENABLED) {
    return { sentCount: 0, skipped: true, reason: 'disabled' };
  }

  const minDueReviews = Math.max(1, env.REVIEW_REMINDER_MIN_DUE);
  const rows = uniqueByUserId(
    await listUsersDueForReviewReminders({ dueBefore: now.toISOString() }),
  ).filter((user) => (Number(user?.due_reviews) || 0) >= minDueReviews);

  const campaignKey = `review-reminder:${reviewReminderBucketKey(now)}`;
  let sentCount = 0;

  await runInBatches(rows, async (user) => {
    if (await hasNotification(user.id_users, reviewReminderDedupeKey(campaignKey))) {
      return;
    }

    const copy = buildReviewReminderCopy(user);
    const notification = await notifyReviewCampaign({
      userId: user.id_users,
      title: copy.title,
      message: copy.message,
      campaignKey,
      payload: {
        automated: true,
        source: 'review_reminder',
        dueReviews: Number(user?.due_reviews) || 0,
        nextReviewAt: asString(user?.next_review_at),
      },
    });
    if (notification) sentCount += 1;
  });

  return {
    recipientCount: rows.length,
    sentCount,
    campaignKey,
  };
}

async function dispatchEngagementRelanceNotifications(now = new Date()) {
  await ensurePushTokensTable();

  if (!env.ENGAGEMENT_REMINDER_ENABLED) {
    return { sentCount: 0, skipped: true, reason: 'disabled' };
  }

  const rows = uniqueByUserId(
    await listUsersForEngagementRelance({ dueBefore: now.toISOString() }),
  ).filter((user) => (Number(user?.due_reviews) || 0) <= 0);

  const campaignKey = `engagement-relance:${engagementReminderBucketKey(now)}`;
  let sentCount = 0;

  await runInBatches(rows, async (user) => {
    if (await hasNotification(user.id_users, engagementReminderDedupeKey(campaignKey))) {
      return;
    }

    const copy = buildEngagementReminderCopy(now);
    const notification = await notifyAnnouncement({
      userId: user.id_users,
      title: copy.title,
      message: copy.message,
      category: 'info',
      campaignKey,
      payload: {
        automated: true,
        source: 'engagement_relance',
        dueReviews: Number(user?.due_reviews) || 0,
        lastPushSeenAt: asString(user?.last_push_seen_at),
      },
    });
    if (notification) sentCount += 1;
  });

  return {
    recipientCount: rows.length,
    sentCount,
    campaignKey,
  };
}

async function dispatchSubscriptionLifecycleNotifications(now = new Date()) {
  const rows = uniqueByUserId(await listUsersWithSubscriptionDates());
  const reminderWindowMs = Math.max(1, env.SUBSCRIPTION_EXPIRY_REMINDER_HOURS) * 60 * 60 * 1000;
  const expiredLookbackMs = Math.max(1, env.SUBSCRIPTION_EXPIRED_LOOKBACK_HOURS) * 60 * 60 * 1000;

  let expiringCount = 0;
  let expiredCount = 0;

  await runInBatches(rows, async (user) => {
    const expiry = toDate(user.subscription_expiry);
    if (!expiry) return;
    const expiryIso = expiry.toISOString();

    const deltaMs = expiry.getTime() - now.getTime();
    const subscription = getSubscriptionStatus(user, now);

    if (subscription.active && deltaMs > 0 && deltaMs <= reminderWindowMs) {
      if (await hasNotification(user.id_users, subscriptionExpiringDedupeKey(expiryIso))) {
        return;
      }

      const notification = await notifySubscriptionExpiring({
        userId: user.id_users,
        expiryAt: expiryIso,
        hoursRemaining: deltaMs / (60 * 60 * 1000),
      });
      if (notification) expiringCount += 1;
      return;
    }

    if (subscription.reason === 'EXPIRED' && deltaMs <= 0 && Math.abs(deltaMs) <= expiredLookbackMs) {
      if (await hasNotification(user.id_users, subscriptionExpiredDedupeKey(expiryIso))) {
        return;
      }

      const notification = await notifySubscriptionExpired({
        userId: user.id_users,
        expiryAt: expiryIso,
      });
      if (notification) expiredCount += 1;
    }
  });

  return { expiringCount, expiredCount };
}

export async function sendConnectivitySystemNotifications({
  userId,
  trigger = 'online',
  now = new Date(),
  payload = {},
  reviewSummary = null,
} = {}) {
  const safeUserId = asString(userId);
  if (!safeUserId) {
    return { sentCount: 0, skipped: true, reason: 'missing_user' };
  }

  const result = {
    sentCount: 0,
    reviewReminder: { sentCount: 0, skipped: true, reason: 'not_due' },
    subscription: { sentCount: 0, skipped: true, reason: 'not_due' },
  };

  if (env.REVIEW_REMINDER_ENABLED) {
    const minDueReviews = Math.max(1, env.REVIEW_REMINDER_MIN_DUE);
    const overrideDueReviews = Number(reviewSummary?.dueReviews) || 0;
    const reviewUser = overrideDueReviews > 0
      ? {
          id_users: safeUserId,
          due_reviews: overrideDueReviews,
          next_review_at: asString(reviewSummary?.nextReviewAt),
        }
      : await getUserDueForReviewReminder({
          userId: safeUserId,
          dueBefore: now.toISOString(),
        });
    const dueReviews = Number(reviewUser?.due_reviews) || 0;

    if (dueReviews >= minDueReviews) {
      const campaignKey = `review-reminder:${reviewReminderBucketKey(now)}`;
      const dedupeKey = reviewReminderDedupeKey(campaignKey);

      if (await hasNotification(safeUserId, dedupeKey)) {
        result.reviewReminder = {
          sentCount: 0,
          skipped: true,
          reason: 'already_exists',
          dueReviews,
          campaignKey,
        };
      } else {
        const copy = buildReviewReminderCopy(reviewUser);
        const notification = await notifyReviewCampaign({
          userId: safeUserId,
          title: copy.title,
          message: copy.message,
          campaignKey,
          payload: {
            ...payload,
            automated: true,
            source: 'review_reminder',
            trigger,
            dueReviews,
            nextReviewAt: asString(reviewUser?.next_review_at),
          },
        });

        const sentCount = notification ? 1 : 0;
        result.reviewReminder = {
          sentCount,
          skipped: !notification,
          dueReviews,
          campaignKey,
        };
        result.sentCount += sentCount;
      }
    }
  } else {
    result.reviewReminder = {
      sentCount: 0,
      skipped: true,
      reason: 'disabled',
    };
  }

  const user = await getUserById(safeUserId);
  const expiry = toDate(user?.subscription_expiry);
  if (user && expiry) {
    const expiryIso = expiry.toISOString();
    const deltaMs = expiry.getTime() - now.getTime();
    const subscription = getSubscriptionStatus(user, now);
    const reminderWindowMs = Math.max(1, env.SUBSCRIPTION_EXPIRY_REMINDER_HOURS) * 60 * 60 * 1000;
    const expiredLookbackMs = Math.max(1, env.SUBSCRIPTION_EXPIRED_LOOKBACK_HOURS) * 60 * 60 * 1000;

    if (subscription.active && deltaMs > 0 && deltaMs <= reminderWindowMs) {
      const dedupeKey = subscriptionExpiringDedupeKey(expiryIso);
      if (await hasNotification(safeUserId, dedupeKey)) {
        result.subscription = {
          sentCount: 0,
          skipped: true,
          reason: 'already_exists',
          type: 'expiring',
          expiryAt: expiryIso,
        };
      } else {
        const notification = await notifySubscriptionExpiring({
          userId: safeUserId,
          expiryAt: expiryIso,
          hoursRemaining: deltaMs / (60 * 60 * 1000),
        });
        const sentCount = notification ? 1 : 0;
        result.subscription = {
          sentCount,
          skipped: !notification,
          type: 'expiring',
          expiryAt: expiryIso,
        };
        result.sentCount += sentCount;
      }
    } else if (subscription.reason === 'EXPIRED' && deltaMs <= 0 && Math.abs(deltaMs) <= expiredLookbackMs) {
      const dedupeKey = subscriptionExpiredDedupeKey(expiryIso);
      if (await hasNotification(safeUserId, dedupeKey)) {
        result.subscription = {
          sentCount: 0,
          skipped: true,
          reason: 'already_exists',
          type: 'expired',
          expiryAt: expiryIso,
        };
      } else {
        const notification = await notifySubscriptionExpired({
          userId: safeUserId,
          expiryAt: expiryIso,
        });
        const sentCount = notification ? 1 : 0;
        result.subscription = {
          sentCount,
          skipped: !notification,
          type: 'expired',
          expiryAt: expiryIso,
        };
        result.sentCount += sentCount;
      }
    }
  }

  return result;
}

export async function sendAdminCampaign({
  kind = 'announcement',
  title,
  message,
  audience = 'all',
  category = 'info',
  campaignKey,
  payload = {},
} = {}) {
  const safeKind = campaignKind(kind);
  const safeCampaignKey = asString(campaignKey) || crypto.randomUUID();
  const rows = uniqueByUserId(await listUsersForCampaign({ audience }));
  const now = new Date();
  const filteredRows = asString(audience).toLowerCase() === 'subscribed'
    ? rows.filter((user) => getSubscriptionStatus(user, now).active)
    : rows;

  let sentCount = 0;
  await runInBatches(filteredRows, async (user) => {
    const notification = safeKind === 'review_campaign'
      ? await notifyReviewCampaign({
          userId: user.id_users,
          title,
          message,
          campaignKey: safeCampaignKey,
          payload: {
            ...payload,
            audience,
          },
        })
      : await notifyAnnouncement({
          userId: user.id_users,
          title,
          message,
          category,
          campaignKey: safeCampaignKey,
          payload: {
            ...payload,
            audience,
          },
        });

    if (notification) sentCount += 1;
  });

  return {
    kind: safeKind,
    audience: asString(audience).toLowerCase() || 'all',
    campaignKey: safeCampaignKey,
    recipientCount: filteredRows.length,
    sentCount,
  };
}

let automationTimer = null;
let cycleRunning = false;

export async function runNotificationAutomationCycle({ now = new Date() } = {}) {
  if (cycleRunning) {
    return { skipped: true, reason: 'already_running' };
  }

  cycleRunning = true;
  try {
    const [leagueStart, reviewReminders, engagementRelance, subscriptions] = await Promise.all([
      dispatchLeagueStartNotifications(now),
      dispatchReviewReminders(now),
      dispatchEngagementRelanceNotifications(now),
      dispatchSubscriptionLifecycleNotifications(now),
    ]);

    return {
      ok: true,
      leagueStart,
      reviewReminders,
      engagementRelance,
      subscriptions,
    };
  } finally {
    cycleRunning = false;
  }
}

export function startNotificationAutomation() {
  if (!env.NOTIFICATION_JOBS_ENABLED) {
    console.log('[notifications] automation disabled');
    return;
  }

  if (automationTimer) return;

  const intervalMs = Math.max(15, env.NOTIFICATION_JOBS_INTERVAL_SECONDS) * 1000;
  void runNotificationAutomationCycle().catch((error) => {
    console.error('[notifications] automation bootstrap failed', {
      code: error?.code,
      message: error?.message,
    });
  });

  automationTimer = setInterval(() => {
    void runNotificationAutomationCycle().catch((error) => {
      console.error('[notifications] automation cycle failed', {
        code: error?.code,
        message: error?.message,
      });
    });
  }, intervalMs);

  if (typeof automationTimer.unref === 'function') {
    automationTimer.unref();
  }

  console.log(`[notifications] automation started (${Math.round(intervalMs / 1000)}s)`);
}
