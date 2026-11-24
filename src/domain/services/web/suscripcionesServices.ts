import { createSuscripcion, getAllSuscripciones, getSuscripcionById, getSuscripcionByEmail, deleteSuscripcion } from "../../../adapters/db/web/suscripcionesRepo";
import { SuscripcionValidationService } from "../../validations/web/suscripcionesValidations";
import { SuscripcionDTO } from "../../dto/SuscripcionDTO";

export const addSuscripcion = async (suscripcionData: SuscripcionDTO) => {
    // Validar datos
    const validation = SuscripcionValidationService.validate(suscripcionData);
    if (!validation.isValid) {
        throw { validationErrors: validation.errors };
    }

    // Sanitizar datos
    const sanitizedData = SuscripcionValidationService.sanitize(suscripcionData);

    return await createSuscripcion(sanitizedData);
}

export const fetchAllSuscripciones = async () => {
    return await getAllSuscripciones();
}

export const fetchSuscripcionById = async (id: number) => {
    return await getSuscripcionById(id);
}

export const fetchSuscripcionByEmail = async (email: string) => {
    return await getSuscripcionByEmail(email);
}

export const removeSuscripcion = async (id: number) => {
    return await deleteSuscripcion(id);
}
