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
  DB_SSL_CA_PATH: process.env.DB_SSL_CA_PATH || ''
};
