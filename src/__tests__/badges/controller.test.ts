/**
 * Tests de controllers: badgesController (GET /badges/prefetch)
 * Capa: Controller
 * Plataforma: Interna (badges del tab bar)
 */

jest.mock('../../domain/services/solicitudesServices');
jest.mock('../../domain/services/archivosServices');
jest.mock('../../domain/services/licenciasServices');
jest.mock('../../domain/services/reportesServices');

import * as solicitudesServices from '../../domain/services/solicitudesServices';
import * as archivosServices from '../../domain/services/archivosServices';
import * as licenciasServices from '../../domain/services/licenciasServices';
import * as reportesServices from '../../domain/services/reportesServices';
import { getPrefetchBadges } from '../../controllers/badgesController';
import { createMockReqRes } from '../helpers/testHelpers';

const solicitudes = jest.mocked(solicitudesServices);
const archivos = jest.mocked(archivosServices);
const licencias = jest.mocked(licenciasServices);
const reportes = jest.mocked(reportesServices);

function mockAllCounts() {
  solicitudes.getSolicitudesUnseenByUserService.mockImplementation(async (_userId, type) =>
    type === 'CHAT' ? 4 : 2,
  );
  archivos.fetchArchivosUnseenByUserService.mockResolvedValue(5);
  licencias.getSolicitudesPendingByUser.mockResolvedValue(1);
  licencias.getSolicitudesUnseenByUser.mockResolvedValue(3);
  reportes.getReportesPendingByUser.mockResolvedValue(6);
  reportes.getReportesPendingForManager.mockResolvedValue(7);
}

describe('getPrefetchBadges', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAllCounts();
  });

  it('devuelve 401 sin usuario autenticado', async () => {
    const { req, res, next } = createMockReqRes({});
    await getPrefetchBadges(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('separa solicitudes (sin chats) de chats con el mismo servicio que GET /solicitudes/unseen', async () => {
    const { req, res, next } = createMockReqRes({ user: { userContextId: 10, role: 'empleado' } });
    await getPrefetchBadges(req, res, next);

    expect(solicitudes.getSolicitudesUnseenByUserService).toHaveBeenCalledWith(10);
    expect(solicitudes.getSolicitudesUnseenByUserService).toHaveBeenCalledWith(10, 'CHAT');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ solicitudes: 2, chats: 4, documentos: 5, errors: [] }),
    );
  });

  it('no calcula los contadores "managed" para roles que no son de gestión', async () => {
    const { req, res, next } = createMockReqRes({ user: { userContextId: 10, role: 'empleado' } });
    await getPrefetchBadges(req, res, next);

    expect(licencias.getSolicitudesUnseenByUser).not.toHaveBeenCalled();
    expect(reportes.getReportesPendingForManager).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        licencias: { mine: 1, managed: null },
        reportes: { mine: 6, managed: null },
      }),
    );
  });

  it('incluye los contadores "managed" para roles de gestión', async () => {
    const { req, res, next } = createMockReqRes({ user: { userContextId: 10, role: 'encargado' } });
    await getPrefetchBadges(req, res, next);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        licencias: { mine: 1, managed: 3 },
        reportes: { mine: 6, managed: 7 },
      }),
    );
  });

  it('si falla un módulo devuelve null en ese campo y el error, sin tirar el resto', async () => {
    solicitudes.getSolicitudesUnseenByUserService.mockImplementation(async (_userId, type) => {
      if (type === 'CHAT') throw new Error('chats caído');
      return 2;
    });
    const { req, res, next } = createMockReqRes({ user: { userContextId: 10, role: 'empleado' } });
    await getPrefetchBadges(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ solicitudes: 2, chats: null, documentos: 5, errors: ['chats caído'] }),
    );
  });
});
