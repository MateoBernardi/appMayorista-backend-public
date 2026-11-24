jest.mock('../../adapters/db/carpetasRepo');

import * as carpetasRepo from '../../adapters/db/carpetasRepo';
import {
  addCarpeta,
  editCarpeta,
  getCarpetaPermisos,
  listVisibleCarpetas,
  patchPermisosCarpeta,
  removeCarpeta,
  validateUserCanAccessCarpeta,
} from '../../domain/services/carpetasServices';

const repo = jest.mocked(carpetasRepo);

describe('Carpetas Domain Services', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deberia crear carpeta valida', async () => {
    repo.createCarpeta.mockResolvedValue({ id: 1, nombre: 'Legal' } as any);

    const result = await addCarpeta(
      {
        nombre: 'Legal',
        id_usuario: 10,
        allowed_roles: ['admin'],
        usuarios_id: [20],
      },
      'admin',
    );

    expect(repo.createCarpeta).toHaveBeenCalled();
    expect(result.id).toBe(1);
  });

  it('deberia crear carpeta con visibilidad opcional ausente', async () => {
    repo.createCarpeta.mockResolvedValue({ id: 2, nombre: 'General' } as any);

    await addCarpeta(
      {
        nombre: 'General',
        id_usuario: 10,
      },
      'gerencia',
    );

    expect(repo.createCarpeta).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_roles: [],
        usuarios_id: [],
      }),
    );
  });

  it('deberia fallar si nombre es vacio', async () => {
    await expect(addCarpeta({ nombre: ' ', id_usuario: 10 }, 'admin')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('deberia editar carpeta cuando tiene permisos', async () => {
    repo.getCarpetaById.mockResolvedValue({ id: 1, id_carpeta_padre: null } as any);
    repo.canManageCarpeta.mockResolvedValue(true);
    repo.updateCarpeta.mockResolvedValue({ id: 1, nombre: 'RRHH' } as any);

    const result = await editCarpeta(1, { nombre: 'RRHH' }, 10, 'admin');

    expect(repo.updateCarpeta).toHaveBeenCalledWith(1, expect.objectContaining({ nombre: 'RRHH' }));
    expect(result.carpeta.nombre).toBe('RRHH');
  });

  it('deberia impedir editar sin permisos', async () => {
    repo.getCarpetaById.mockResolvedValue({ id: 1, id_carpeta_padre: null } as any);
    repo.canManageCarpeta.mockResolvedValue(false);

    await expect(editCarpeta(1, { nombre: 'X' }, 10, 'empleado')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('deberia filtrar permisos invalidos al editar carpeta hija', async () => {
    repo.getCarpetaById.mockResolvedValue({ id: 1, id_carpeta_padre: 8 } as any);
    repo.canManageCarpeta.mockResolvedValue(true);
    repo.splitRolesByCarpetaAccess.mockResolvedValue({ validRoles: ['admin'], invalidRoles: ['empleado'] });
    repo.splitUsersByCarpetaAccess.mockResolvedValue({ validUsers: [20], invalidUsers: [30] });
    repo.getUserDisplayNamesByUserContextIds.mockResolvedValue(new Map([[30, 'Ana Gomez']]));
    repo.updateCarpeta.mockResolvedValue({ id: 1, nombre: 'RRHH', allowed_roles: ['admin'] } as any);

    const result = await editCarpeta(1, { allowed_roles: ['admin', 'empleado'], usuarios_id: [20, 30] }, 10, 'admin');

    expect(repo.updateCarpeta).toHaveBeenCalledWith(1, expect.objectContaining({ allowed_roles: ['admin'], usuarios_id: [20] }));
    expect(result.warnings).toBeDefined();
    expect(result.warnings?.invalid_roles).toEqual(['empleado']);
    expect(result.warnings?.invalid_users).toEqual(['Ana Gomez']);
  });

  it('deberia remover permisos parciales de carpeta', async () => {
    repo.getCarpetaById.mockResolvedValue({ id: 1, id_usuario: 10 } as any);
    repo.canManageCarpeta.mockResolvedValue(true);
    repo.patchCarpetaPermisos.mockResolvedValue(undefined);
    repo.getCarpetaAclData.mockResolvedValue({
      id: 1,
      owner_id: 10,
      allowed_roles: ['admin'],
      allowed_users: [20],
      allowed_user_names: ['Juan Perez'],
    });

    const result = await patchPermisosCarpeta(1, { allowed_roles: ['empleado'], ids: [30] }, 10, 'admin');

    expect(repo.patchCarpetaPermisos).toHaveBeenCalledWith(1, ['empleado'], [30]);
    expect(result.allowed_roles).toEqual(['admin']);
    expect(result.allowed_users).toEqual(['Juan Perez']);
  });

  it('deberia eliminar carpeta con cascada', async () => {
    repo.getCarpetaById.mockResolvedValue({ id: 1 } as any);
    repo.canManageCarpeta.mockResolvedValue(true);
    repo.getForeignContentInSubtree.mockResolvedValue({
      foreign_folder_count: 0,
      foreign_file_count: 0,
      foreign_folder_ids: [],
      foreign_file_ids: [],
    });
    repo.deleteCarpetaCascade.mockResolvedValue({ id: 1 });

    const result = await removeCarpeta(1, 10, 'admin');

    expect(repo.deleteCarpetaCascade).toHaveBeenCalledWith(1);
    expect(result.id).toBe(1);
  });

  it('deberia bloquear delete si hay contenido de otro creador', async () => {
    repo.getCarpetaById.mockResolvedValue({ id: 1 } as any);
    repo.canManageCarpeta.mockResolvedValue(true);
    repo.getForeignContentInSubtree.mockResolvedValue({
      foreign_folder_count: 1,
      foreign_file_count: 0,
      foreign_folder_ids: [9],
      foreign_file_ids: [],
    });

    await expect(removeCarpeta(1, 10, 'admin')).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.deleteCarpetaCascade).not.toHaveBeenCalled();
  });

  it('deberia delegar validacion de acceso', async () => {
    repo.userCanAccessCarpeta.mockResolvedValue(true);

    const canAccess = await validateUserCanAccessCarpeta(1, 10, 'admin');

    expect(canAccess).toBe(true);
    expect(repo.userCanAccessCarpeta).toHaveBeenCalledWith(1, 10, 'admin');
  });

  it('deberia devolver ACL de carpeta al owner', async () => {
    repo.getCarpetaAclData.mockResolvedValue({
      id: 1,
      owner_id: 10,
      allowed_roles: ['admin'],
      allowed_users: [20],
      allowed_user_names: ['Juan Perez'],
    });

    const result = await getCarpetaPermisos(1, 10);
    expect(result.resource_type).toBe('carpeta');
    expect(result.allowed_users).toEqual(['Juan Perez']);
  });

  it('deberia listar carpetas visibles en formato list con Sin carpeta', async () => {
    repo.getVisibleCarpetas.mockResolvedValue([
      { id: 1, nombre: 'Legales', id_carpeta_padre: null },
    ] as any);

    const result = await listVisibleCarpetas(10, 'gerencia', 'list', true);

    expect(result.view).toBe('list');
    expect(result.items).toEqual([
      { id: null, nombre: 'Sin carpeta', id_carpeta_padre: null },
      { id: 1, nombre: 'Legales', id_carpeta_padre: null },
    ]);
  });

  it('deberia listar carpetas visibles en formato tree', async () => {
    repo.getVisibleCarpetas.mockResolvedValue([
      { id: 1, nombre: 'Legales', id_carpeta_padre: null },
      { id: 2, nombre: 'Contratos', id_carpeta_padre: 1 },
    ] as any);

    const result = await listVisibleCarpetas(10, 'gerencia', 'tree', false);

    expect(result.view).toBe('tree');
    expect(result.items).toEqual([
      {
        id: 1,
        nombre: 'Legales',
        type: 'folder',
        id_carpeta_padre: null,
        children: [
          {
            id: 2,
            nombre: 'Contratos',
            type: 'folder',
            id_carpeta_padre: 1,
            children: [],
          },
        ],
      },
    ]);
  });
});
