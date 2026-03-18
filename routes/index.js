import { Router } from 'express';

import healthRouter from './health.routes.js';
import versionRouter from './version.routes.js';
import ligueRouter from './ligue.routes.js';
import checkoutRouter from './checkout.routes.js';

const router = Router();

router.use('/health', healthRouter);
router.use('/version', versionRouter);
router.use('/ligue', ligueRouter);
router.use('/shiine_checkout', checkoutRouter);

export default router;
