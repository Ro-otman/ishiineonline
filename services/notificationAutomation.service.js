import crypto from 'node:crypto';

import { env } from '../config/env.js';
import { listLigueRecipientsForSetting, listUsersForCampaign, listUsersWithSubscriptionDates } from '../models/notificationAudience.model.js';
import { listLatestLigueSettingsForAutomation } from '../models/ligueSettings.model.js';
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

async function dispatchSubscriptionLifecycleNotifications(now = new Date()) {
  const rows = uniqueByUserId(await listUsersWithSubscriptionDates());
  const reminderWindowMs = Math.max(1, env.SUBSCRIPTION_EXPIRY_REMINDER_HOURS) * 60 * 60 * 1000;
  const expiredLookbackMs = Math.max(1, env.SUBSCRIPTION_EXPIRED_LOOKBACK_HOURS) * 60 * 60 * 1000;

  let expiringCount = 0;
  let expiredCount = 0;

  await runInBatches(rows, async (user) => {
    const expiry = toDate(user.subscription_expiry);
    if (!expiry) return;

    const deltaMs = expiry.getTime() - now.getTime();
    const subscription = getSubscriptionStatus(user, now);

    if (subscription.active && deltaMs > 0 && deltaMs <= reminderWindowMs) {
      const notification = await notifySubscriptionExpiring({
        userId: user.id_users,
        expiryAt: expiry.toISOString(),
        hoursRemaining: deltaMs / (60 * 60 * 1000),
      });
      if (notification) expiringCount += 1;
      return;
    }

    if (subscription.reason === 'EXPIRED' && deltaMs <= 0 && Math.abs(deltaMs) <= expiredLookbackMs) {
      const notification = await notifySubscriptionExpired({
        userId: user.id_users,
        expiryAt: expiry.toISOString(),
      });
      if (notification) expiredCount += 1;
    }
  });

  return { expiringCount, expiredCount };
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
    const [leagueStart, subscriptions] = await Promise.all([
      dispatchLeagueStartNotifications(now),
      dispatchSubscriptionLifecycleNotifications(now),
    ]);

    return {
      ok: true,
      leagueStart,
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
