function toInt(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function getSubscriptionStatus(user, now = new Date()) {
  if (!user) return { active: false, reason: 'NO_USER', expiryAt: null };

  if (!toInt(user.is_subscribed)) {
    return {
      active: false,
      reason: 'NOT_SUBSCRIBED',
      expiryAt: toDate(user.subscription_expiry)?.toISOString() ?? null
    };
  }

  const expiry = toDate(user.subscription_expiry);
  if (expiry && now.getTime() >= expiry.getTime()) {
    return { active: false, reason: 'EXPIRED', expiryAt: expiry.toISOString() };
  }

  return { active: true, reason: null, expiryAt: expiry?.toISOString() ?? null };
}

export function isSubscriptionActive(user, now = new Date()) {
  return getSubscriptionStatus(user, now).active;
}
