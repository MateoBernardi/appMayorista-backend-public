import { Router } from 'express';
import { clientesVisitadosHoyController, getClientes, getZonasDisponiblesController } from '../controllers/clientesControllers';
import { createCliente, updateCliente, deleteCliente, importClientesController, searchClientesController } from '../controllers/clientesControllers';
import { idempotency } from '../adapters/middlewares/idempotency';

const clientesRouter = Router();

// POST route (debe ir antes de GET /:zonaId para evitar conflictos)
clientesRouter.post('/', idempotency, createCliente);
clientesRouter.post('/import', importClientesController);

// GET routes (rutas específicas antes que rutas genéricas)
clientesRouter.get('/', searchClientesController);
clientesRouter.get('/zonas/disponibles', getZonasDisponiblesController);
clientesRouter.get('/visitadosHoy/:zona', clientesVisitadosHoyController);
clientesRouter.get('/:zona', getClientes);

// PATCH route
clientesRouter.patch('/:id', updateCliente);

// DELETE route
clientesRouter.delete('/:id', deleteCliente);

export default clientesRouter;
