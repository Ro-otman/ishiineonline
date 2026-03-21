import { Router } from 'express';

import {
  receiveCheckoutWebhook,
  renderCheckoutCallback,
} from '../controllers/checkout.controller.js';

const router = Router();

router.get('/', renderCheckoutCallback);
router.post('/', receiveCheckoutWebhook);

export default router;
