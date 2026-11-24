/**
 * Tests de dominio: archivosServices
 * Capa: Domain Service
 * Plataforma: Transversal
 */

jest.mock('../../adapters/db/archivosRepo');
jest.mock('../../adapters/archivos/archivosApi');
jest.mock('../../domain/services/carpetasServices');
jest.mock('../../domain/services/usuariosServices');

import * as archivosRepo from '../../adapters/db/archivosRepo';
import * as archivosApi from '../../adapters/archivos/archivosApi';
import * as carpetasService from '../../domain/services/carpetasServices';
import * as usuariosService from '../../domain/services/usuariosServices';
import {
  fetchArchivos,
  fetchArchivosPersonales,
  addArchivo,
  getArchivoPermisos,
  modifyArchivo,
  patchPermisosArchivo,
  removeArchivo,
  getArchivoUrl,
  searchArchivoByNombre,
  fetchArchivosByIdAsociado,
  searchArchivosByPersonaService,
  moveArchivo,
  getArchivoViewersService,
  resolveArchivoRecipientsToNotify,
} from '../../domain/services/archivosServices';

const repo = jest.mocked(archivosRepo);
const api = jest.mocked(archivosApi);
const carpetas = jest.mocked(carpetasService);
const usuarios = jest.mocked(usuariosService);

const mockArchivo = {
  id: 1, nombre: 'test.pdf', ruta_r2: 'uploads/test.pdf',
  tipo: 'pdf', tamaño: 1024, titulo: 'Test',
  created_by: 10, creador_nombre: 'Juan', creador_apellido: 'Perez',
  created_at: new Date(), id_tipo: 1, uso: 'EMPRESA',
};

describe('Archivos Domain Services', () => {
  beforeEach(() => jest.resetAllMocks());

  // ─────────────────────────── fetchArchivos ───────────────────────────

  describe('fetchArchivos()', () => {
    it('debería retornar archivos filtrados por rol y userContextId', async () => {
      repo.getArchivos.mockResolvedValue([mockArchivo]);
      const result = await fetchArchivos('admin', 10);
      expect(repo.getArchivos).toHaveBeenCalledWith('admin', 10);
      expect(result).toEqual([mockArchivo]);
    });

    it('debería conservar opened_at en null y timestamp según estado de lectura', async () => {
      const openedAt = new Date('2026-04-09T12:00:00.000Z');
      const archivosConLectura = [
        { ...mockArchivo, id: 11, opened_at: null },
        { ...mockArchivo, id: 12, opened_at: openedAt },
      ];

      repo.getArchivos.mockResolvedValue(archivosConLectura as any);

      const result = await fetchArchivos('admin', 10);

      expect(result).toEqual(archivosConLectura);
      expect(result[0].opened_at).toBeNull();
      expect(result[1].opened_at).toEqual(openedAt);
    });
  });

  // ─────────────────────────── fetchArchivosPersonales ───────────────────────────

  describe('fetchArchivosPersonales()', () => {
    it('debería filtrar por userContextId solamente', async () => {
      repo.getArchivosPersonales.mockResolvedValue([]);
      await fetchArchivosPersonales(10);
      expect(repo.getArchivosPersonales).toHaveBeenCalledWith(10);
    });

    it('debería retornar opened_at cuando existe y null cuando no fue leído', async () => {
      const openedAt = new Date('2026-04-09T13:00:00.000Z');
      const archivosPersonales = [
        { ...mockArchivo, id: 21, opened_at: null },
        { ...mockArchivo, id: 22, opened_at: openedAt },
      ];

      repo.getArchivosPersonales.mockResolvedValue(archivosPersonales as any);

      const result = await fetchArchivosPersonales(10);

      expect(result).toEqual(archivosPersonales);
      expect(result[0].opened_at).toBeNull();
      expect(result[1].opened_at).toEqual(openedAt);
    });
  });

  // ─────────────────────────── addArchivo ───────────────────────────

  describe('addArchivo()', () => {
    const baseData = {
      nombre: 'new.pdf', ruta_r2: 'uploads/new.pdf',
      tipo: 'application/pdf', tamaño: 2048, titulo: 'Nuevo',
      created_by: 10,
    };

    it('debería subir archivo a R2 y crear entrada en BD', async () => {
      api.uploadFiles.mockResolvedValue(undefined);
      repo.createArchivo.mockResolvedValue({ ...mockArchivo, ...baseData });

      const fileBuffer = Buffer.from('test');
      const result = await addArchivo(baseData, 'admin', fileBuffer);

      expect(api.uploadFiles).toHaveBeenCalledWith(baseData.ruta_r2, fileBuffer, baseData.tipo);
      expect(repo.createArchivo).toHaveBeenCalledWith(expect.objectContaining(baseData));
      expect(result.archivo).toBeDefined();
    });

    it('debería crear entrada en BD sin subir si no hay buffer', async () => {
      repo.createArchivo.mockResolvedValue({ ...mockArchivo, ...baseData });

      await addArchivo(baseData, 'admin');

      expect(api.uploadFiles).not.toHaveBeenCalled();
      expect(repo.createArchivo).toHaveBeenCalled();
    });

    it('debería propagar el campo uso al crear archivo', async () => {
      const dataConUso = { ...baseData, uso: 'LICENCIA' as any };
      repo.createArchivo.mockResolvedValue({ ...mockArchivo, ...dataConUso });

      await addArchivo(dataConUso, 'admin');

      expect(repo.createArchivo).toHaveBeenCalledWith(
        expect.objectContaining({ uso: 'LICENCIA' })
      );
    });

    it('debería propagar error si la subida a R2 falla', async () => {
      api.uploadFiles.mockRejectedValue(new Error('Upload failed'));

      await expect(addArchivo(baseData, 'admin', Buffer.from('test'))).rejects.toThrow('Upload failed');
    });

    it('debería usar permisos de la carpeta al crear archivo con id_carpeta', async () => {
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(true);
      carpetas.getCarpetaPermisos.mockResolvedValue({
        allowed_roles: ['admin'],
        user_context_ids: [20],
      } as any);
      repo.createArchivo.mockResolvedValue({ ...mockArchivo, id_carpeta: 5, allowed_roles: ['admin'] } as any);

      const result = await addArchivo(
        { ...baseData, id_carpeta: 5 },
        'admin',
      );

      expect(carpetas.validateUserCanAccessCarpeta).toHaveBeenCalledWith(5, baseData.created_by, 'admin');
      expect(carpetas.getCarpetaPermisos).toHaveBeenCalledWith(5);
      expect(repo.createArchivo).toHaveBeenCalledWith(
        expect.objectContaining({
          allowed_roles: ['admin'],
          usuarios_compartidos: [20],
        }),
      );
      expect(result.archivo).toBeDefined();
    });
  });

  // ─────────────────────────── modifyArchivo ───────────────────────────

  describe('modifyArchivo()', () => {
    it('debería pasar userContextId y role al flujo de update sin validar carpeta si no cambia permisos', async () => {
      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, id_carpeta: 5 } as any);
      repo.updateArchivo.mockResolvedValue(mockArchivo);

      const result = await modifyArchivo(10, 1, { nombre: 'updated.pdf' }, 'admin');

      expect(carpetas.validateUserCanAccessCarpeta).not.toHaveBeenCalled();
      expect(repo.updateArchivo).toHaveBeenCalledWith(10, 1, { nombre: 'updated.pdf' });
      expect(result).toEqual({ archivo: mockArchivo });
    });

    it('debería filtrar roles y usuarios sin acceso a carpeta al actualizar permisos', async () => {
      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, id_carpeta: 5 } as any);
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(true);
      carpetas.splitPermisosByCarpetaAccess.mockResolvedValue({
        valid_roles: ['admin'],
        invalid_roles: ['empleado'],
        valid_users: [20],
        invalid_users: [30],
      });
      carpetas.getUserDisplayNamesByIds.mockResolvedValue(['Ana Gomez']);
      repo.updateArchivo.mockResolvedValue({ ...mockArchivo, allowed_roles: ['admin'] } as any);

      const result = await modifyArchivo(
        10,
        1,
        { allowed_roles: ['admin', 'empleado'], usuarios_compartidos: [20, 30] },
        'admin',
      );

      expect(carpetas.validateUserCanAccessCarpeta).toHaveBeenCalledWith(5, 10, 'admin');
      expect(repo.updateArchivo).toHaveBeenCalledWith(
        10,
        1,
        expect.objectContaining({
          allowed_roles: ['admin'],
          usuarios_compartidos: [20],
        }),
      );
      expect(result.warnings).toBeDefined();
    });

    it('debería rechazar update de permisos si no tiene acceso a la carpeta del archivo', async () => {
      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, id_carpeta: 5 } as any);
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(false);

      await expect(
        modifyArchivo(10, 1, { allowed_roles: ['admin'] }, 'empleado'),
      ).rejects.toMatchObject({ statusCode: 403 });

      expect(repo.updateArchivo).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── removeArchivo ───────────────────────────

  describe('removeArchivo()', () => {
    it('debería pasar userContextId al repo', async () => {
      repo.deleteArchivo.mockResolvedValue({ id: 1 });
      await removeArchivo(1, 10);
      expect(repo.deleteArchivo).toHaveBeenCalledWith(1, 10);
    });
  });

  // ─────────────────────────── getArchivoUrl ───────────────────────────

  describe('getArchivoUrl()', () => {
    it('debería generar URL firmada exitosamente', async () => {
      repo.getArchivoById.mockResolvedValue(mockArchivo);
      api.generateSignedUrl.mockResolvedValue('https://signed-url.com/test');

      const result = await getArchivoUrl(1, 3600);

      expect(result.archivo).toEqual(mockArchivo);
      expect(result.url).toBe('https://signed-url.com/test');
    });

    it('debería lanzar error si archivo no existe', async () => {
      repo.getArchivoById.mockResolvedValue(null);
      await expect(getArchivoUrl(999)).rejects.toThrow('Archivo no encontrado');
    });

    it('debería mapear tipo "pdf" a MIME type correcto', async () => {
      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, tipo: 'pdf' });
      api.generateSignedUrl.mockResolvedValue('url');

      await getArchivoUrl(1);

      expect(api.generateSignedUrl).toHaveBeenCalledWith(
        mockArchivo.ruta_r2, 3600, mockArchivo.nombre, 'application/pdf'
      );
    });

    it('debería pasar MIME type directo si ya contiene /', async () => {
      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, tipo: 'image/png' });
      api.generateSignedUrl.mockResolvedValue('url');

      await getArchivoUrl(1);

      expect(api.generateSignedUrl).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), 'image/png'
      );
    });

    it('debería pasar undefined como mimeType si tipo no reconocido', async () => {
      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, tipo: 'desconocido' });
      api.generateSignedUrl.mockResolvedValue('url');

      await getArchivoUrl(1);

      expect(api.generateSignedUrl).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), expect.anything(), undefined
      );
    });
  });

  // ─────────────────────────── searchArchivoByNombre ───────────────────────────

  describe('searchArchivoByNombre()', () => {
    it('debería pasar parámetros correctamente al repo', async () => {
      repo.getArchivoByNombre.mockResolvedValue([]);
      await searchArchivoByNombre('test', 'admin', 10);
      expect(repo.getArchivoByNombre).toHaveBeenCalledWith('test', 10, 'admin');
    });
  });

  // ─────────────────────────── fetchArchivosByIdAsociado ───────────────────────────

  describe('fetchArchivosByIdAsociado()', () => {
    it('debería pasar parámetros correctamente', async () => {
      repo.getArchivoByIdAsociado.mockResolvedValue([]);
      await fetchArchivosByIdAsociado(5, 'admin', 10);
      expect(repo.getArchivoByIdAsociado).toHaveBeenCalledWith(5, 10, 'admin');
    });
  });

  describe('moveArchivo()', () => {
    it('debería permitir mover si es owner y tiene acceso a carpeta destino', async () => {
      repo.isArchivoOwner.mockResolvedValue(true);
      repo.getArchivoAclData.mockResolvedValue({ id: 1, owner_id: 10, allowed_roles: ['admin'], allowed_users: [20], allowed_user_names: ['Juan Perez'] });
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(true);
      carpetas.splitPermisosByCarpetaAccess.mockResolvedValue({
        valid_roles: ['admin'],
        invalid_roles: [],
        valid_users: [20],
        invalid_users: [],
      });
      repo.moveArchivoToCarpeta.mockResolvedValue({ ...mockArchivo, id_carpeta: 9 } as any);

      const result = await moveArchivo(1, 9, 10, 'empleado');

      expect(repo.isArchivoOwner).toHaveBeenCalledWith(1, 10);
      expect(carpetas.validateUserCanAccessCarpeta).toHaveBeenCalledWith(9, 10, 'empleado');
      expect(repo.moveArchivoToCarpeta).toHaveBeenCalledWith(1, 9);
      expect(result.archivo.id_carpeta).toBe(9);
    });

    it('debería permitir mover si es admin aunque no sea owner', async () => {
      repo.isArchivoOwner.mockResolvedValue(false);
      repo.getArchivoAclData.mockResolvedValue({ id: 1, owner_id: 10, allowed_roles: ['admin'], allowed_users: [], allowed_user_names: [] });
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(true);
      carpetas.splitPermisosByCarpetaAccess
        .mockResolvedValueOnce({
          valid_roles: [],
          invalid_roles: [],
          valid_users: [10],
          invalid_users: [],
        })
        .mockResolvedValueOnce({
          valid_roles: ['admin'],
          invalid_roles: [],
          valid_users: [],
          invalid_users: [],
        });
      repo.moveArchivoToCarpeta.mockResolvedValue({ ...mockArchivo, id_carpeta: 5 } as any);

      await moveArchivo(1, 5, 44, 'admin');

      expect(repo.moveArchivoToCarpeta).toHaveBeenCalledWith(1, 5);
    });

    it('debería rechazar si el creador no tiene acceso a carpeta destino', async () => {
      repo.isArchivoOwner.mockResolvedValue(false);
      repo.getArchivoAclData.mockResolvedValue({ id: 1, owner_id: 10, allowed_roles: ['admin'], allowed_users: [], allowed_user_names: [] });
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(true);
      carpetas.splitPermisosByCarpetaAccess.mockResolvedValueOnce({
        valid_roles: [],
        invalid_roles: [],
        valid_users: [],
        invalid_users: [10],
      });

      await expect(moveArchivo(1, 5, 44, 'admin')).rejects.toMatchObject({ statusCode: 403 });
      expect(repo.moveArchivoToCarpeta).not.toHaveBeenCalled();
    });

    it('debería rechazar si no es owner ni admin/gerencia', async () => {
      repo.isArchivoOwner.mockResolvedValue(false);

      await expect(moveArchivo(1, 5, 44, 'empleado')).rejects.toMatchObject({ statusCode: 403 });
      expect(repo.moveArchivoToCarpeta).not.toHaveBeenCalled();
    });

    it('debería rechazar si no tiene acceso a carpeta destino', async () => {
      repo.isArchivoOwner.mockResolvedValue(true);
      repo.getArchivoAclData.mockResolvedValue({ id: 1, owner_id: 44, allowed_roles: [], allowed_users: [], allowed_user_names: [] });
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(false);

      await expect(moveArchivo(1, 5, 44, 'empleado')).rejects.toMatchObject({ statusCode: 403 });
    });

    it('debería permitir mover a Sin carpeta sin validar acceso a carpeta destino', async () => {
      repo.isArchivoOwner.mockResolvedValue(true);
      repo.getArchivoAclData.mockResolvedValue({ id: 1, owner_id: 10, allowed_roles: [], allowed_users: [], allowed_user_names: [] });
      repo.moveArchivoToCarpeta.mockResolvedValue({ ...mockArchivo, id_carpeta: null } as any);

      const result = await moveArchivo(1, null, 10, 'empleado');

      expect(carpetas.validateUserCanAccessCarpeta).not.toHaveBeenCalled();
      expect(repo.moveArchivoToCarpeta).toHaveBeenCalledWith(1, null);
      expect(result.archivo.id_carpeta).toBeNull();
    });

    it('debería limpiar ACL inválida al mover', async () => {
      repo.isArchivoOwner.mockResolvedValue(true);
      repo.getArchivoAclData.mockResolvedValue({
        id: 1,
        owner_id: 10,
        allowed_roles: ['admin', 'empleado'],
        allowed_users: [20, 30],
        allowed_user_names: ['Juan Perez', 'Ana Gomez'],
      });
      carpetas.validateUserCanAccessCarpeta.mockResolvedValue(true);
      carpetas.splitPermisosByCarpetaAccess.mockResolvedValue({
        valid_roles: ['admin'],
        invalid_roles: ['empleado'],
        valid_users: [20],
        invalid_users: [30],
      });
      carpetas.getUserDisplayNamesByIds.mockResolvedValue(['Ana Gomez']);
      repo.moveArchivoToCarpeta.mockResolvedValue({ ...mockArchivo, id_carpeta: 5 } as any);

      const result = await moveArchivo(1, 5, 10, 'admin');

      expect(repo.syncArchivoAcl).toHaveBeenCalledWith(1, ['admin'], [20]);
      expect(result.warnings).toBeDefined();
    });
  });

  describe('getArchivoPermisos()', () => {
    it('debería devolver ACL de archivo al owner', async () => {
      repo.getArchivoAclData.mockResolvedValue({
        id: 1,
        owner_id: 10,
        allowed_roles: ['admin'],
        allowed_users: [20],
        allowed_user_names: ['Juan Perez'],
      });

      const result = await getArchivoPermisos(1, 10);

      expect(result.resource_type).toBe('archivo');
      expect(result.allowed_roles).toEqual(['admin']);
      expect(result.allowed_users).toEqual(['Juan Perez']);
    });

    it('debería rechazar ACL si no es owner', async () => {
      repo.getArchivoAclData.mockResolvedValue({
        id: 1,
        owner_id: 11,
        allowed_roles: ['admin'],
        allowed_users: [20],
        allowed_user_names: ['Juan Perez'],
      });

      await expect(getArchivoPermisos(1, 10)).rejects.toMatchObject({ statusCode: 403 });
    });
  });

  describe('patchPermisosArchivo()', () => {
    it('debería remover permisos parciales', async () => {
      repo.getArchivoAclData
        .mockResolvedValueOnce({
          id: 1,
          owner_id: 10,
          allowed_roles: ['admin', 'empleado'],
          allowed_users: [20, 30],
          allowed_user_names: ['Juan Perez', 'Ana Gomez'],
        } as any)
        .mockResolvedValueOnce({
          id: 1,
          owner_id: 10,
          allowed_roles: ['admin'],
          allowed_users: [20],
          allowed_user_names: ['Juan Perez'],
        } as any);
      repo.patchArchivoPermisos.mockResolvedValue(undefined);

      const result = await patchPermisosArchivo(1, { allowed_roles: ['empleado'], ids: [30] }, 10);

      expect(repo.patchArchivoPermisos).toHaveBeenCalledWith(1, ['empleado'], [30]);
      expect(result.allowed_roles).toEqual(['admin']);
      expect(result.allowed_users).toEqual(['Juan Perez']);
    });
  });

  describe('getArchivoViewersService()', () => {
    it('debería devolver viewers cuando el usuario es creador del archivo', async () => {
      const viewers = [
        { user_context_id: 20, nombre: 'Ana', apellido: 'Gomez', visto_en: new Date('2026-04-09T10:00:00.000Z') },
      ];

      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, id: 1, created_by: 10 } as any);
      repo.getArchivoViewersByArchivoId.mockResolvedValue(viewers as any);

      const result = await getArchivoViewersService(1, 10);

      expect(repo.getArchivoViewersByArchivoId).toHaveBeenCalledWith(1);
      expect(result).toEqual(viewers);
    });

    it('debería rechazar con 401 si el usuario no es creador', async () => {
      repo.getArchivoById.mockResolvedValue({ ...mockArchivo, id: 1, created_by: 99 } as any);

      await expect(getArchivoViewersService(1, 10)).rejects.toMatchObject({ statusCode: 401 });
      expect(repo.getArchivoViewersByArchivoId).not.toHaveBeenCalled();
    });

    it('debería rechazar con 404 si el archivo no existe', async () => {
      repo.getArchivoById.mockResolvedValue(null);

      await expect(getArchivoViewersService(999, 10)).rejects.toMatchObject({ statusCode: 404 });
      expect(repo.getArchivoViewersByArchivoId).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── resolveArchivoRecipientsToNotify() ───────────────────────────

  describe('resolveArchivoRecipientsToNotify()', () => {
    it('debería mergear ids por rol y usuarios compartidos, y no consultar ACL previo cuando isUpdate es false', async () => {
      usuarios.getUserIdsByRoles.mockResolvedValue([30]);

      const result = await resolveArchivoRecipientsToNotify(
        ['gerencia'],
        [20, 21],
        [21],
        0,
        false
      );

      expect(usuarios.getUserIdsByRoles).toHaveBeenCalledWith(['gerencia']);
      expect(repo.getArchivoAclData).not.toHaveBeenCalled();
      expect(result.sort()).toEqual([20, 30]);
    });

    it('no debería consultar getUserIdsByRoles si no se envían allowed_roles', async () => {
      const result = await resolveArchivoRecipientsToNotify(
        [],
        [20],
        [],
        0,
        false
      );

      expect(usuarios.getUserIdsByRoles).not.toHaveBeenCalled();
      expect(result).toEqual([20]);
    });

    it('debería excluir a quienes ya tenían acceso (ACL previo) cuando isUpdate es true', async () => {
      usuarios.getUserIdsByRoles
        .mockResolvedValueOnce([30])
        .mockResolvedValueOnce([20]);
      repo.getArchivoAclData.mockResolvedValue({
        id: 1,
        owner_id: 10,
        allowed_roles: ['admin'],
        allowed_users: [20],
        allowed_user_names: ['Ana Gomez'],
      });

      const result = await resolveArchivoRecipientsToNotify(
        ['gerencia'],
        [20, 21],
        [],
        1,
        true
      );

      expect(repo.getArchivoAclData).toHaveBeenCalledWith(1);
      expect(result.sort()).toEqual([21, 30]);
    });

    it('debería devolver array vacío si el archivo no tiene ACL previo y no hay nuevos destinatarios', async () => {
      repo.getArchivoAclData.mockResolvedValue(null);

      const result = await resolveArchivoRecipientsToNotify(
        [],
        [],
        [],
        1,
        true
      );

      expect(result).toEqual([]);
    });
  });
});
