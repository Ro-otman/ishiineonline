import { Router } from 'express';

import {
  initPaymentCheckout,
  verifyPaymentCheckout,
} from '../controllers/paymentCheckout.controller.js';

const router = Router();

router.post('/checkout/init', initPaymentCheckout);
router.post('/checkout/verify', verifyPaymentCheckout);

export default router;
