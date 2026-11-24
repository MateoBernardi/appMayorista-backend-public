jest.mock('../../domain/services/informesServices');

import * as service from '../../domain/services/informesServices';
import { NotFoundError } from '../../adapters/errors/AppError';
import {
  agregarAdjuntoController,
  agregarEntradaController,
  editarEntradaController,
  getInformeController,
  listInformesEmpleadoController,
  listarVistosEntradaController,
  marcarInformeVistoController,
  quitarAdjuntoController,
} from '../../controllers/informesControllers';
import { createMockReqRes } from '../helpers/testHelpers';

const mockService = jest.mocked(service);

describe('informes controllers', () => {
  beforeEach(() => jest.resetAllMocks());

  it('GET /:id/entradas pasa el 404 al errorHandler', async () => {
    mockService.obtenerInforme.mockRejectedValue(new NotFoundError('Informe no encontrado.'));
    const { req, res, next } = createMockReqRes({ params: { id: 'x' }, user: { userContextId: 5 } });
    await getInformeController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('GET /:id/entradas?empleado exige rol de management', async () => {
    const { req, res, next } = createMockReqRes({
      params: { id: 'x' },
      query: { empleado: '9' },
      user: { userContextId: 5, role: 'ventas' },
    });
    await getInformeController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    expect(mockService.obtenerInforme).not.toHaveBeenCalled();
  });

  it('GET /:id/entradas?empleado lo pasa al servicio si es management', async () => {
    mockService.obtenerInforme.mockResolvedValue({ informe_id: 'x' } as any);
    const { req, res, next } = createMockReqRes({
      params: { id: 'x' },
      query: { empleado: '9' },
      user: { userContextId: 5, role: 'gerencia' },
    });
    await getInformeController(req, res, next);
    expect(mockService.obtenerInforme).toHaveBeenCalledWith('x', 5, 9);
  });

  it('GET /empleado/:empleadoId lista las menciones del empleado', async () => {
    mockService.listarInformes.mockResolvedValue({ informes: [], nextCursor: null });
    const { req, res, next } = createMockReqRes({
      params: { empleadoId: '9' },
      query: { antes: undefined },
      user: { userContextId: 5, role: 'gerencia' },
    });
    await listInformesEmpleadoController(req, res, next);
    expect(mockService.listarInformes).toHaveBeenCalledWith(5, undefined, 9);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('POST /:id/entradas responde 201', async () => {
    mockService.agregarEntradaInforme.mockResolvedValue({ id: '1' } as any);
    const { req, res, next } = createMockReqRes({
      params: { id: 'h' },
      body: { cuerpo: '<p>x</p>' },
      user: { userContextId: 5, role: 'encargado' },
    });
    await agregarEntradaController(req, res, next);
    expect(mockService.agregarEntradaInforme).toHaveBeenCalledWith('h', 5, '<p>x</p>', false);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('POST /:id/entradas habilita a gerencia a escribir sin participar', async () => {
    mockService.agregarEntradaInforme.mockResolvedValue({ id: '1' } as any);
    const { req, res, next } = createMockReqRes({
      params: { id: 'h' },
      body: { cuerpo: '<p>x</p>' },
      user: { userContextId: 5, role: 'gerencia' },
    });
    await agregarEntradaController(req, res, next);
    expect(mockService.agregarEntradaInforme).toHaveBeenCalledWith('h', 5, '<p>x</p>', true);
  });

  it('PATCH valida entradaId numérico', async () => {
    const { req, res, next } = createMockReqRes({
      params: { id: 'h', entradaId: 'abc' },
      user: { userContextId: 5 },
    });
    await editarEntradaController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
  });

  it('POST adjuntos responde 201 con el nombre opcional', async () => {
    mockService.agregarAdjunto.mockResolvedValue({ id: '9' } as any);
    const file = { originalname: 'a.png' };
    const { req, res, next } = createMockReqRes({
      params: { id: 'h', entradaId: '3' },
      body: { nombre: 'foto.png' },
      file,
      user: { userContextId: 5 },
    });
    await agregarAdjuntoController(req, res, next);
    expect(mockService.agregarAdjunto).toHaveBeenCalledWith('h', 3, 5, file, 'foto.png', undefined);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('DELETE adjunto responde 200 con success', async () => {
    mockService.quitarAdjunto.mockResolvedValue(undefined);
    const { req, res, next } = createMockReqRes({
      params: { id: 'h', entradaId: '3', adjuntoId: '9' },
      user: { userContextId: 5 },
    });
    await quitarAdjuntoController(req, res, next);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('401 si falta el contexto de usuario', async () => {
    const { req, res, next } = createMockReqRes({ params: { id: 'h' } });
    await getInformeController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('PUT /:id/visto marca con el usuario autenticado', async () => {
    mockService.marcarInformeVisto.mockResolvedValue({ marcadas: 2 });
    const { req, res, next } = createMockReqRes({ params: { id: 'x' }, user: { userContextId: 5 } });
    await marcarInformeVistoController(req, res, next);
    expect(mockService.marcarInformeVisto).toHaveBeenCalledWith('x', 5);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('GET /:id/entradas/:entradaId/vistos valida el id de la entrada', async () => {
    const { req, res, next } = createMockReqRes({ params: { id: 'x', entradaId: 'abc' }, user: { userContextId: 5 } });
    await listarVistosEntradaController(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(mockService.listarVistosEntrada).not.toHaveBeenCalled();
  });
});
