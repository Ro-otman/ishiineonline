import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(value).toLowerCase());
}

export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: toInt(process.env.PORT, 3000),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  APP_VERSION: process.env.APP_VERSION || '0.0.0',
  TRUST_PROXY: toBool(process.env.TRUST_PROXY, false),

  // MySQL
  DB_HOST: process.env.DB_HOST || '',
  DB_PORT: toInt(process.env.DB_PORT, 3306),
  DB_USER: process.env.DB_USER || '',
  DB_PASSWORD: process.env.DB_PASSWORD || '',
  DB_NAME: process.env.DB_NAME || '',
  DB_CONNECTION_LIMIT: toInt(process.env.DB_CONNECTION_LIMIT, 10),
  DB_DEBUG: toBool(process.env.DB_DEBUG, false),

  // SSL
  DB_SSL: toBool(process.env.DB_SSL, false),
  DB_SSL_REJECT_UNAUTHORIZED: toBool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
  DB_SSL_CA_PATH: process.env.DB_SSL_CA_PATH || '',

  // Payments
  FEDAPAY_API_BASE_URL: process.env.FEDAPAY_API_BASE_URL || 'https://api.fedapay.com/v1',
  FEDAPAY_SECRET_KEY: process.env.FEDAPAY_SECRET_KEY || '',
  PAYMENT_CALLBACK_BASE_URL: process.env.PAYMENT_CALLBACK_BASE_URL || '',
  PAYMENT_PREMIUM_AMOUNT: toInt(process.env.PAYMENT_PREMIUM_AMOUNT, 375),
  PAYMENT_PREMIUM_DESCRIPTION:
    process.env.PAYMENT_PREMIUM_DESCRIPTION || 'Abonnement mensuel',
  PAYMENT_CURRENCY_ISO: process.env.PAYMENT_CURRENCY_ISO || 'XOF',
  PAYMENT_DURATION_DAYS: toInt(process.env.PAYMENT_DURATION_DAYS, 30),

  // Admin dashboard
  ADMIN_DASHBOARD_TITLE: process.env.ADMIN_DASHBOARD_TITLE || 'iShiine Admin',
  ADMIN_ACCESS_TOKEN_SECRET:
    process.env.ADMIN_ACCESS_TOKEN_SECRET ||
    (process.env.NODE_ENV === 'production' ? '' : 'dev-admin-access-secret-change-me'),
  ADMIN_ACCESS_TOKEN_TTL_MINUTES: toInt(process.env.ADMIN_ACCESS_TOKEN_TTL_MINUTES, 15),
  ADMIN_REFRESH_TOKEN_TTL_DAYS: toInt(process.env.ADMIN_REFRESH_TOKEN_TTL_DAYS, 30),
  ADMIN_COOKIE_SECURE: toBool(process.env.ADMIN_COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  ADMIN_COOKIE_DOMAIN: process.env.ADMIN_COOKIE_DOMAIN || '',
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Africa/Porto-Novo',

  // Firebase push
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || '',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || '',
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY || '',
  FIREBASE_SERVICE_ACCOUNT_JSON: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  FIREBASE_SERVICE_ACCOUNT_BASE64: process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 || '',
  FIREBASE_SERVICE_ACCOUNT_PATH: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',

  // Notification jobs
  NOTIFICATION_JOBS_ENABLED: toBool(
    process.env.NOTIFICATION_JOBS_ENABLED,
    process.env.NODE_ENV === 'production',
  ),
  NOTIFICATION_JOBS_INTERVAL_SECONDS: toInt(process.env.NOTIFICATION_JOBS_INTERVAL_SECONDS, 60),
  SUBSCRIPTION_EXPIRY_REMINDER_HOURS: toInt(process.env.SUBSCRIPTION_EXPIRY_REMINDER_HOURS, 24),
  SUBSCRIPTION_EXPIRED_LOOKBACK_HOURS: toInt(process.env.SUBSCRIPTION_EXPIRED_LOOKBACK_HOURS, 48),
};
