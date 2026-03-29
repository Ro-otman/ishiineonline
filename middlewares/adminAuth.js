import { env } from '../config/env.js';

function unauthorized(res) {
  res.set('WWW-Authenticate', 'Basic realm="iShiine Admin"');
  return res.status(401).send('Authentification admin requise.');
}

export function requireAdminDashboardAuth(req, res, next) {
  const expectedUser = String(env.ADMIN_DASHBOARD_USER || '').trim();
  const expectedPassword = String(env.ADMIN_DASHBOARD_PASSWORD || '').trim();

  if (!expectedUser || !expectedPassword) {
    if (env.NODE_ENV !== 'production') return next();
    return res.status(503).send('Configurer ADMIN_DASHBOARD_USER et ADMIN_DASHBOARD_PASSWORD.');
  }

  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Basic ')) return unauthorized(res);

  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return unauthorized(res);
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) return unauthorized(res);

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);

  if (username !== expectedUser || password !== expectedPassword) {
    return unauthorized(res);
  }

  return next();
}
