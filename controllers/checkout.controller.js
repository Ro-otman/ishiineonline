import { handlePaymentWebhook } from '../services/paymentCheckout.service.js';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderCheckoutCallback(req, res) {
  const status = escapeHtml(req.query?.status ?? 'ok');
  const message = escapeHtml(req.query?.message ?? 'Paiement traite.');

  res.status(200);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Shiine Checkout</title>
    <style>
      body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#0b1220;color:#e8eefc;margin:0;padding:24px}
      .card{max-width:520px;margin:0 auto;background:#101a33;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:20px}
      .badge{display:inline-block;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.2px}
      .ok{background:rgba(43,175,97,.18);color:#7CFFB1;border:1px solid rgba(43,175,97,.35)}
      .ko{background:rgba(255,76,76,.18);color:#FFC0C0;border:1px solid rgba(255,76,76,.35)}
      h1{font-size:18px;margin:12px 0 8px}
      p{opacity:.9;line-height:1.45;margin:0}
      .hint{margin-top:14px;opacity:.75;font-size:12px}
    </style>
  </head>
  <body>
    <div class="card">
      <span class="badge ${status === 'ok' || status === 'success' || status === 'approved' ? 'ok' : 'ko'}">${status}</span>
      <h1>${message}</h1>
      <p>Tu peux retourner dans l application.</p>
      <p class="hint">(Cette page sert de callback: /shiine_checkout)</p>
    </div>
  </body>
</html>`);
}

export async function receiveCheckoutWebhook(req, res, next) {
  try {
    const result = await handlePaymentWebhook(req.body || {});
    res.status(200).json({
      ok: true,
      accepted: result.accepted,
      transaction_id: result.transactionId,
      status: result.status,
      subscriptionUpdated: result.subscriptionUpdated || false,
    });
  } catch (err) {
    next(err);
  }
}
