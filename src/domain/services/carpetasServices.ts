import {
  canManageCarpeta,
  createCarpeta,
  deleteCarpetaCascade,
  getCarpetaAclData,
  getCarpetaById,
  getForeignContentInSubtree,
  getUserDisplayNamesByUserContextIds,
  getVisibleCarpetas,
  patchCarpetaPermisos,
  splitRolesByCarpetaAccess,
  splitUsersByCarpetaAccess,
  updateCarpeta,
  userCanAccessCarpeta,
} from '../../adapters/db/carpetasRepo';
import { getUserIdsByRoles } from './usuariosServices';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../adapters/errors/AppError';
import {
  CarpetaDTO,
  CarpetaListItemDTO,
  CarpetasResponseDTO,
  CarpetasView,
  CarpetaTreeItemDTO,
  CrearCarpetaDTO,
  EditarCarpetaDTO,
} from '../dto/CarpetaDTO';


export interface PermisosParciales {
  invalid_roles: string[];
  invalid_users: string[];
  invalid_user_ids?: number[];
  reason: string;
}

export interface EditCarpetaResult {
  carpeta: CarpetaDTO;
  warnings?: PermisosParciales;
}

export interface CarpetaPermisosResponse {
  resource_type: 'carpeta';
  resource_id: number;
  owner_id: number;
  allowed_roles: string[];
  allowed_users: string[];
  user_context_ids?: number[];
}

export interface PermisosSplitResult {
  valid_roles: string[];
  invalid_roles: string[];
  valid_users: number[];
  invalid_users: number[];
}

export interface PatchPermisosInput {
  allowed_roles?: string[];
  ids?: number[];
}

const mapUserIdsToDisplayNames = async (userIds: number[]): Promise<string[]> => {
  if (!userIds.length) {
    return [];
  }

  const byUserId = await getUserDisplayNamesByUserContextIds(userIds);
  return userIds.map((userId) => byUserId.get(userId) || `Usuario ${userId}`);
};

export const addCarpeta = async (data: CrearCarpetaDTO, userRole: string): Promise<CarpetaDTO> => {
  if (!data.nombre?.trim()) {
    throw new BadRequestError('El nombre de la carpeta es obligatorio.');
  }

  if (data.id_carpeta_padre) {
    const parentFolder = await getCarpetaById(data.id_carpeta_padre);
    if (!parentFolder) {
      throw new NotFoundError('No se encontró el directorio.');
    }

    const canAccessParent = await userCanAccessCarpeta(data.id_carpeta_padre, data.id_usuario, userRole);
    if (!canAccessParent) {
      throw new ForbiddenError('No tenés permisos para crear carpetas dentro de esta carpeta.');
    }

    data.allowed_roles = parentFolder.allowed_roles;
    data.usuarios_id = parentFolder.allowed_users.map(usuario => Number(usuario));
  }

  return createCarpeta({
    ...data,
    nombre: data.nombre.trim(),
    allowed_roles: data.allowed_roles ?? [],
    usuarios_id: data.usuarios_id ?? [],
  });
};

export const editCarpeta = async (
  id: number,
  data: EditarCarpetaDTO,
  userContextId: number,
  userRole: string,
): Promise<EditCarpetaResult> => {
  const folder = await getCarpetaById(id);
  if (!folder) {
    throw new NotFoundError('Carpeta no encontrada.');
  }

  const canManage = await canManageCarpeta(id, userContextId, userRole);
  if (!canManage) {
    throw new ForbiddenError('No tenés permisos para editar esta carpeta.');
  }

  if (data.nombre !== undefined && !data.nombre.trim()) {
    throw new BadRequestError('El nombre de la carpeta no puede estar vacío.');
  }

  const updatePayload: EditarCarpetaDTO = {};
  const invalidRoles: string[] = [];
  const invalidUsers: number[] = [];

  if (data.nombre !== undefined) {
    updatePayload.nombre = data.nombre.trim();
  }

  if (data.allowed_roles !== undefined) {
    if (folder.id_carpeta_padre) {
      const roleSplit = await splitRolesByCarpetaAccess(folder.id_carpeta_padre, data.allowed_roles);
      updatePayload.allowed_roles = roleSplit.validRoles;
      invalidRoles.push(...roleSplit.invalidRoles);
    } else {
      updatePayload.allowed_roles = data.allowed_roles;
    }
  }

  if (data.usuarios_id !== undefined) {
    if (folder.id_carpeta_padre) {
      const userSplit = await splitUsersByCarpetaAccess(folder.id_carpeta_padre, data.usuarios_id);
      updatePayload.usuarios_id = userSplit.validUsers;
      invalidUsers.push(...userSplit.invalidUsers);
    } else {
      updatePayload.usuarios_id = data.usuarios_id;
    }
  }

  const updated = await updateCarpeta(id, updatePayload);

  if (!updated) {
    throw new NotFoundError('Carpeta no encontrada.');
  }

  if (!invalidRoles.length && !invalidUsers.length) {
    return { carpeta: updated };
  }

  const invalidUserNames = await mapUserIdsToDisplayNames(invalidUsers);

  return {
    carpeta: updated,
    warnings: {
      invalid_roles: invalidRoles,
      invalid_users: invalidUserNames,
      invalid_user_ids: invalidUsers,
      reason: 'Hay permisos asignados que no tienen acceso a la carpeta destino, se creará la carpeta pero se ignorarán esos permisos. Podés editar la carpeta padre luego para corregir los permisos.',
    },
  };
};

export const patchPermisosCarpeta = async (
  id: number,
  data: PatchPermisosInput,
  userContextId: number,
  userRole: string,
): Promise<CarpetaPermisosResponse> => {
  const folder = await getCarpetaById(id);
  if (!folder) {
    throw new NotFoundError('Carpeta no encontrada.');
  }

  const canManage = await canManageCarpeta(id, userContextId, userRole);
  if (!canManage) {
    throw new ForbiddenError('No tenés permisos para modificar permisos de esta carpeta.');
  }

  const rolesToRemove = [...new Set((data.allowed_roles ?? []).map((role) => String(role).trim()).filter(Boolean))];
  const userIdsToRemove = [...new Set((data.ids ?? []).filter((userId) => Number.isInteger(userId) && userId > 0))];

  if (!rolesToRemove.length && !userIdsToRemove.length) {
    throw new BadRequestError('Debés enviar al menos un rol o usuario para remover permisos.');
  }

  await patchCarpetaPermisos(id, rolesToRemove, userIdsToRemove);

  const acl = await getCarpetaAclData(id);
  if (!acl) {
    throw new NotFoundError('Carpeta no encontrada.');
  }

  return {
    resource_type: 'carpeta',
    resource_id: acl.id,
    owner_id: acl.owner_id,
    allowed_roles: acl.allowed_roles ?? [],
    allowed_users: acl.allowed_user_names ?? [],
    user_context_ids: acl.allowed_users ?? [],
  };
};

export const getUserDisplayNamesByIds = async (userIds: number[]): Promise<string[]> => {
  return mapUserIdsToDisplayNames(userIds);
};

export const removeCarpeta = async (id: number, userContextId: number, userRole: string): Promise<{ id: number }> => {
  const folder = await getCarpetaById(id);
  if (!folder) {
    throw new NotFoundError('Carpeta no encontrada.');
  }

  const canManage = await canManageCarpeta(id, userContextId, userRole);
  if (!canManage) {
    throw new ForbiddenError('No tenés permisos para eliminar esta carpeta.');
  }

  const foreignContent = await getForeignContentInSubtree(id, userContextId);
  if (foreignContent.foreign_folder_count > 0 || foreignContent.foreign_file_count > 0) {
    throw new ConflictError('No podés eliminar la carpeta porque contiene subcarpetas o archivos creados por otros usuarios. Se debe mover ese contenido antes de borrar.');
  }

  return deleteCarpetaCascade(id);
};

export const getCarpetaPermisos = async (
  id: number,
): Promise<CarpetaPermisosResponse> => {
  const acl = await getCarpetaAclData(id);
  if (!acl) {
    throw new NotFoundError('Carpeta no encontrada.');
  }

  return {
    resource_type: 'carpeta',
    resource_id: acl.id,
    owner_id: acl.owner_id,
    allowed_roles: acl.allowed_roles ?? [],
    allowed_users: acl.allowed_user_names ?? [],
    user_context_ids: acl.allowed_users ?? [],
  };
};

export const getCarpetaNombreById = async (id: number | null): Promise<string> => {
  if (id === null) {
    return 'Sin carpeta';
  }

  const carpeta = await getCarpetaById(id);
  return carpeta?.nombre ?? 'carpeta desconocida';
};

export const resolveCarpetaNotificationRecipients = async (
  id: number,
  excludeUserContextId?: number,
): Promise<number[]> => {
  const acl = await getCarpetaAclData(id);
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

export const validateUserCanAccessCarpeta = async (
  id: number,
  userContextId: number,
  userRole: string,
): Promise<boolean> => {
  return userCanAccessCarpeta(id, userContextId, userRole);
};

export const splitPermisosByCarpetaAccess = async (
  carpetaId: number,
  roles: string[],
  users: number[],
): Promise<PermisosSplitResult> => {
  const [roleSplit, userSplit] = await Promise.all([
    splitRolesByCarpetaAccess(carpetaId, roles),
    splitUsersByCarpetaAccess(carpetaId, users),
  ]);

  return {
    valid_roles: roleSplit.validRoles,
    invalid_roles: roleSplit.invalidRoles,
    valid_users: userSplit.validUsers,
    invalid_users: userSplit.invalidUsers,
  };
};

const toTree = (folders: CarpetaListItemDTO[], includeSinCarpeta: boolean): CarpetaTreeItemDTO[] => {
  const byParent = new Map<number | null, CarpetaListItemDTO[]>();

  for (const folder of folders) {
    const parentKey = folder.id_carpeta_padre ?? null;
    const list = byParent.get(parentKey) ?? [];
    list.push(folder);
    byParent.set(parentKey, list);
  }

  const buildBranch = (parentId: number | null): CarpetaTreeItemDTO[] => {
    const children = byParent.get(parentId) ?? [];
    return children.map((child) => ({
      id: child.id,
      nombre: child.nombre,
      type: 'folder',
      id_carpeta_padre: child.id_carpeta_padre,
      children: buildBranch(child.id),
    }));
  };

  const tree = buildBranch(null);

  if (includeSinCarpeta) {
    return [
      {
        id: null,
        nombre: 'Sin carpeta',
        type: 'virtual',
        children: [],
      },
      ...tree,
    ];
  }

  return tree;
};

export const listVisibleCarpetas = async (
  userContextId: number,
  userRole: string,
  view: CarpetasView,
  includeSinCarpeta: boolean,
): Promise<CarpetasResponseDTO> => {
  const folders = await getVisibleCarpetas(userContextId, userRole);

  if (view === 'tree') {
    return {
      view,
      items: toTree(folders, includeSinCarpeta),
    };
  }

  const list: CarpetaListItemDTO[] = includeSinCarpeta
    ? [{ id: null, nombre: 'Sin carpeta', id_carpeta_padre: null }, ...folders]
    : folders;

  return {
    view,
    items: list,
  };
};
