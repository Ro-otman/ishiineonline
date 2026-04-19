import {
  createPaymentCheckout,
  verifyPaymentCheckout as verifyPaymentCheckoutService,
} from '../services/paymentCheckout.service.js';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export async function initPaymentCheckout(req, res, next) {
  try {
    const body = asObject(req.body);
    const checkout = await createPaymentCheckout({
      req,
      userId: req.user?.idUser,
      plan: body.plan,
      customer: asObject(body.customer),
      context: asObject(body.context),
    });

    res.status(201).json({
      ok: true,
      payment_url: checkout.paymentUrl,
      transaction_id: checkout.transactionId,
      callback_url: checkout.callbackUrl,
      plan: checkout.plan,
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyPaymentCheckout(req, res, next) {
  try {
    const body = asObject(req.body);
    const result = await verifyPaymentCheckoutService({
      userId: req.user?.idUser,
      callbackUrl: body.callbackUrl,
      query: asObject(body.query),
      transactionId: body.transactionId,
    });

    res.json({
      ok: true,
      approved: result.approved,
      verified: result.approved,
      transaction_id: result.transactionId,
      plan: result.plan,
      status: result.status,
      subscriptionUpdated: result.subscriptionUpdated,
      activationApplied: result.activationApplied,
      accessGranted: result.accessGranted,
      message: result.message,
    });
  } catch (err) {
    next(err);
  }
}
