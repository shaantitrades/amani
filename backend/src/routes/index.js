import { Router } from 'express';
import healthRoutes from './health.js';
import metaRoutes from './meta.js';
import authRoutes from './auth.js';
import userRoutes from './users.js';
import adRoutes from './ads.js';
import mediaRoutes from './media.js';
import groupRoutes from './groups.js';
import blockRoutes from './blocks.js';
import reportRoutes from './reports.js';
import messageRoutes from './messages.js';
import searchRoutes from './search.js';
import adminRoutes from './admin.js';

/**
 * Routes de l'API Bodogui (prefixe /api/v1).
 * Ordre important : les routes specifiques (ex: /media/mine) avant les generiques.
 */
const router = Router();

router.use(healthRoutes);
router.use(metaRoutes);
router.use('/auth', authRoutes);
router.use(userRoutes);
router.use(adRoutes);
router.use(groupRoutes);
router.use(blockRoutes);
router.use(reportRoutes);
router.use(messageRoutes);
router.use(searchRoutes);
router.use('/admin', adminRoutes);
router.use(mediaRoutes);

export default router;
