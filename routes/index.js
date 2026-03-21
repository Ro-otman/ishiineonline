import { Router } from 'express';

import checkoutRouter from './checkout.routes.js';
import healthRouter from './health.routes.js';
import ligueRouter from './ligue.routes.js';
import paymentsRouter from './payments.routes.js';
import versionRouter from './version.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/version', versionRouter);
router.use('/ligue', ligueRouter);
router.use('/payments', paymentsRouter);
router.use('/shiine_checkout', checkoutRouter);

export default router;
