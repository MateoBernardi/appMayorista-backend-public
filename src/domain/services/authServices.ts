import { saveRefreshToken, findRefreshTokenByHash, revokeRefreshToken, getRefreshTokensByUserContextId, deleteRefreshTokens } from "../../adapters/db/authRepo";
import { generateAccessToken, generateRefreshToken, hashRefreshToken, getRefreshExpiresAt, verifyGoogleIdToken } from "../validations/authValidations";
import { validateUserCredentials } from "./usuariosServices";
import { getAllUsuarioPerfiles, getUsuarioEntidadCompleto, findUserByEmail } from "../../adapters/db/usuariosRepo";
import { UnauthorizedError } from "../../adapters/errors/AppError";
import { UsuarioDTO } from "../dto/UsuarioDTO";

export async function loginUser(identifier: string, password: string, entorno: string) {
  const user = await validateUserCredentials(identifier, password);

  if (!user) {
    return null;
  }

  return issueTokensForUser(user, entorno);
}

export async function loginWithGoogle(idToken: string, entorno: string) {
  const { email, emailVerified } = await verifyGoogleIdToken(idToken);

  if (!emailVerified) {
    throw new UnauthorizedError("El email de Google no está verificado.");
  }

  const user = await findUserByEmail(email);
  if (!user) {
    throw new UnauthorizedError("No existe una cuenta asociada a este email.");
  }

  return issueTokensForUser(user, entorno);
}

async function issueTokensForUser(user: UsuarioDTO, entorno: string) {
  // Obtener el usuario_entidad para el entorno especificado usando la vista optimizada
  const usuarioEntidad = await getUsuarioEntidadCompleto(
    user.id,
    entorno as 'web' | 'mayorista' | 'interno'
  );

  const hasUserEntity = usuarioEntidad && usuarioEntidad.length > 0;

  // CAMINO 1: Sin usuarioEntidad → AT readonly
  if (!hasUserEntity) {
    const accessToken = generateAccessToken(
      user.id,
      "readonly",
      {
        requiresAssociation: true,
        entorno: entorno,
        userId: user.id
      }
    );

    return {
      requiresAssociation: true,
      accessToken,
    };
  }

  // CAMINO 2: Con usuarioEntidad → AT + RT
  const activeContext = usuarioEntidad[0];

  if (!activeContext) {
    throw new Error("No se encontró sesión activa para el usuario");
  }

  // Revocar todos los refresh tokens activos del usuario_entidad
  // ACÁ ESTÁ EL PROBLEMA DE LAS MÚLTIPLES SESIONES, EVALUAR BORRAR EN DESARROLLO.
  //await revokeUserActiveRefreshTokens(activeContext.user_context_id);

  const accessToken = generateAccessToken(
    activeContext.id_usuario,
    activeContext.rol_nombre,
    {
      userContextId: activeContext.user_context_id,
      entidadTipoId: activeContext.id_entidad_tipo,
      entidadId: activeContext.id_entidad,
      entorno: activeContext.entorno
    }
  );
  const refreshToken = await generateRefreshToken(activeContext.user_context_id, activeContext.rol_nombre);
  const expiresAt = getRefreshExpiresAt();

  await saveRefreshToken(activeContext.user_context_id, refreshToken.hashedToken, expiresAt);

  const todosLosPerfiles = await getAllUsuarioPerfiles(activeContext.user_context_id);

  return {
    requiresAssociation: false,
    accessToken,
    refreshToken: refreshToken.token,
    availableProfiles: todosLosPerfiles.map(a => ({
      nombre: a.nombre,
      apellido: a.apellido,
      email: a.email,
      rol_nombre: a.rol_nombre
    }))
  };
}

export async function rotateAccessToken(dbToken: any, targetEntorno: 'web' | 'mayorista' | 'interno') {
  // Detectar cambio de entorno
  if (dbToken.origen !== targetEntorno) {

    // Buscar perfiles del usuario en el nuevo entorno
    const perfilesNuevoEntorno = await getUsuarioEntidadCompleto(
      dbToken.id_usuario,
      targetEntorno as 'web' | 'mayorista' | 'interno'
    );

    if (!perfilesNuevoEntorno || perfilesNuevoEntorno.length === 0) {
      // Usuario NO tiene perfil en el nuevo entorno -> Error no autenticado
      throw new Error("No autorizado.");
    }

    // Usuario SÍ tiene perfil - cambiar automáticamente al primero
    const perfilSeleccionado = perfilesNuevoEntorno[0];

    if (!perfilSeleccionado) {
      throw new Error("No autorizado.");
    }

    // Revocar token anterior
    await revokeRefreshToken(dbToken.id);

    // Revocar tokens activos del nuevo contexto
    await revokeUserActiveRefreshTokens(perfilSeleccionado.user_context_id);

    // Generar nuevos tokens con el primer perfil del nuevo entorno
    const newAccessToken = generateAccessToken(
      perfilSeleccionado.id_usuario,
      perfilSeleccionado.rol_nombre,
      {
        userContextId: perfilSeleccionado.user_context_id,
        entidadTipoId: perfilSeleccionado.id_entidad_tipo,
        entidadId: perfilSeleccionado.id_entidad,
        entorno: perfilSeleccionado.entorno
      }
    );
    const newRefreshToken = await generateRefreshToken(perfilSeleccionado.user_context_id, perfilSeleccionado.rol_nombre);
    const expiresAt = getRefreshExpiresAt();

    await saveRefreshToken(perfilSeleccionado.user_context_id, newRefreshToken.hashedToken, expiresAt);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken.token,
      environmentChanged: true,
      profile: {
        userContextId: perfilSeleccionado.user_context_id,
        entorno: perfilSeleccionado.entorno,
        rol: perfilSeleccionado.rol_nombre,
        entidadTipo: perfilSeleccionado.entidad_tipo_nombre
      }
    };
  }

  // 4. Mismo entorno - Generar nuevos tokens con el mismo contexto (renovación simple)
  const newAccessToken = generateAccessToken(
    dbToken.id_usuario,
    dbToken.rol_nombre,
    {
      userContextId: dbToken.id_usuario_entidad,
      entidadTipoId: dbToken.id_entidad_tipo,
      entidadId: dbToken.id_entidad,
      entorno: dbToken.origen
    }
  );
  const newRefreshToken = await generateRefreshToken(dbToken.id_usuario_entidad, dbToken.rol_nombre);
  const expiresAt = getRefreshExpiresAt();

  await saveRefreshToken(dbToken.id_usuario_entidad, newRefreshToken.hashedToken, expiresAt);
  await revokeRefreshToken(dbToken.id);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken.token,
    environmentChanged: false
  };
}

export async function switchProfile(dbToken: any, targetUserContextId: number) {
  // 3. Obtener todos los perfiles del usuario usando la vista completa
  const perfilesUsuario = await getUsuarioEntidadCompleto(dbToken.id_usuario, 'web');
  const perfilesWeb = perfilesUsuario || [];

  const perfilesMayorista = await getUsuarioEntidadCompleto(dbToken.id_usuario, 'mayorista');
  const perfilesInterno = await getUsuarioEntidadCompleto(dbToken.id_usuario, 'interno');

  const todosLosPerfiles = [...perfilesWeb, ...(perfilesMayorista || []), ...(perfilesInterno || [])];

  // 4. Verificar que el usuario tenga acceso al perfil solicitado
  const perfilSeleccionado = todosLosPerfiles.find(p => p.user_context_id === targetUserContextId);

  if (!perfilSeleccionado) {
    throw new Error(`No tienes acceso al perfil solicitado (user_context_id: ${targetUserContextId})`);
  }

  // 5. Revocar el refresh token anterior
  await revokeRefreshToken(dbToken.id);

  // 6. Revocar todos los tokens activos del nuevo contexto para evitar conflictos
  await revokeUserActiveRefreshTokens(perfilSeleccionado.user_context_id);

  // 7. Generar nuevos tokens con el perfil seleccionado
  const newAccessToken = generateAccessToken(
    perfilSeleccionado.id_usuario,
    perfilSeleccionado.rol_nombre,
    {
      userContextId: perfilSeleccionado.user_context_id,
      entidadTipoId: perfilSeleccionado.id_entidad_tipo,
      entidadId: perfilSeleccionado.id_entidad,
      entorno: perfilSeleccionado.entorno
    }
  );
  const newRefreshToken = await generateRefreshToken(perfilSeleccionado.user_context_id, perfilSeleccionado.rol_nombre);
  const expiresAt = getRefreshExpiresAt();

  await saveRefreshToken(perfilSeleccionado.user_context_id, newRefreshToken.hashedToken, expiresAt);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken.token,
    profile: {
      userContextId: perfilSeleccionado.user_context_id,
      entorno: perfilSeleccionado.entorno,
      rol: perfilSeleccionado.rol_nombre,
      entidadTipo: perfilSeleccionado.entidad_tipo_nombre
    }
  };
}

export async function logoutUser(refreshToken: string) {
  const hash = hashRefreshToken(refreshToken);
  const dbToken = await findRefreshTokenByHash(hash);

  // Token no existe o ya está revocado: logout idempotente
  if (!dbToken || dbToken.revoked) {
    return true;
  }

  await revokeRefreshToken(dbToken.id);
  return true;
}

export async function revokeUserActiveRefreshTokens(userContextId: number) {
  const activeTokens = await getRefreshTokensByUserContextId(userContextId);
  for (const t of activeTokens) {
    await revokeRefreshToken(t.id);
  }
}

export async function deleteUserRefreshTokens(userContextId: number) {
  const deleteTokens = await deleteRefreshTokens(userContextId);
  return deleteTokens;
}