import { env } from '../config/env.js';
import {
  getPaymentByTransactionId,
  upsertPaymentRecord,
} from '../models/payments.model.js';
import { upsertWhiteExamAccess } from '../models/whiteExamAccess.model.js';
import { activateUserSubscription, getUserById } from '../models/users.model.js';

const DEFAULT_API_BASE_URL = 'https://api.fedapay.com/v1';
const DEFAULT_PLAN = 'premium_monthly';
const WHITE_EXAM_PLAN = 'white_exam_access';

function asString(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toUrl(value) {
  const text = asString(value);
  if (!text) return null;
  try {
    return new URL(text);
  } catch {
    return null;
  }
}

function normalizeStatus(value) {
  return asString(value).toLowerCase();
}

function buildError(message, statusCode = 400, code = 'BAD_REQUEST', details) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function inferBaseUrl(req) {
  const configured = asString(env.PAYMENT_CALLBACK_BASE_URL);
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const protocol = req.protocol || 'https';
  const host = req.get('host');
  if (!host) {
    throw buildError(
      'Impossible de determiner l URL publique du backend.',
      500,
      'PAYMENT_BASE_URL_MISSING',
    );
  }
  return `${protocol}://${host}`;
}

function resolvePlanConfig(plan) {
  const normalized = asString(plan) || DEFAULT_PLAN;
  if (normalized === DEFAULT_PLAN) {
    return {
      key: DEFAULT_PLAN,
      amount: toInt(env.PAYMENT_PREMIUM_AMOUNT, 375),
      currencyIso: asString(env.PAYMENT_CURRENCY_ISO || 'XOF') || 'XOF',
      description:
        asString(env.PAYMENT_PREMIUM_DESCRIPTION) || 'Abonnement mensuel',
      durationDays: toInt(env.PAYMENT_DURATION_DAYS, 30),
      activationKind: 'subscription',
    };
  }
  if (normalized === WHITE_EXAM_PLAN) {
    return {
      key: WHITE_EXAM_PLAN,
      amount: toInt(env.PAYMENT_WHITE_EXAM_AMOUNT, 250),
      currencyIso: asString(env.PAYMENT_CURRENCY_ISO || 'XOF') || 'XOF',
      description:
        asString(env.PAYMENT_WHITE_EXAM_DESCRIPTION) || 'Acces examen blanc',
      durationDays: 0,
      activationKind: 'white_exam_access',
    };
  }
  throw buildError('Plan de paiement non supporte.', 400, 'UNSUPPORTED_PLAN');
}

function sanitizeCustomer(customer = {}) {
  const firstname = asString(customer.firstname || customer.firstName);
  const lastname = asString(customer.lastname || customer.lastName);
  const email = asString(customer.email);
  const phoneBlock = customer.phone_number || customer.phoneNumber || {};
  const phoneNumber = asString(phoneBlock.number || customer.phone);
  const country = asString(phoneBlock.country || customer.country || 'bj').toLowerCase();

  if (!firstname || !lastname || !phoneNumber) {
    throw buildError(
      'Informations client incompletes pour initier le paiement.',
      400,
      'CUSTOMER_REQUIRED',
    );
  }

  return {
    firstname,
    lastname,
    email: email || undefined,
    phone_number: {
      number: phoneNumber,
      country: country || 'bj',
    },
  };
}

function sanitizePlanContext(planConfig, context = {}) {
  const safeContext = asObject(context);
  if (planConfig.activationKind !== 'white_exam_access') {
    return {};
  }

  const classe = asString(
    safeContext.classe || safeContext.classe_name || safeContext.className,
  );
  const weekKey = asString(safeContext.weekKey || safeContext.week_key);

  if (!classe || !/^\d{4}-\d{2}-\d{2}$/.test(weekKey)) {
    throw buildError(
      "Classe et weekKey sont requis pour payer l'examen blanc.",
      400,
      'WHITE_EXAM_CONTEXT_REQUIRED',
    );
  }

  return {
    classe,
    week_key: weekKey,
  };
}

function getFedapayConfig() {
  const secretKey = asString(env.FEDAPAY_SECRET_KEY);
  if (!secretKey) {
    throw buildError(
      'FEDAPAY_SECRET_KEY n est pas configuree sur le backend.',
      500,
      'FEDAPAY_CONFIG_MISSING',
    );
  }

  return {
    apiBaseUrl:
      asString(env.FEDAPAY_API_BASE_URL).replace(/\/+$/, '') || DEFAULT_API_BASE_URL,
    secretKey,
  };
}

async function fedapayRequest(path, { method = 'GET', body } = {}) {
  const { apiBaseUrl, secretKey } = getFedapayConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const raw = await response.text();
    let data = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw buildError(
        data?.message || `FedaPay a repondu avec le statut ${response.status}.`,
        response.status >= 400 && response.status < 500 ? 400 : 502,
        'FEDAPAY_REQUEST_FAILED',
        { status: response.status, body: data ?? raw },
      );
    }
    return data ?? {};
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw buildError('FedaPay met trop de temps a repondre.', 504, 'FEDAPAY_TIMEOUT');
    }
    if (error?.code) {
      throw error;
    }
    throw buildError(
      error?.message || 'Impossible de joindre FedaPay.',
      502,
      'FEDAPAY_UNREACHABLE',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function buildCallbackUrl(req, { userId, planKey }) {
  const callback = new URL(`${inferBaseUrl(req)}/api/shiine_checkout`);
  callback.searchParams.set('userId', userId);
  callback.searchParams.set('plan', planKey);
  return callback.toString();
}

function extractTransactionEnvelope(payload) {
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload['v1/transaction'] ||
    payload.transaction ||
    payload.trx ||
    payload.data?.transaction ||
    payload.data?.trx ||
    payload.data ||
    null
  );
}

function pickFirstText(candidates = []) {
  for (const candidate of candidates) {
    const text = asString(candidate);
    if (text) return text;
  }
  return '';
}

function pickFirstObject(candidates = []) {
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      return candidate;
    }
  }
  return {};
}

function extractMetadata(payload) {
  const tx = extractTransactionEnvelope(payload) || {};
  return pickFirstObject([payload?.metadata, tx?.metadata]);
}

function extractPaymentUrl(payload) {
  const tx = extractTransactionEnvelope(payload) || {};
  return pickFirstText([
    payload?.payment_url,
    payload?.paymentUrl,
    payload?.checkout_url,
    payload?.checkoutUrl,
    tx?.payment_url,
    tx?.paymentUrl,
    tx?.url,
  ]);
}

function extractTransactionId(payload) {
  const tx = extractTransactionEnvelope(payload) || {};
  return pickFirstText([
    payload?.transaction_id,
    payload?.transactionId,
    tx?.id,
    tx?.transaction_id,
  ]);
}

function extractStatus(payload) {
  const tx = extractTransactionEnvelope(payload) || {};
  return normalizeStatus(
    pickFirstText([
      payload?.status,
      tx?.status,
    ]),
  );
}

function extractUserId(payload, fallback = '') {
  const tx = extractTransactionEnvelope(payload) || {};
  const metadata = extractMetadata(payload);
  return pickFirstText([
    metadata?.user_id,
    metadata?.userId,
    payload?.userId,
    tx?.userId,
    fallback,
  ]);
}

function extractPlanKey(payload, fallback = '') {
  const tx = extractTransactionEnvelope(payload) || {};
  const metadata = extractMetadata(payload);
  return pickFirstText([
    metadata?.plan,
    payload?.plan,
    tx?.plan,
    fallback,
  ]);
}

function extractWhiteExamContext(payload, fallback = {}) {
  const metadata = extractMetadata(payload);
  return {
    classe: pickFirstText([
      metadata?.white_exam_classe,
      metadata?.classe,
      payload?.classe,
      fallback.classe,
      fallback.classe_name,
    ]),
    weekKey: pickFirstText([
      metadata?.white_exam_week_key,
      metadata?.week_key,
      payload?.week_key,
      fallback.weekKey,
      fallback.week_key,
    ]),
  };
}

function extractAmount(payload, fallback = 0) {
  const tx = extractTransactionEnvelope(payload) || {};
  const candidates = [
    tx?.amount,
    payload?.amount,
    fallback,
  ];
  for (const candidate of candidates) {
    const parsed = toInt(candidate, Number.NaN);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.max(0, toInt(fallback, 0));
}

function extractCurrencyIso(payload, fallback = 'XOF') {
  const tx = extractTransactionEnvelope(payload) || {};
  return pickFirstText([
    tx?.currency?.iso,
    payload?.currency?.iso,
    tx?.currency_iso,
    payload?.currency_iso,
    fallback,
  ]) || 'XOF';
}

function extractDescription(payload, fallback = '') {
  const tx = extractTransactionEnvelope(payload) || {};
  return pickFirstText([
    tx?.description,
    payload?.description,
    fallback,
  ]);
}

function extractCustomerSnapshot(payload, fallback = {}) {
  const tx = extractTransactionEnvelope(payload) || {};
  const source = pickFirstObject([payload?.customer, tx?.customer]);
  const fallbackPhone = fallback.phone_number || fallback.phoneNumber || {};
  const phoneBlock = source.phone_number || source.phoneNumber || {};

  return {
    firstname: pickFirstText([
      source.firstname,
      source.first_name,
      fallback.firstname,
      fallback.firstName,
    ]),
    lastname: pickFirstText([
      source.lastname,
      source.last_name,
      fallback.lastname,
      fallback.lastName,
    ]),
    email: pickFirstText([
      source.email,
      fallback.email,
    ]),
    phone: pickFirstText([
      phoneBlock.number,
      source.phone,
      fallbackPhone.number,
      fallback.phone,
    ]),
  };
}

function extractProviderDate(payload, ...keys) {
  const tx = extractTransactionEnvelope(payload) || {};
  return pickFirstText([
    ...keys.flatMap((key) => [
      payload?.[key],
      tx?.[key],
    ]),
  ]);
}

function collectQueryValue(query, key) {
  if (!query || typeof query !== 'object') return '';
  const raw = query[key];
  if (Array.isArray(raw)) return asString(raw[0]);
  return asString(raw);
}

function extractTransactionIdFromCallback({ callbackUrl, query, explicitTransactionId }) {
  const direct = asString(explicitTransactionId);
  if (direct) return direct;

  const candidates = [
    collectQueryValue(query, 'id'),
    collectQueryValue(query, 'transaction_id'),
    collectQueryValue(query, 'transactionId'),
    collectQueryValue(query, 'trx_id'),
    collectQueryValue(query, 'payment_id'),
  ].filter(Boolean);

  const parsedUrl = toUrl(callbackUrl);
  if (parsedUrl) {
    candidates.push(
      asString(parsedUrl.searchParams.get('id')),
      asString(parsedUrl.searchParams.get('transaction_id')),
      asString(parsedUrl.searchParams.get('transactionId')),
      asString(parsedUrl.searchParams.get('trx_id')),
      asString(parsedUrl.searchParams.get('payment_id')),
    );
  }

  return candidates.find(Boolean) || '';
}

function extractStatusFromCallback({ callbackUrl, query }) {
  const candidates = [
    collectQueryValue(query, 'status'),
    collectQueryValue(query, 'payment_status'),
    collectQueryValue(query, 'transaction_status'),
  ].filter(Boolean);

  const parsedUrl = toUrl(callbackUrl);
  if (parsedUrl) {
    candidates.push(
      asString(parsedUrl.searchParams.get('status')),
      asString(parsedUrl.searchParams.get('payment_status')),
      asString(parsedUrl.searchParams.get('transaction_status')),
    );
  }

  return normalizeStatus(candidates.find(Boolean) || '');
}

function isSuccessfulStatus(status) {
  return ['approved', 'transferred'].includes(normalizeStatus(status));
}

async function markSubscriptionApproved(userId, durationDays) {
  const user = await getUserById(userId);
  if (!user) {
    return { updated: false, user: null };
  }
  const updatedUser = await activateUserSubscription({ userId, durationDays });
  return { updated: true, user: updatedUser };
}

async function markWhiteExamAccessApproved({
  userId,
  payment,
  payload,
  fallbackContext = {},
}) {
  const context = extractWhiteExamContext(payload, fallbackContext);
  if (!context.classe || !context.weekKey) {
    return { updated: false, access: null };
  }

  const access = await upsertWhiteExamAccess({
    transactionId: payment?.transaction_id || extractTransactionId(payload),
    userId,
    weekKey: context.weekKey,
    classeName: context.classe,
    planKey: payment?.plan_key || WHITE_EXAM_PLAN,
    status: payment?.status || extractStatus(payload) || 'approved',
    amount:
      payment?.amount ||
      extractAmount(payload, resolvePlanConfig(WHITE_EXAM_PLAN).amount),
    currencyIso:
      payment?.currency_iso ||
      extractCurrencyIso(payload, env.PAYMENT_CURRENCY_ISO || 'XOF'),
    approvedAt:
      payment?.approved_at ||
      extractProviderDate(payload, 'approved_at', 'approvedAt') ||
      new Date().toISOString(),
  });

  return { updated: Boolean(access), access };
}

async function applyApprovedPaymentActivation({
  userId,
  payment,
  payload,
  fallbackContext = {},
}) {
  const planConfig = resolvePlanConfig(payment?.plan_key || DEFAULT_PLAN);
  if (planConfig.activationKind === 'subscription') {
    const activation = await markSubscriptionApproved(userId, planConfig.durationDays);
    return {
      updated: activation.updated,
      activationKind: planConfig.activationKind,
      planKey: planConfig.key,
    };
  }
  if (planConfig.activationKind === 'white_exam_access') {
    const access = await markWhiteExamAccessApproved({
      userId,
      payment,
      payload,
      fallbackContext,
    });
    return {
      updated: access.updated,
      activationKind: planConfig.activationKind,
      planKey: planConfig.key,
    };
  }
  return {
    updated: false,
    activationKind: planConfig.activationKind,
    planKey: planConfig.key,
  };
}

async function persistTransactionSnapshot({
  payload,
  transactionId,
  userId,
  planKey,
  customer,
  amount,
  currencyIso,
  paymentUrl,
  callbackUrl,
  description,
  lastEventSource,
}) {
  const normalizedPayload = asObject(payload);
  const effectiveTransactionId =
    asString(transactionId) || extractTransactionId(normalizedPayload);
  if (!effectiveTransactionId) return null;

  const existing = await getPaymentByTransactionId(effectiveTransactionId);
  const customerSnapshot = extractCustomerSnapshot(normalizedPayload, customer);

  return upsertPaymentRecord({
    provider: 'fedapay',
    transactionId: effectiveTransactionId,
    userId: extractUserId(normalizedPayload, userId || existing?.user_id),
    planKey: extractPlanKey(normalizedPayload, planKey || existing?.plan_key || DEFAULT_PLAN),
    status: extractStatus(normalizedPayload) || existing?.status || 'created',
    amount: extractAmount(normalizedPayload, amount || existing?.amount || 0),
    currencyIso: extractCurrencyIso(normalizedPayload, currencyIso || existing?.currency_iso || 'XOF'),
    description: extractDescription(normalizedPayload, description || existing?.description || ''),
    customerFirstname: customerSnapshot.firstname || existing?.customer_firstname,
    customerLastname: customerSnapshot.lastname || existing?.customer_lastname,
    customerEmail: customerSnapshot.email || existing?.customer_email,
    customerPhone: customerSnapshot.phone || existing?.customer_phone,
    paymentUrl:
      extractPaymentUrl(normalizedPayload) ||
      asString(paymentUrl) ||
      existing?.payment_url ||
      null,
    callbackUrl: asString(callbackUrl) || existing?.callback_url || null,
    approvedAt:
      extractProviderDate(normalizedPayload, 'approved_at', 'approvedAt') ||
      existing?.approved_at,
    transferredAt:
      extractProviderDate(normalizedPayload, 'transferred_at', 'transferredAt') ||
      existing?.transferred_at,
    providerCreatedAt:
      extractProviderDate(normalizedPayload, 'created_at', 'createdAt') ||
      existing?.provider_created_at,
    providerUpdatedAt:
      extractProviderDate(normalizedPayload, 'updated_at', 'updatedAt') ||
      existing?.provider_updated_at,
    lastEventSource: lastEventSource || existing?.last_event_source || 'unknown',
    rawPayload: normalizedPayload,
  });
}

export async function createPaymentCheckout({
  req,
  userId,
  plan,
  customer,
  context,
}) {
  const safeUserId = asString(userId);
  if (!safeUserId) {
    throw buildError('userId requis.', 400, 'USER_ID_REQUIRED');
  }

  const planConfig = resolvePlanConfig(plan);
  const safeCustomer = sanitizeCustomer(customer);
  const safeContext = sanitizePlanContext(planConfig, context);
  const callbackUrl = buildCallbackUrl(req, {
    userId: safeUserId,
    planKey: planConfig.key,
  });

  const payload = {
    description: planConfig.description,
    amount: planConfig.amount,
    currency: { iso: planConfig.currencyIso },
    callback_url: callbackUrl,
    customer: safeCustomer,
    metadata: {
      user_id: safeUserId,
      plan: planConfig.key,
      ...(safeContext.classe ? { white_exam_classe: safeContext.classe } : {}),
      ...(safeContext.week_key
        ? { white_exam_week_key: safeContext.week_key }
        : {}),
    },
  };

  const response = await fedapayRequest('/transactions', {
    method: 'POST',
    body: payload,
  });

  const paymentUrl = extractPaymentUrl(response);
  const transactionId = extractTransactionId(response);
  if (!paymentUrl) {
    throw buildError(
      'FedaPay n a pas renvoye d URL de paiement.',
      502,
      'FEDAPAY_PAYMENT_URL_MISSING',
      response,
    );
  }

  if (transactionId) {
    await persistTransactionSnapshot({
      payload: response,
      transactionId,
      userId: safeUserId,
      planKey: planConfig.key,
      customer: safeCustomer,
      amount: planConfig.amount,
      currencyIso: planConfig.currencyIso,
      paymentUrl,
      callbackUrl,
      description: planConfig.description,
      lastEventSource: 'init',
    });
  }

  return {
    paymentUrl,
    transactionId: transactionId || null,
    callbackUrl,
    plan: planConfig.key,
  };
}

export async function verifyPaymentCheckout({
  userId,
  callbackUrl,
  query,
  transactionId,
}) {
  const safeUserId = asString(userId);
  if (!safeUserId) {
    throw buildError('userId requis.', 400, 'USER_ID_REQUIRED');
  }

  const callbackStatus = extractStatusFromCallback({ callbackUrl, query });
  const effectiveTransactionId = extractTransactionIdFromCallback({
    callbackUrl,
    query,
    explicitTransactionId: transactionId,
  });

  if (!effectiveTransactionId) {
    return {
      approved: false,
      transactionId: null,
      status: callbackStatus || null,
      message:
        callbackStatus === 'approved'
          ? 'Transaction FedaPay introuvable dans le callback.'
          : 'Paiement non approuve.',
      subscriptionUpdated: false,
    };
  }

  const existing = await getPaymentByTransactionId(effectiveTransactionId);
  const response = await fedapayRequest(`/transactions/${encodeURIComponent(effectiveTransactionId)}`);
  const payment = await persistTransactionSnapshot({
    payload: response,
    transactionId: effectiveTransactionId,
    userId: safeUserId || existing?.user_id,
    planKey: existing?.plan_key || DEFAULT_PLAN,
    amount: existing?.amount || resolvePlanConfig(DEFAULT_PLAN).amount,
    currencyIso: existing?.currency_iso || env.PAYMENT_CURRENCY_ISO || 'XOF',
    paymentUrl: existing?.payment_url,
    callbackUrl: callbackUrl || existing?.callback_url,
    description: existing?.description || resolvePlanConfig(DEFAULT_PLAN).description,
    lastEventSource: 'verify',
  });

  const status = normalizeStatus(payment?.status || extractStatus(response) || callbackStatus);
  const approved = isSuccessfulStatus(status);
  const effectiveUserId = asString(payment?.user_id || safeUserId || existing?.user_id);
  let subscriptionUpdated = false;
  let activationApplied = false;
  let accessGranted = false;
  const planKey = payment?.plan_key || existing?.plan_key || DEFAULT_PLAN;

  if (approved && effectiveUserId) {
    const activation = await applyApprovedPaymentActivation({
      userId: effectiveUserId,
      payment: {
        ...payment,
        plan_key: planKey,
      },
      payload: response,
    });
    activationApplied = activation.updated;
    subscriptionUpdated =
      activation.activationKind === 'subscription' && activation.updated;
    accessGranted =
      activation.activationKind === 'white_exam_access' && activation.updated;
  }

  return {
    approved,
    transactionId: effectiveTransactionId,
    plan: planKey,
    status: status || callbackStatus || null,
    message: approved
      ? accessGranted
        ? "Paiement confirme et acces examen blanc active."
        : subscriptionUpdated
        ? 'Paiement confirme et abonnement active.'
        : 'Paiement confirme.'
      : 'Paiement non approuve par FedaPay.',
    subscriptionUpdated,
    activationApplied,
    accessGranted,
  };
}

export async function handlePaymentWebhook(body = {}) {
  const transactionId = extractTransactionId(body);
  const initialStatus = extractStatus(body);
  if (!transactionId) {
    return {
      accepted: false,
      transactionId: null,
      status: initialStatus || null,
      subscriptionUpdated: false,
      activationApplied: false,
      accessGranted: false,
    };
  }

  const existing = await getPaymentByTransactionId(transactionId);
  let payload = asObject(body);
  try {
    payload = await fedapayRequest(`/transactions/${encodeURIComponent(transactionId)}`);
  } catch {
    payload = asObject(body);
  }

  const payment = await persistTransactionSnapshot({
    payload,
    transactionId,
    userId: extractUserId(payload, existing?.user_id || extractUserId(body)),
    planKey: existing?.plan_key || extractPlanKey(payload, DEFAULT_PLAN),
    amount: existing?.amount || extractAmount(payload, env.PAYMENT_PREMIUM_AMOUNT),
    currencyIso: existing?.currency_iso || extractCurrencyIso(payload, env.PAYMENT_CURRENCY_ISO || 'XOF'),
    paymentUrl: existing?.payment_url || extractPaymentUrl(payload),
    callbackUrl: existing?.callback_url,
    description: existing?.description || extractDescription(payload, env.PAYMENT_PREMIUM_DESCRIPTION),
    lastEventSource: 'webhook',
  });

  const status = normalizeStatus(payment?.status || extractStatus(payload) || initialStatus);
  const effectiveUserId = asString(payment?.user_id || existing?.user_id);
  if (!isSuccessfulStatus(status) || !effectiveUserId) {
    return {
      accepted: false,
      transactionId,
      status: status || null,
      subscriptionUpdated: false,
      activationApplied: false,
      accessGranted: false,
    };
  }

  const activation = await applyApprovedPaymentActivation({
    userId: effectiveUserId,
    payment,
    payload,
  });

  return {
    accepted: true,
    transactionId,
    status,
    plan: payment?.plan_key || DEFAULT_PLAN,
    subscriptionUpdated:
      activation.activationKind === 'subscription' && activation.updated,
    activationApplied: activation.updated,
    accessGranted:
      activation.activationKind === 'white_exam_access' && activation.updated,
  };
}
