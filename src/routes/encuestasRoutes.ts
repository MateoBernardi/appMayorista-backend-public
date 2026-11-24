import { Router } from 'express';
import {
    getEncuestasPorCategoriaController,
    crearEncuestaCompletaController,
    crearRespuestasController,
    getEncuestaConRespuestasController,
    eliminarEncuestaController,
    participantesEncuestaController,
    crearConvocatoriasController,
    eliminarOpcionController
} from '../controllers/encuestasControllers';
import { auth } from '../adapters/auth/authPermisos';
import { idempotency } from '../adapters/middlewares/idempotency';
import { adminRoles, allRoles } from '../types/roles';

const encuestasRouter = Router();

/**
 * GET /encuestas/categoria/:categoria
 * Obtener encuestas por categoría (interna, externa, feedback_empleado)
 * Requiere autenticación básica
 */
encuestasRouter.get(
    '/categoria/:categoria',
    auth(allRoles),
    getEncuestasPorCategoriaController
);

/**
 * POST /encuestas/completa
 * Crear una encuesta completa con sus preguntas
 * Solo admin y gerencia pueden crear encuestas
 */
encuestasRouter.post(
    '/completa',
    auth(adminRoles),
    idempotency,
    crearEncuestaCompletaController
);

/**
 * GET /encuestas/:id/respuestas
 * Obtener una encuesta con todas sus respuestas
 * Requiere permisos de visualización
 */
encuestasRouter.get(
    '/respuestas',
    auth(adminRoles),
    getEncuestaConRespuestasController
);

/**
 * POST /encuestas/respuestas/multiple
 * Crear múltiples respuestas (completar encuesta completa)
 * Requiere autenticación básica (cualquier usuario autenticado)
 */
encuestasRouter.post(
    '/respuestas',
    auth(allRoles),
    idempotency,
    crearRespuestasController
);

/**
 * POST /encuestas/:id/convocatorias
 * Registrar convocatorias de una encuesta
 */
encuestasRouter.post(
    '/:id/convocatorias',
    auth(adminRoles),
    crearConvocatoriasController
);

/**
 * PATCH /encuestas/:id/participantes?action=add|remove
 * Agregar o quitar participantes de una encuesta
 */
encuestasRouter.patch(
    '/:id/participantes',
    auth(adminRoles),
    participantesEncuestaController
);

/**
 * DELETE /encuestas/opciones/:opcionId
 * Eliminar una opción de una pregunta
 * Solo el creador de la encuesta, y solo si nadie eligió esa opción
 */
encuestasRouter.delete(
    '/opciones/:opcionId',
    auth(adminRoles),
    eliminarOpcionController
);

/**
 * DELETE /encuestas/:id
 * Eliminar encuesta (soft delete)
 * Solo admin y gerencia pueden eliminar encuestas
 */
encuestasRouter.delete(
    '/:id',
    auth(adminRoles),
    eliminarEncuestaController
);

export default encuestasRouter;
