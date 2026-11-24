/**
 * Tests de dominio: reportesServices
 * Capa: Domain Service
 * Plataforma: Interno (RRHH - reportes)
 */

jest.mock('../../adapters/db/reportesRepo');
jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../adapters/db/licenciasRepo');

import * as reportesRepo from '../../adapters/db/reportesRepo';
import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import * as licenciasRepo from '../../adapters/db/licenciasRepo';
import {
  createReporte,
  updateReporte,
  getReportesByUser,
  getReportesRanking,
  getReportesManaged,
  ejecutarSweepAsentadoAutomatico,
} from '../../domain/services/reportesServices';

const mockReportesRepo = jest.mocked(reportesRepo);
const mockUsuariosRepo = jest.mocked(usuariosRepo);
const mockLicenciasRepo = jest.mocked(licenciasRepo);

describe('ReportesServices', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── createReporte ────────────

  describe('createReporte', () => {
    /**
     * CASO: Reporte NEGATIVO se crea con estado PENDIENTE
     * REFERENCIA: Regla de negocio - máquina de estados
     */
    it('debería asignar estado PENDIENTE a reportes negativos', async () => {
      mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue({ rol_nombre: 'empleado' } as any);
      mockReportesRepo.createReporte.mockResolvedValue({ id: 1 } as any);

      await createReporte({
        usuario_reportado_id: 10,
        creador_id: 20,
        titulo: 'Test',
        descripcion: 'Desc',
        categoria: 'NEGATIVO',
        fecha_incidente: new Date(),
      } as any);

      expect(mockReportesRepo.createReporte).toHaveBeenCalledWith(
        expect.objectContaining({ estado: 'PENDIENTE' })
      );
    });

    /**
     * CASO: Reporte positivo se crea con estado ASENTADO
     */
    it('debería asignar estado ASENTADO a reportes no negativos', async () => {
      mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue({ rol_nombre: 'empleado' } as any);
      mockReportesRepo.createReporte.mockResolvedValue({ id: 1 } as any);

      await createReporte({
        usuario_reportado_id: 10,
        creador_id: 20,
        titulo: 'Bien',
        descripcion: 'Desc',
        categoria: 'POSITIVO',
        fecha_incidente: new Date(),
      } as any);

      expect(mockReportesRepo.createReporte).toHaveBeenCalledWith(
        expect.objectContaining({ estado: 'ASENTADO' })
      );
    });

    /**
     * CASO: Solo empleado/encargado puede ser reportado
     */
    it('debería lanzar error si el usuario reportado no tiene rol empleado ni encargado', async () => {
      mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue({ rol_nombre: 'admin' } as any);
      await expect(
        createReporte({
          usuario_reportado_id: 10,
          creador_id: 20,
          titulo: 'T',
          descripcion: 'D',
          categoria: 'NEGATIVO',
          fecha_incidente: new Date(),
        } as any)
      ).rejects.toThrow('Usuario reportado no encontrado');
    });

    it('debería lanzar error si el usuario reportado no existe', async () => {
      mockUsuariosRepo.getUsuarioEntidadByContextId.mockResolvedValue(null as any);
      await expect(
        createReporte({
          usuario_reportado_id: 999,
          creador_id: 20,
          titulo: 'T',
          descripcion: 'D',
          categoria: 'NEGATIVO',
          fecha_incidente: new Date(),
        } as any)
      ).rejects.toThrow('no encontrado');
    });
  });

  // ──────────── updateReporte ────────────

  describe('updateReporte', () => {
    it('debería lanzar error si el reporte no existe', async () => {
      mockReportesRepo.getReporteById.mockResolvedValue(null as any);
      await expect(updateReporte(999, 10, 'admin', { estado: 'ASENTADO' }))
        .rejects.toThrow('no encontrado');
    });

    /**
     * CASO: Reporte bloqueado por gerente no puede modificarse
     * REFERENCIA: Regla de negocio
     */
    it('debería lanzar error si el reporte está bloqueado por gerente', async () => {
      mockReportesRepo.getReporteById.mockResolvedValue({ id: 1 } as any);
      mockReportesRepo.isReporteLockedByManager.mockResolvedValue(true);
      await expect(updateReporte(1, 10, 'admin', { estado: 'ASENTADO' }))
        .rejects.toThrow('gerente');
    });

    /**
     * CASO: Usuario reportado solo puede aceptar
     * REFERENCIA: OWASP API01:2023
     */
    it('debería lanzar error si el reportado intenta cambiar a estado distinto de ASENTADO', async () => {
      mockReportesRepo.getReporteById.mockResolvedValue({
        id: 1,
        usuario_reportado_id: 10,
        estado: 'PENDIENTE',
      } as any);
      mockReportesRepo.isReporteLockedByManager.mockResolvedValue(false);

      await expect(updateReporte(1, 10, 'empleado', { estado: 'DESESTIMADO' }))
        .rejects.toThrow('solo puede aceptar');
    });

    it('debería permitir al reportado aceptar (cambiar a ASENTADO)', async () => {
      mockReportesRepo.getReporteById.mockResolvedValue({
        id: 1,
        usuario_reportado_id: 10,
        estado: 'PENDIENTE',
      } as any);
      mockReportesRepo.isReporteLockedByManager.mockResolvedValue(false);
      mockReportesRepo.updateReporte.mockResolvedValue({ id: 1 } as any);

      await updateReporte(1, 10, 'empleado', { estado: 'ASENTADO' });
      expect(mockReportesRepo.updateReporte).toHaveBeenCalledWith(
        1, 10,
        expect.objectContaining({ tipo_accion: 'ACEPTACION' })
      );
    });

    /**
     * CASO: No cambiar de ASENTADO a otro estado
     */
    it('debería impedir que el reportado cambie un reporte ya ASENTADO', async () => {
      mockReportesRepo.getReporteById.mockResolvedValue({
        id: 1,
        usuario_reportado_id: 10,
        estado: 'ASENTADO',
      } as any);
      mockReportesRepo.isReporteLockedByManager.mockResolvedValue(false);

      await expect(updateReporte(1, 10, 'empleado', { estado: 'PENDIENTE' }))
        .rejects.toThrow('ya está asentado');
    });
  });

  // ──────────── getReportesRanking ────────────

  describe('getReportesRanking', () => {
    /**
     * CASO: El filtro de estado del semáforo solo acota qué usuarios entran
     * en el ranking; se delega enteramente al repo (no cambia la fórmula de zona).
     */
    it('debería pasar el estado al repo', async () => {
      mockReportesRepo.getRankingReportes.mockResolvedValue([] as any);
      await getReportesRanking('PENDIENTE');
      expect(mockReportesRepo.getRankingReportes).toHaveBeenCalledWith('PENDIENTE');
    });

    it('debería pasar undefined si no hay filtro', async () => {
      mockReportesRepo.getRankingReportes.mockResolvedValue([] as any);
      await getReportesRanking();
      expect(mockReportesRepo.getRankingReportes).toHaveBeenCalledWith(undefined);
    });
  });

  // ──────────── getReportesManaged ────────────

  describe('getReportesManaged', () => {
    it('debería lanzar error si la página es inválida', async () => {
      await expect(getReportesManaged(10, { page: 0, pageSize: 20 }))
        .rejects.toThrow('paginación inválidos');
      expect(mockLicenciasRepo.getIdRolByUserContextId).not.toHaveBeenCalled();
    });

    it('debería lanzar error si el pageSize excede el máximo permitido', async () => {
      await expect(getReportesManaged(10, { page: 1, pageSize: 51 }))
        .rejects.toThrow('paginación inválidos');
    });

    it('debería lanzar error si no se pudo determinar el rol del usuario', async () => {
      mockLicenciasRepo.getIdRolByUserContextId.mockResolvedValue(null);
      await expect(getReportesManaged(10, { page: 1, pageSize: 20 }))
        .rejects.toThrow('rol del usuario');
    });

    /**
     * CASO: Jerarquía - el encargado solo ve reportes de subordinados
     * REFERENCIA: mismo criterio que getReportesPendingForManager (u.id_rol > roleId)
     */
    it('debería resolver el roleId del solicitante y calcular el offset', async () => {
      mockLicenciasRepo.getIdRolByUserContextId.mockResolvedValue(3);
      mockReportesRepo.getReportesManaged.mockResolvedValue({ data: [{ id: 1 }], total: 41 } as any);

      const result = await getReportesManaged(10, { page: 3, pageSize: 20, estado: 'DISPUTA' });

      expect(mockReportesRepo.getReportesManaged).toHaveBeenCalledWith({
        roleId: 3,
        estado: 'DISPUTA',
        limit: 20,
        offset: 40,
      });
      expect(result).toEqual({ data: [{ id: 1 }], total: 41, page: 3, pageSize: 20 });
    });

    /**
     * CASO: Filtro adicional por rol del reportado (p.ej. "empleado-super"),
     * acotando dentro de lo que la jerarquía ya le permite ver al solicitante.
     */
    it('debería pasar el filtro opcional de rol al repositorio', async () => {
      mockLicenciasRepo.getIdRolByUserContextId.mockResolvedValue(3);
      mockReportesRepo.getReportesManaged.mockResolvedValue({ data: [], total: 0 } as any);

      await getReportesManaged(10, { page: 1, pageSize: 20, rol: 'empleado-super' });

      expect(mockReportesRepo.getReportesManaged).toHaveBeenCalledWith({
        roleId: 3,
        rol: 'empleado-super',
        estado: undefined,
        limit: 20,
        offset: 0,
      });
    });
  });

  // ──────────── ejecutarSweepAsentadoAutomatico ────────────

  describe('ejecutarSweepAsentadoAutomatico', () => {
    it('debería devolver la cantidad de reportes asentados por el repositorio', async () => {
      mockReportesRepo.asentarReportesPendientesVencidos.mockResolvedValue(4);

      const result = await ejecutarSweepAsentadoAutomatico();

      expect(mockReportesRepo.asentarReportesPendientesVencidos).toHaveBeenCalled();
      expect(result).toBe(4);
    });
  });
});
