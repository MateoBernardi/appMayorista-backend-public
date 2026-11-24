import { Router } from 'express';
import { 
    requestVerificationTokenController,
    verifyAndAssociateController,
} from '../controllers/asociacionControllers';
import { associationRequestLimiter } from '../adapters/middlewares/rateLimiter';

const associationRouter = Router();

/**
 * POST /asociar
 * PASO 1: Manda un código al email registrado de cada cuenta del CUIT
 * Requiere: accessToken con rol readonly
 * Header: x-app-entorno (obligatorio)
 * Body: { cuit: string }
 */
associationRouter.post('/', associationRequestLimiter, requestVerificationTokenController);

/**
 * POST /asociar/verify
 * PASO 2: Valida el código y asocia la cuenta a la que se envió
 * Requiere: accessToken con rol readonly
 * Header: x-app-entorno (obligatorio)
 * Body: { token: string }
 */
associationRouter.post('/verify', verifyAndAssociateController);

export default associationRouter;
