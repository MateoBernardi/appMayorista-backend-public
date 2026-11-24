import { addSuscripcion, fetchAllSuscripciones, fetchSuscripcionByEmail, fetchSuscripcionById, removeSuscripcion } from "../../domain/services/web/suscripcionesServices";
import { Request, Response, NextFunction } from "express";
import { asAppError, BadRequestError, ConflictError, NotFoundError } from "../../adapters/errors/AppError";

export const createSuscripcion = async (req: Request, res: Response, next: NextFunction) => {
    const { nombre, telefono, email, localidad } = req.body;
    if (!nombre || !telefono || !email || !localidad) {
        return next(new BadRequestError("Faltan datos obligatorios"));
    }
    try {
        const existing = await fetchSuscripcionByEmail(email);
        if (existing) {
            throw new ConflictError("Ya existe una suscripción con este email");
        }
        const newSuscripcion = await addSuscripcion({ nombre, telefono, email, localidad });
        res.status(201).json(newSuscripcion);
    } catch (error) {
        next(asAppError(error, 'No se pudo crear la suscripción'));
    }
};

export const getAllSuscripciones = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const suscripciones = await fetchAllSuscripciones();
        res.status(200).json(suscripciones);
    } catch (error) {
        next(asAppError(error, 'No se pudo obtener suscripciones'));
    }
};

export const getSuscripcionById = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;

    if (!id) {
        return next(new BadRequestError("Suscripción desconocida"));
    }
    try {
        const suscripcion = await fetchSuscripcionById(Number(id));
        if (!suscripcion) {
            throw new NotFoundError("Suscripción no encontrada");
        }
        res.status(200).json(suscripcion);
    } catch (error) {
        next(asAppError(error, 'No se pudo obtener la suscripción'));
    }
};

export const getSuscripcionByEmail = async (req: Request, res: Response, next: NextFunction) => {
    const email = req.params.email as string;

    if (!email) {
        return next(new BadRequestError("Email inválido"));
    }
    try {
        const suscripcion = await fetchSuscripcionByEmail(email);
        if (!suscripcion) {
            throw new NotFoundError("Suscripción no encontrada");
        }
        res.status(200).json(suscripcion);
    } catch (error) {
        next(asAppError(error, 'No se pudo obtener la suscripción'));
    }
};

export const deleteSuscripcion = async (req: Request, res: Response, next: NextFunction) => {
    const { id } = req.params;
    if (!(id)) {
        return next(new BadRequestError("Suscripción desconocida"));
    }
    try {
        const existing = await fetchSuscripcionById(Number(id));
        if (!existing) {
            throw new NotFoundError("Suscripción no encontrada");
        }
        await removeSuscripcion(Number(id));
        res.status(200).json({ message: "Suscripción eliminada correctamente" });
    } catch (error) {
        next(asAppError(error, 'No se pudo eliminar la suscripción'));
    }
};