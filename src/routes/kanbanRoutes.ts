import { Router } from 'express';
import * as kanbanController from '../controllers/kanbanControllers';
import { idempotency } from '../adapters/middlewares/idempotency';


const router = Router();

router.get('/', kanbanController.getObjetivos);
router.post('/', idempotency, kanbanController.createObjetivo);
router.put('/:id', kanbanController.updateObjetivo);
router.patch('/:id', kanbanController.editObjetivo);
router.patch('/:id/archivos', kanbanController.archivoObjetivo);
router.patch('/:id/invitados', kanbanController.invitadosObjetivo);
router.delete('/:id', kanbanController.deleteObjetivo);
router.post('/:id/visto', kanbanController.marcarObjetivoVisto);

export default router;
