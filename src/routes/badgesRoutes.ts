import { Router } from 'express';
import { getPrefetchBadges } from '../controllers/badgesController';

const router = Router();

router.get('/prefetch', getPrefetchBadges);

export default router;
