import { getClienteById } from '../../adapters/db/clientesRepo';
import { 
    findCuentasPorCuit,
    createUsuarioEntidad,
    getRolPorDefectoPorEntorno,
    getOrigenEntidadTipo,
    findUserById,
    getUsuarioIdsByRoles,
    getUsuarioEntidadCompleto
} from '../../adapters/db/usuariosRepo';
import { getPersonalById } from '../../adapters/db/personalRepo';
import { sendPushNotificationToMultipleUsers } from '../../adapters/comunications/expoPushNotifications';
import { generateAccessToken, generateRefreshToken, getRefreshExpiresAt } from '../validations/authValidations';
import { saveRefreshToken } from '../../adapters/db/authRepo';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../adapters/errors/AppError';
import { TokenPurpose } from '../../types/tokenPurpose';
import { revocarTokensActivos, sendVerificationToken, validateVerificationToken } from './verificationTokenServices';

const NOTIFICATION_TIMEOUT_MS = 1500;

type Entorno = 'web' | 'mayorista' | 'interno';

const enmascararEmail = (email: string): string => email.replace(/(.{2})(.*)(@.*)/, '$1***$3');

/**
 * PASO 1 de la asociación. El cliente manda solo el CUIT: el servidor busca las cuentas
 * de ese CUIT en el entorno y manda un código distinto al email registrado de cada una
 * (el código queda atado a esa cuenta). Los datos de las cuentas nunca salen del servidor.
 * @returns Los destinos enmascarados, para que el usuario sepa qué casilla revisar
 */
export const solicitarAsociacion = async (
    userId: number,
    cuit: string,
    entorno: Entorno
): Promise<{ destinos: string[] }> => {
    const cuentas = await findCuentasPorCuit(cuit, entorno);
    const conEmail = cuentas.filter((c) => typeof c.contact === 'string' && c.contact.includes('@'));

    if (conEmail.length === 0) {
        throw new NotFoundError('No encontramos una cuenta con email para ese CUIT. Acercate a la oficina.');
    }

    // Un pedido nuevo invalida los códigos de asociación anteriores
    await revocarTokensActivos(userId, TokenPurpose.ACCOUNT_ASSOCIATION);

    for (const cuenta of conEmail) {
        await sendVerificationToken(
            userId,
            cuenta.contact,
            'email',
            null,  // created_by es null cuando es creado por el sistema
            TokenPurpose.ACCOUNT_ASSOCIATION,
            { entidadId: Number(cuenta.id), entidadTipoId: cuenta.id_entidad_tipo },
        );
    }

    return { destinos: [...new Set(conEmail.map((c) => enmascararEmail(c.contact)))] };
};

/**
 * Asocia una entidad a un usuario con el rol por defecto del entorno.
 * La entidad sale siempre del token de verificación, nunca del request.
 */
const asociarEntidadAUsuario = async (
    userId: number,
    entidadId: number,
    entidadTipoId: number,
    entorno: Entorno
) => {
    const user = await findUserById(userId);
    
    if (!user) {
        throw new Error('Usuario no encontrado');
    }
    
    // Obtener el rol por defecto para el entorno
    const idRol = await getRolPorDefectoPorEntorno(entorno);
    
    // Validar que la entidad sigue existiendo (web → clientes, mayorista/interno → personal)
    if (entorno === 'web') {
        const cliente = await getClienteById(entidadId);
        if (!cliente) {
            throw new Error('Cliente no encontrado o no disponible');
        }
    } else {
        const personal = await getPersonalById(entidadId);
        if (!personal) {
            throw new Error('Personal no encontrado o no disponible');
        }
    }

    // Crear la asociación
    const asociacion = await createUsuarioEntidad(userId, entidadTipoId, entidadId, idRol);

    // Notificar a usuarios con rol 'gerencia' sobre la nueva asociación
    try {
        const gerenciaUserContextIds = await getUsuarioIdsByRoles(['gerencia']);
        if (gerenciaUserContextIds.length > 0) {
            const nombreCompleto = user.nombre && user.apellido 
                ? `${user.nombre} ${user.apellido}` 
                : user.username;

            // La notificación es best-effort: no debe bloquear la respuesta del endpoint.
            await Promise.race([
                sendPushNotificationToMultipleUsers(gerenciaUserContextIds, {
                    title: 'Nueva asociación de cuenta',
                    body: `${nombreCompleto} se asoció a una cuenta en el entorno ${entorno}`,
                    data: { type: 'nueva_asociacion', userId, entorno }
                }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Timeout de notificación push')), NOTIFICATION_TIMEOUT_MS)
                )
            ]);
        }
    } catch (notifError) {
        // No bloquear el flujo si la notificación falla
        console.error('Error al enviar notificación de nueva asociación a gerencia:', notifError);
    }
    
    return asociacion;
};

/**
 * PASO 2 de la asociación. El cliente manda solo el código: el que coincide define
 * la cuenta (guardada en el token). La cuenta tiene que ser del mismo entorno que el
 * header y que el access token readonly. Asocia y genera los tokens de sesión.
 */
export const verificarAsociacion = async (
    userId: number,
    codigo: string,
    entornoHeader: Entorno,
    entornoAccessToken: unknown
) => {
    if (entornoAccessToken !== entornoHeader) {
        throw new UnauthorizedError('Entorno no válido. Por favor iniciá sesión nuevamente.');
    }

    const validacion = await validateVerificationToken(userId, codigo, TokenPurpose.ACCOUNT_ASSOCIATION);
    if (!validacion.success) {
        throw new UnauthorizedError(validacion.message, { attemptsLeft: validacion.attemptsLeft });
    }

    const { entidad_id: entidadId, entidad_tipo_id: entidadTipoId } = validacion.token;
    if (!entidadId || !entidadTipoId) {
        throw new BadRequestError('El código no corresponde a una cuenta. Solicitá uno nuevo.');
    }

    const origen = await getOrigenEntidadTipo(entidadTipoId);
    if (origen !== entornoHeader) {
        throw new BadRequestError('El código no corresponde a una cuenta de este entorno.');
    }

    const asociacion = await asociarEntidadAUsuario(userId, entidadId, entidadTipoId, origen);

    const usuarioEntidadCompleto = await getUsuarioEntidadCompleto(userId, origen);
    if (!usuarioEntidadCompleto || usuarioEntidadCompleto.length === 0) {
        throw new Error('Error al obtener los datos. Por favor, intentá iniciar sesión de nuevo.');
    }

    const userContext = usuarioEntidadCompleto[0]!;

    const accessToken = generateAccessToken(
        userId,
        userContext.rol_nombre,
        {
            userContextId: userContext.user_context_id,
            entidadTipoId: userContext.id_entidad_tipo,
            entidadId: userContext.id_entidad,
            entorno: userContext.entorno
        }
    );

    const refreshToken = await generateRefreshToken(userContext.user_context_id, userContext.rol_nombre);
    const expiresAt = getRefreshExpiresAt();
    await saveRefreshToken(userContext.user_context_id, refreshToken.hashedToken, expiresAt);

    return { accessToken, refreshToken: refreshToken.token, asociacion };
};
