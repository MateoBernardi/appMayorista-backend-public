jest.mock('../../domain/services/carpetasServices');

import * as carpetasService from '../../domain/services/carpetasServices';
import {
  createCarpetaController,
  updateCarpetaController,
  deleteCarpetaController,
  getCarpetaPermisosController,
  getVisibleCarpetasController,
  patchCarpetaPermisosController,
} from '../../controllers/carpetasControllers';
import { createMockReqRes } from '../helpers/testHelpers';

const service = jest.mocked(carpetasService);

describe('Carpetas Controllers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deberia retornar 401 al crear si no hay usuario', async () => {
    const { req, res, next } = createMockReqRes({ body: { nombre: 'Legal' }, user: {} });

    await createCarpetaController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('deberia crear carpeta con 201', async () => {
    service.addCarpeta.mockResolvedValue({ id: 1, nombre: 'Legal' } as any);
    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'admin' },
      body: { nombre: 'Legal', allowed_roles: ['admin'], usuarios_id: [20] },
    });

    await createCarpetaController(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(service.addCarpeta).toHaveBeenCalledWith(
      expect.objectContaining({ id_usuario: 10, nombre: 'Legal' }),
      'admin',
    );
  });

  it('deberia retornar 400 si id invalido al editar', async () => {
    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'admin' },
      params: { id: 'abc' },
    });

    await updateCarpetaController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('deberia editar carpeta con 200', async () => {
    service.editCarpeta.mockResolvedValue({ carpeta: { id: 1, nombre: 'RRHH' } } as any);
    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'admin' },
      params: { id: '1' },
      body: { nombre: 'RRHH', allowed_roles: ['admin'], usuarios_id: [20] },
    });

    await updateCarpetaController(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(service.editCarpeta).toHaveBeenCalledWith(1, expect.any(Object), 10, 'admin');
  });

  it('deberia retornar 207 al editar carpeta con warnings', async () => {
    service.editCarpeta.mockResolvedValue({
      carpeta: { id: 1, nombre: 'RRHH' },
      warnings: { invalid_roles: ['empleado'], invalid_users: ['Juan Perez'], reason: 'x' },
    } as any);
    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'admin' },
      params: { id: '1' },
      body: { nombre: 'RRHH' },
    });

    await updateCarpetaController(req, res, next);

    expect(res.status).toHaveBeenCalledWith(207);
  });

  it('deberia eliminar carpeta con 200', async () => {
    service.removeCarpeta.mockResolvedValue({ id: 1 });
    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'admin' },
      params: { id: '1' },
    });

    await deleteCarpetaController(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(service.removeCarpeta).toHaveBeenCalledWith(1, 10, 'admin');
  });

  it('deberia listar carpetas visibles con 200', async () => {
    service.listVisibleCarpetas.mockResolvedValue({
      view: 'tree',
      items: [{ id: null, nombre: 'Sin carpeta', type: 'virtual', children: [] }],
    } as any);

    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'gerencia' },
      query: { view: 'tree', includeSinCarpeta: 'true' },
    });

    await getVisibleCarpetasController(req, res, next);

    expect(service.listVisibleCarpetas).toHaveBeenCalledWith(10, 'gerencia', 'tree', true);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deberia devolver permisos de carpeta con 200', async () => {
    service.getCarpetaPermisos.mockResolvedValue({
      resource_type: 'carpeta',
      resource_id: 1,
      owner_id: 10,
      allowed_roles: ['admin'],
      allowed_users: ['Juan Perez'],
    });
    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'admin' },
      params: { id: '1' },
    });

    await getCarpetaPermisosController(req, res, next);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(service.getCarpetaPermisos).toHaveBeenCalledWith(1);
  });

  it('deberia patch permisos de carpeta con 200', async () => {
    service.patchPermisosCarpeta.mockResolvedValue({
      resource_type: 'carpeta',
      resource_id: 1,
      owner_id: 10,
      allowed_roles: ['admin'],
      allowed_users: ['Juan Perez'],
    });
    const { req, res, next } = createMockReqRes({
      user: { userContextId: 10, role: 'admin' },
      params: { id: '1' },
      body: { allowed_roles: ['empleado'], ids: [20] },
    });

    await patchCarpetaPermisosController(req, res, next);

    expect(service.patchPermisosCarpeta).toHaveBeenCalledWith(1, { allowed_roles: ['empleado'], ids: [20] }, 10, 'admin');
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
