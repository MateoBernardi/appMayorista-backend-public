import { Request, Response, NextFunction } from 'express';
import { asAppError, BadRequestError, NotFoundError } from '../adapters/errors/AppError';
import { requireUserContextId } from '../utils/requestGuards';
import * as kanbanService from '../domain/services/kanbanServices';
import { sendNotificationToMultipleUsers } from '../domain/services/devicesService';
import { InvitadoDTO } from '../domain/dto/ObjetivoDTO';

export const getObjetivos = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userContextId = requireUserContextId(req);
        const objetivos = await kanbanService.getAllObjetivos(userContextId);
        res.json(objetivos);
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const createObjetivo = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { titulo, descripcion, estado, archivosIds } = req.body;
        const userContextId = requireUserContextId(req);

        const invitados: InvitadoDTO[] = req.body.invitados ?? [];

        invitados.push({ user_id: userContextId, rol: 'ASSIGNEE' });

        const nuevoObjetivo = await kanbanService.createObjetivo(
            { titulo, descripcion, estado, invitados, archivosIds },
            userContextId
        );

        res.status(201).json(nuevoObjetivo);

        const destinatarios = invitados
            .map((invitado) => invitado.user_id)
            .filter((userId) => userId !== userContextId);

        if (destinatarios.length > 0) {
            sendNotificationToMultipleUsers(destinatarios, {
                title: 'Nuevo Objetivo',
                body: `Se creó el objetivo "${nuevoObjetivo.titulo}".`,
                link: 'https://interno.italoarg.com.ar/kanban?id=' + nuevoObjetivo.id,
                data: {
                    type: 'objetivo_creado',
                    objetivo_id: nuevoObjetivo.id,
                    domain: 'kanban',
                    event: 'created',
                    updated_at: new Date().toISOString(),
                    entity_id: String(nuevoObjetivo.id),
                },
            }).catch((err) => console.error('Error enviando notificacion de nuevo objetivo:', err));
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const updateObjetivo = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { titulo, descripcion, estado, rank_position, observacion } = req.body;
        const userContextId = requireUserContextId(req);

        const objetivoAntes = await kanbanService.getObjetivoByIdService(Number(id));
        const cambiaEstado = !!estado && !!objetivoAntes && estado !== objetivoAntes.estado;

        const updated = await kanbanService.updateObjetivo(
            Number(id),
            { titulo, descripcion, estado, rank_position, observacion },
            userContextId
        );

        if (!updated) {
            throw new NotFoundError('Objetivo no encontrado.');
        }

        res.json(updated);

        if (cambiaEstado) {
            kanbanService.getInvitadosByObjetivoId(Number(id))
                .then((invitados) => {
                    const destinatarios = invitados
                        .map((invitado) => invitado.user_id)
                        .filter((userId) => userId !== userContextId);

                    if (destinatarios.length === 0) {
                        return;
                    }

                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: 'Cambio de estado',
                        body: `"${updated.titulo}" cambió a "${estado}".`,
                        link: 'https://interno.italoarg.com.ar/kanban?id=' + id,
                        data: {
                            type: 'objetivo_estado_cambiado',
                            objetivo_id: Number(id),
                            nuevo_estado: estado,
                            domain: 'kanban',
                            event: 'status_changed',
                            updated_at: new Date().toISOString(),
                            entity_id: String(id),
                        },
                    });
                })
                .catch((err) => console.error('Error enviando notificacion de cambio de estado:', err));
        } else if (observacion) {
            // Comentario sin cambio de estado: no entra en el branch de arriba,
            // pero también es una acción sobre el objetivo que merece notificación.
            kanbanService.getInvitadosByObjetivoId(Number(id))
                .then((invitados) => {
                    const destinatarios = invitados
                        .map((invitado) => invitado.user_id)
                        .filter((userId) => userId !== userContextId);

                    if (destinatarios.length === 0) {
                        return;
                    }

                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: 'Nuevo comentario',
                        body: `Nuevo comentario en "${updated.titulo}".`,
                        link: 'https://interno.italoarg.com.ar/kanban?id=' + id,
                        data: {
                            type: 'objetivo_comentario',
                            objetivo_id: Number(id),
                            domain: 'kanban',
                            event: 'comment_added',
                            updated_at: new Date().toISOString(),
                            entity_id: String(id),
                        },
                    });
                })
                .catch((err) => console.error('Error enviando notificacion de comentario:', err));
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const editObjetivo = async (req: any, res: Response, next: NextFunction) => {
    try {
        const field = req.query.field as 'titulo' | 'descripcion';
        const { id } = req.params;
        const data = req.body[field];
        const userContextId = requireUserContextId(req);

        const updated = await kanbanService.editObjetivoService(
            Number(id),
            field,
            data,
            Number(userContextId)
        );

        if (!updated) {
            throw new NotFoundError('Objetivo no encontrado.');
        }

        res.json(updated);

        kanbanService.getInvitadosByObjetivoId(Number(id))
            .then((invitados) => {
                const destinatarios = invitados
                    .map((invitado) => invitado.user_id)
                    .filter((userId) => userId !== userContextId);

                if (destinatarios.length === 0) {
                    return;
                }

                return sendNotificationToMultipleUsers(destinatarios, {
                    title: 'Objetivo actualizado',
                    body: `Se actualizó "${updated.titulo}".`,
                    link: 'https://interno.italoarg.com.ar/kanban?id=' + id,
                    data: {
                        type: 'objetivo_editado',
                        objetivo_id: Number(id),
                        campo: field,
                        domain: 'kanban',
                        event: 'updated',
                        updated_at: new Date().toISOString(),
                        entity_id: String(id),
                    },
                });
            })
            .catch((err) => console.error('Error enviando notificacion de edicion:', err));
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const archivoObjetivo = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const archivosIds: number[] = req.body['archivosIds'];
        const userContextId = requireUserContextId(req);
        const action = req.query.action as 'add' | 'remove';

        if (!Array.isArray(archivosIds) || archivosIds.length === 0) {
            throw new BadRequestError('archivosIds debe ser un array no vacío.');
        }

        const updated = await kanbanService.handleArchivosObjetivo(Number(id), archivosIds, action);
        res.json(updated);

        if (action === 'add' && updated) {
            kanbanService.getInvitadosByObjetivoId(Number(id))
                .then((invitados) => {
                    const destinatarios = invitados
                        .map((invitado) => invitado.user_id)
                        .filter((userId) => userId !== userContextId);

                    if (destinatarios.length === 0) {
                        return;
                    }

                    return sendNotificationToMultipleUsers(destinatarios, {
                        title: 'Nuevo archivo',
                        body: `Se agregó un archivo a "${updated.titulo}".`,
                        link: 'https://interno.italoarg.com.ar/kanban?id=' + id,
                        data: {
                            type: 'objetivo_archivo_agregado',
                            objetivo_id: Number(id),
                            domain: 'kanban',
                            event: 'archivo_added',
                            updated_at: new Date().toISOString(),
                            entity_id: String(id),
                        },
                    });
                })
                .catch((err) => console.error('Error enviando notificacion de archivo agregado:', err));
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const invitadosObjetivo = async (req: any, res: Response, next: NextFunction) => {
    try {
        const action = req.query.action as 'add' | 'remove';
        const { id } = req.params;
        const invitados = req.body['invitados'];
        const userContextId = requireUserContextId(req);

        if (!Array.isArray(invitados) || invitados.length === 0) {
            throw new BadRequestError('invitados debe ser un array no vacío.');
        }

        const actuales = action === 'add' ? await kanbanService.getInvitadosByObjetivoId(Number(id)) : [];
        const actualesMap = new Map(actuales.map((invitado) => [invitado.user_id, invitado.rol]));

        const updated = await kanbanService.handleInvitadosObjetivo(
            userContextId,
            Number(id),
            invitados,
            action
        );

        res.json(updated);

        if (action === 'add' && updated) {
            const invitadosTyped = invitados as InvitadoDTO[];

            // Un usuario recién asignado sólo recibe la notificación de asignación,
            // no también la genérica de "te agregaron".
            const nuevosAsignados = invitadosTyped
                .filter((invitado) => invitado.rol === 'ASSIGNEE' && actualesMap.get(invitado.user_id) !== 'ASSIGNEE')
                .map((invitado) => invitado.user_id)
                .filter((userId) => userId !== userContextId);

            const nuevosInvitados = invitadosTyped
                .filter((invitado) => invitado.rol !== 'ASSIGNEE' && !actualesMap.has(invitado.user_id))
                .map((invitado) => invitado.user_id)
                .filter((userId) => userId !== userContextId);

            if (nuevosAsignados.length > 0) {
                sendNotificationToMultipleUsers(nuevosAsignados, {
                    title: 'Nueva asignación',
                    body: `Te asignaron a "${updated.titulo}".`,
                    link: 'https://interno.italoarg.com.ar/kanban?id=' + id,
                    data: {
                        type: 'objetivo_asignado',
                        objetivo_id: Number(id),
                        domain: 'kanban',
                        event: 'assigned',
                        updated_at: new Date().toISOString(),
                        entity_id: String(id),
                    },
                }).catch((err) => console.error('Error enviando notificacion de asignacion:', err));
            }

            if (nuevosInvitados.length > 0) {
                sendNotificationToMultipleUsers(nuevosInvitados, {
                    title: 'Te agregaron a un objetivo',
                    body: `Te agregaron a "${updated.titulo}".`,
                    link: 'https://interno.italoarg.com.ar/kanban?id=' + id,
                    data: {
                        type: 'objetivo_invitado_agregado',
                        objetivo_id: Number(id),
                        domain: 'kanban',
                        event: 'invitado_added',
                        updated_at: new Date().toISOString(),
                        entity_id: String(id),
                    },
                }).catch((err) => console.error('Error enviando notificacion de invitado agregado:', err));
            }
        }
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const deleteObjetivo = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userContextId = requireUserContextId(req);

        await kanbanService.deleteObjetivo(Number(id), userContextId);
        res.status(204).send();
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};

export const marcarObjetivoVisto = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const userContextId = requireUserContextId(req);

        await kanbanService.markObjetivoAsSeen(Number(id), userContextId);
        res.status(200).json({ success: true });
    } catch (error: any) {
        next(asAppError(error, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
    }
};
