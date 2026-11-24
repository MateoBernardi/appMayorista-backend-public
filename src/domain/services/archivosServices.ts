import {
    getArchivos,
    createArchivo,
    updateArchivo,
    deleteArchivo,
    getArchivoAclData,
    getArchivoById,
    searchArchivosByPersona,
    getArchivosPersonales,
    getArchivoByNombre,
    getArchivoByIdAsociado,
    isArchivoOwner,
    moveArchivoToCarpeta,
    patchArchivoPermisos,
    syncArchivoAcl,
    markFileAsRead,
    getArchivoViewersByArchivoId,
    getArchivosUnseenByUser,
} from '../../adapters/db/archivosRepo';
import { uploadFiles, downloadFile, generateSignedUrl, generatePublicUrl } from '../../adapters/archivos/archivosApi';
import { ArchivoDTO, CrearArchivoDTO, UpdateArchivoDTO } from '../dto/ArchivoDTO';
import { getCarpetaPermisos, getUserDisplayNamesByIds, splitPermisosByCarpetaAccess, validateUserCanAccessCarpeta } from './carpetasServices';
import { getUserIdsByRoles } from './usuariosServices';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../adapters/errors/AppError';

export interface PermisosArchivoParciales {
    invalid_roles: string[];
    invalid_users: string[];
    invalid_user_ids?: number[];
    reason: string;
}

export interface AddArchivoResult {
    archivo: ArchivoDTO;
    warnings?: PermisosArchivoParciales;
    // Permisos realmente persistidos: iguales a los pedidos por el cliente,
    // salvo que el archivo se haya creado dentro de una carpeta, en cuyo caso
    // se sobrescriben con los permisos de esa carpeta (ver `addArchivo`). El
    // controller necesita este valor resuelto (no el del request) para saber
    // a quién notificar.
    resolvedPermisos: { allowed_roles: string[]; usuarios_compartidos: number[] };
}

export interface MoveArchivoResult {
    archivo: ArchivoDTO;
    warnings?: PermisosArchivoParciales;
}

export interface UpdateArchivoResult {
    archivo: ArchivoDTO;
    warnings?: PermisosArchivoParciales;
}

export interface ArchivoPermisosResponse {
    resource_type: 'archivo';
    resource_id: number;
    nombre: string;
    owner_id: number;
    allowed_roles: string[];
    allowed_users: string[];
    user_context_ids?: number[];
}

export interface PatchArchivoPermisosInput {
    allowed_roles?: string[];
    ids?: number[];
}

export interface ArchivoViewerResponse {
    user_context_id: number;
    nombre: string;
    apellido: string;
    visto_en: Date;
}

// Mapeo de tipos guardados en BD a MIME types
const tipoToMimeType: Record<string, string> = {
    'pdf': 'application/pdf',
    'excel': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'word': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'imagen': 'image/jpeg',
    'texto': 'text/plain',
    'csv': 'text/csv',
};

function getMimeType(tipo: string | null | undefined): string | undefined {
    if (!tipo) return undefined;

    // Si ya es un MIME type válido (contiene /), devolverlo tal cual
    if (tipo.includes('/')) return tipo;

    // Si es un tipo corto de BD, mapearlo
    const mimeType = tipoToMimeType[tipo.toLowerCase()];
    if (mimeType) return mimeType;

    // Por defecto, no especificar content type
    return undefined;
}

export const fetchArchivos = async (userRole: string, userContextId: number): Promise<ArchivoDTO[]> => {
    const archivos = await getArchivos(userRole, userContextId);
    return archivos;
};

export const fetchArchivosUnseenByUserService = async (userContextId: number, role: string): Promise<number> => {
    const result = await getArchivosUnseenByUser(userContextId, role);
    return result;
};

export const fetchArchivosPersonales = async (userContextId: number): Promise<ArchivoDTO[]> => {
    const archivos = await getArchivosPersonales(userContextId);
    return archivos;
};

export const searchArchivosByPersonaService = async (searchTerm: string, userRol: string, userContextId: number): Promise<ArchivoDTO[]> => {
    const archivos = await searchArchivosByPersona(searchTerm, userRol, userContextId);
    return archivos;
};

export const addArchivo = async (
    archivoData: CrearArchivoDTO,
    userRole: string,
    fileBuffer?: Buffer
): Promise<AddArchivoResult> => {
    const sanitizedData: CrearArchivoDTO = {
        ...archivoData,
        allowed_roles: archivoData.allowed_roles ?? [],
        usuarios_compartidos: archivoData.usuarios_compartidos ?? [],
    };

    if (archivoData.id_carpeta) {
        const canCreatorAccessDestination = await validateUserCanAccessCarpeta(
            archivoData.id_carpeta,
            archivoData.created_by,
            userRole,
        );

        if (!canCreatorAccessDestination) {
            throw new ForbiddenError('No tenés permisos sobre la carpeta destino para crear este archivo.');
        }

        const permisosCarpeta = await getCarpetaPermisos(archivoData.id_carpeta);

        sanitizedData.allowed_roles = permisosCarpeta.allowed_roles;
        sanitizedData.usuarios_compartidos = (permisosCarpeta.user_context_ids ?? []).map(Number);
    }

    // Subir archivo a R2
    if (fileBuffer) {
        await uploadFiles(
            sanitizedData.ruta_r2,
            fileBuffer,
            sanitizedData.tipo
        );
    }

    // Crear entrada en BD
    const archivo = await createArchivo(sanitizedData);

    return {
        archivo,
        resolvedPermisos: {
            allowed_roles: sanitizedData.allowed_roles ?? [],
            usuarios_compartidos: sanitizedData.usuarios_compartidos ?? [],
        },
    };
};

export const modifyArchivo = async (
    userContextId: number,
    id: number,
    archivoData: UpdateArchivoDTO,
    userRole: string,
): Promise<UpdateArchivoResult> => {
    const archivoActual = await getArchivoById(id);
    if (!archivoActual) {
        throw new NotFoundError('Archivo no encontrado.');
    }

    const shouldValidatePermisos =
        archivoActual.id_carpeta !== null
        && archivoActual.id_carpeta !== undefined
        && (archivoData.allowed_roles !== undefined || archivoData.usuarios_compartidos !== undefined);

    let invalidRoles: string[] = [];
    let invalidUsers: number[] = [];
    const payload: UpdateArchivoDTO = { ...archivoData };

    if (shouldValidatePermisos) {
        const carpetaId = Number(archivoActual.id_carpeta);
        const canAccessCarpeta = await validateUserCanAccessCarpeta(carpetaId, userContextId, userRole);
        if (!canAccessCarpeta) {
            throw new ForbiddenError('No tenés permisos sobre la carpeta del archivo para actualizar sus permisos.');
        }

        const split = await splitPermisosByCarpetaAccess(
            carpetaId,
            archivoData.allowed_roles ?? [],
            archivoData.usuarios_compartidos ?? [],
        );

        if (archivoData.allowed_roles !== undefined) {
            payload.allowed_roles = split.valid_roles;
        }

        if (archivoData.usuarios_compartidos !== undefined) {
            payload.usuarios_compartidos = split.valid_users;
        }

        invalidRoles = split.invalid_roles;
        invalidUsers = split.invalid_users;
    }

    const archivo = await updateArchivo(userContextId, id, payload);

    if (!invalidRoles.length && !invalidUsers.length) {
        return { archivo };
    }

    const invalidUserNames = await getUserDisplayNamesByIds(invalidUsers);

    return {
        archivo,
        warnings: {
            invalid_roles: invalidRoles,
            invalid_users: invalidUserNames,
            invalid_user_ids: invalidUsers,
            reason: 'Hay permisos asignados que no tienen acceso a la carpeta del archivo, se actualizará el archivo pero se ignorarán esos permisos.',
        },
    };
};

export const removeArchivo = async (id: number, userContextId: number): Promise<{ id: number }> => {
    const result = await deleteArchivo(id, userContextId);
    return result;
};

export const getArchivoUrl = async (id: number, expiresIn: number = 3600) => {
    try {
        // Obtener información del archivo desde BD
        const archivo = await getArchivoById(id);

        if (!archivo) {
            throw new NotFoundError('Archivo no encontrado');
        }

        // Convertir el tipo a MIME type
        const mimeType = getMimeType(archivo.tipo);

        const url = await generateSignedUrl(
            archivo.ruta_r2,
            expiresIn,
            archivo.nombre,
            mimeType
        );

        return {
            archivo,
            url,
        };
    } catch (error) {
        throw error;
    }
};

export const searchArchivoByNombre = async (nombre: string, userRol: string, userContextId: number): Promise<ArchivoDTO[]> => {
    const archivos = await getArchivoByNombre(nombre, userContextId, userRol);
    return archivos;
};

export const fetchArchivosByIdAsociado = async (idUsuarioAsociado: number, userRol: string, userContextId: number): Promise<ArchivoDTO[]> => {
    const archivos = await getArchivoByIdAsociado(idUsuarioAsociado, userContextId, userRol);
    return archivos;
};


export const moveArchivo = async (
    id: number,
    idCarpetaDestino: number | null,
    userContextId: number,
    userRole: string,
): Promise<MoveArchivoResult> => {
    const isPrivileged = userRole === 'admin' || userRole === 'gerencia';
    const owner = await isArchivoOwner(id, userContextId);

    if (!isPrivileged && !owner) {
        throw new ForbiddenError('No tenés permisos para mover este archivo.');
    }

    const acl = await getArchivoAclData(id);
    if (!acl) {
        throw new NotFoundError('Archivo no encontrado.');
    }

    let invalidRoles: string[] = [];
    let invalidUsers: number[] = [];
    let validRoles = acl.allowed_roles ?? [];
    let validUsers = acl.allowed_users ?? [];

    if (idCarpetaDestino !== null) {
        const canAccessDestination = await validateUserCanAccessCarpeta(idCarpetaDestino, userContextId, userRole);
        if (!canAccessDestination) {
            throw new ForbiddenError('No tenés permisos sobre la carpeta destino.');
        }

        if (acl.owner_id !== userContextId) {
            const ownerSplit = await splitPermisosByCarpetaAccess(idCarpetaDestino, [], [acl.owner_id]);
            if (ownerSplit.invalid_users.includes(acl.owner_id)) {
                throw new ForbiddenError('El creador del archivo no tiene acceso a la carpeta destino.');
            }
        }

        const split = await splitPermisosByCarpetaAccess(idCarpetaDestino, validRoles, validUsers);
        validRoles = split.valid_roles;
        validUsers = split.valid_users;
        invalidRoles = split.invalid_roles;
        invalidUsers = split.invalid_users;
    }

    const moved = await moveArchivoToCarpeta(id, idCarpetaDestino);
    if (!moved) {
        throw new NotFoundError('Archivo no encontrado.');
    }

    if (idCarpetaDestino !== null && (invalidRoles.length > 0 || invalidUsers.length > 0)) {
        await syncArchivoAcl(id, validRoles, validUsers);
    }

    if (!invalidRoles.length && !invalidUsers.length) {
        return { archivo: moved };
    }

    const invalidUserNames = await getUserDisplayNamesByIds(invalidUsers);

    return {
        archivo: moved,
        warnings: {
            invalid_roles: invalidRoles,
            invalid_users: invalidUserNames,
            invalid_user_ids: invalidUsers,
            reason: 'Hay permisos asignados que no tienen acceso a la carpeta destino, se creará el archivo pero se ignorarán esos permisos. Podés editar la carpeta luego para corregir los permisos.',
        },
    };
};

export const patchPermisosArchivo = async (
    id: number,
    data: PatchArchivoPermisosInput,
    userContextId: number,
): Promise<ArchivoPermisosResponse> => {
    const acl = await getArchivoAclData(id);
    if (!acl) {
        throw new NotFoundError('Archivo no encontrado.');
    }

    if (acl.owner_id !== userContextId) {
        throw new ForbiddenError('Sólo el creador puede modificar los permisos de este archivo.');
    }

    const rolesToRemove = [...new Set((data.allowed_roles ?? []).map((role) => String(role).trim()).filter(Boolean))];
    const userIdsToRemove = [...new Set((data.ids ?? []).filter((userId) => Number.isInteger(userId) && userId > 0))];

    if (!rolesToRemove.length && !userIdsToRemove.length) {
        throw new BadRequestError('Debés enviar al menos un rol o usuario para remover permisos.');
    }

    await patchArchivoPermisos(id, rolesToRemove, userIdsToRemove);

    const updatedAcl = await getArchivoAclData(id);
    if (!updatedAcl) {
        throw new NotFoundError('Archivo no encontrado.');
    }

    const archivo = await getArchivoById(updatedAcl.id);

    return {
        resource_type: 'archivo',
        resource_id: updatedAcl.id,
        nombre: archivo?.nombre ?? '',
        owner_id: updatedAcl.owner_id,
        allowed_roles: updatedAcl.allowed_roles ?? [],
        allowed_users: updatedAcl.allowed_user_names ?? [],
        user_context_ids: updatedAcl.allowed_users ?? [],
    };
};

export const getArchivoPermisos = async (id: number, userContextId: number): Promise<ArchivoPermisosResponse> => {
    const acl = await getArchivoAclData(id);
    if (!acl) {
        throw new NotFoundError('Archivo no encontrado.');
    }

    if (acl.owner_id !== userContextId) {
        throw new ForbiddenError('Sólo el creador puede ver los permisos de este archivo.');
    }

    const archivo = await getArchivoById(acl.id);

    return {
        resource_type: 'archivo',
        resource_id: acl.id,
        nombre: archivo?.nombre ?? '',
        owner_id: acl.owner_id,
        allowed_roles: acl.allowed_roles ?? [],
        allowed_users: acl.allowed_user_names ?? [],
        user_context_ids: acl.allowed_users ?? [],
    };
};

export const resolveArchivoNotificationRecipients = async (
    id: number,
    excludeUserContextId?: number,
): Promise<number[]> => {
    const acl = await getArchivoAclData(id);
    if (!acl) {
        return [];
    }

    const byRoles = (acl.allowed_roles ?? []).length
        ? await getUserIdsByRoles(acl.allowed_roles ?? [])
        : [];

    const byUsers = acl.allowed_users ?? [];
    const merged = [...new Set([...byRoles, ...byUsers])];

    if (!excludeUserContextId) {
        return merged;
    }

    return merged.filter((userId) => userId !== excludeUserContextId);
};

export const resolveArchivoRecipientsToNotify = async (
    allowedRoles: string[],
    usuariosCompartidos: number[],
    warnings: number[],
    id: number,
    isUpdate: boolean
): Promise<number[]> => {
    const idsPorRoles = allowedRoles.length ? await getUserIdsByRoles(allowedRoles) : [];
    const usuariosConAcceso = [...new Set([...usuariosCompartidos, ...idsPorRoles])];

    const exclusiones = isUpdate
        ? [...warnings, ...(await resolveArchivoNotificationRecipients(id))]
        : warnings;

    return usuariosConAcceso.filter((userId) => !exclusiones.includes(userId));
};

export const markFileAsReadService = async (userContextId: number, archivoId: number): Promise<void> => {
    return await markFileAsRead(userContextId, archivoId);
};

export const getArchivoViewersService = async (
    archivoId: number,
    userContextId: number,
): Promise<ArchivoViewerResponse[]> => {
    const archivo = await getArchivoById(archivoId);

    if (!archivo) {
        throw new NotFoundError('Archivo no encontrado.');
    }

    if (archivo.created_by !== userContextId) {
        throw new UnauthorizedError('No autorizado.');
    }

    return getArchivoViewersByArchivoId(archivoId);
};