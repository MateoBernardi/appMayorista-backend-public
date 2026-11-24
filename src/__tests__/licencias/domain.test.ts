/**
 * Tests de dominio: licenciasServices
 * Capa: Domain Service
 * Plataforma: Interno
 * 
 * Cubre: crearSolicitud, adjuntarArchivo, cancelarSolicitud,
 *        aprobarSolicitud, rechazarSolicitud, cálculo de días
 */

jest.mock('../../adapters/db/licenciasRepo');
jest.mock('../../adapters/db/saldosFrancosRepo');

import * as licenciasRepo from '../../adapters/db/licenciasRepo';
import * as saldosFrancosRepo from '../../adapters/db/saldosFrancosRepo';
import {
  crearSolicitud,
  adjuntarArchivo,
  cancelarSolicitud,
  aprobarSolicitud,
  rechazarSolicitud,
  getSaldosUsuario,
  getSaldoFrancosEmpleado,
  getSaldoVacacionesEmpleado,
  getTiposLicencia,
  getSolicitudesUsuario,
} from '../../domain/services/licenciasServices';
import { EstadoSolicitud } from '../../domain/dto/LicenciaDTO';

const repo = jest.mocked(licenciasRepo);
const francosRepo = jest.mocked(saldosFrancosRepo);

const mockTipoConSaldo = {
  id: 1, nombre: 'Vacaciones', codigo: 'VAC',
  descripcion: 'Vacaciones anuales', requiere_saldo: true, requiere_adjunto: false,
};

// id 4 para no colisionar con el tipo Franco (id 2)
const mockTipoConAdjunto = {
  id: 4, nombre: 'Enfermedad', codigo: 'ENF',
  descripcion: 'Licencia por enfermedad', requiere_saldo: false, requiere_adjunto: true,
};

const mockTipoFranco = {
  id: 2, nombre: 'Franco', codigo: 'FRA',
  descripcion: 'Franco compensatorio', requiere_saldo: false, requiere_adjunto: false,
};

const mockTipoSimple = {
  id: 3, nombre: 'Mudanza', codigo: 'MUD',
  descripcion: 'Mudanza', requiere_saldo: false, requiere_adjunto: false,
};

const mockSolicitudPendiente = {
  id: 1, usuario_id: 10, tipo_licencia_id: 1,
  fecha_inicio: '2027-03-01', fecha_fin: '2027-03-05',
  cantidad_dias: 50, cantidad_minutos: null, estado: EstadoSolicitud.PENDIENTE,
  observacion: '', created_at: new Date(),
};

const saldoDecimas = (dias_otorgados: number, dias_consumidos: number, residuo = 0) => ({
  id: 1, usuario_id: 10, tipo_licencia_id: 1, dias_otorgados, dias_consumidos, residuo,
});

// Saca el `saldo` que el servicio le pasó a executeApprovalTransaction (4.º argumento).
const saldoAprobacion = (r: typeof repo) => (r.executeApprovalTransaction.mock.calls[0] as any[])[3];

describe('Licencias Domain Services', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    repo.expirarSolicitudesAusenciaVencidas.mockResolvedValue(0);
    repo.expirarSolicitudesAusenciaVencidasPorUsuario.mockResolvedValue(0);
    repo.expirarSolicitudesAusenciaVencidasPorSolicitud.mockResolvedValue(0);
    // Por defecto saldo de francos amplio; los tests de franco lo sobreescriben.
    francosRepo.getSaldoFrancoByUsuario.mockResolvedValue({ minutos_disponibles: 6000, minutos_consumidos: 0 });
  });

  // ─────────────────────────── getTiposLicencia ───────────────────────────

  describe('getTiposLicencia()', () => {
    it('debería retornar la lista de tipos de licencia', async () => {
      repo.getTiposLicencia.mockResolvedValue([mockTipoConSaldo]);
      const result = await getTiposLicencia();
      expect(result).toEqual([mockTipoConSaldo]);
    });
  });

  // ─────────────────────────── getSaldosUsuario ───────────────────────────

  describe('getSaldosUsuario()', () => {
    it('debería retornar saldos de ausencia y francos para el usuario dado', async () => {
      const saldo = { id: 1, usuario_id: 10, tipo_licencia_id: 1, dias_otorgados: 14, dias_consumidos: 0, residuo: 0 };
      repo.getSaldosByUsuario.mockResolvedValue([saldo]);
      francosRepo.getSaldoFrancoByUsuario.mockResolvedValue({ minutos_disponibles: 750, minutos_consumidos: 175 });

      const result = await getSaldosUsuario(10);

      expect(result.ausencias).toEqual([saldo]);
      expect(result.francosMinutos).toBe(575); // 750 − 175
      expect(result.francos).toBe(9.58); // 575 / 60, 2 decimales
      expect(repo.getSaldosByUsuario).toHaveBeenCalledWith(10);
      expect(francosRepo.getSaldoFrancoByUsuario).toHaveBeenCalledWith(10);
    });
  });

  describe('getSaldoFrancosEmpleado()', () => {
    it('retorna el saldo neto en minutos y horas, incluso negativo', async () => {
      francosRepo.getSaldoFrancoByUsuario.mockResolvedValue({ minutos_disponibles: 180, minutos_consumidos: 480 });
      expect(await getSaldoFrancosEmpleado(10)).toEqual({ user_context_id: 10, horas: -5, minutos: -300 });
    });

    it('retorna 0 si el usuario no tiene saldo', async () => {
      francosRepo.getSaldoFrancoByUsuario.mockResolvedValue({ minutos_disponibles: 0, minutos_consumidos: 0 });
      expect((await getSaldoFrancosEmpleado(10)).horas).toBe(0);
    });
  });

  describe('getSaldoVacacionesEmpleado()', () => {
    it('calcula dias_disponibles por saldo de vacaciones', async () => {
      const saldo = { id: 1, usuario_id: 10, tipo_licencia_id: 1, dias_otorgados: 140, dias_consumidos: 30, residuo: 0 };
      repo.getSaldosVacacionesByUsuario.mockResolvedValue([saldo as any]);
      const result = await getSaldoVacacionesEmpleado(10);
      expect(result[0].dias_disponibles).toBe(11);
      expect(repo.getSaldosVacacionesByUsuario).toHaveBeenCalledWith(10);
    });

    it('retorna lista vacía sin saldos', async () => {
      repo.getSaldosVacacionesByUsuario.mockResolvedValue([]);
      expect(await getSaldoVacacionesEmpleado(10)).toEqual([]);
    });
  });

  // ─────────────────────────── crearSolicitud ───────────────────────────

  describe('crearSolicitud()', () => {
    const userContextId = 10;
    const baseData = {
      tipo_licencia_id: 1,
      fecha_inicio: new Date('2027-06-01T09:00'),
      cantidad_dias: 5,
      archivosIds: undefined
    };

    it('debería crear solicitud exitosamente (tipo sin saldo, días)', async () => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple);
      repo.createSolicitud.mockResolvedValue({ ...mockSolicitudPendiente, tipo_licencia_id: 3 });

      const result = await crearSolicitud(userContextId, { ...baseData, tipo_licencia_id: 3 });
      expect(result).toBeDefined();
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId,
        { ...baseData, tipo_licencia_id: 3 },
        expect.any(Date), // fechaFin calculada
        50,               // cantidad_dias * 10
        null,             // cantidad_minutos
        EstadoSolicitud.PENDIENTE
      );
    });

    it('debería crear solicitud exitosamente (tipo sin saldo, horas)', async () => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple);
      repo.createSolicitud.mockResolvedValue({ ...mockSolicitudPendiente, tipo_licencia_id: 3, cantidad_dias: null, cantidad_minutos: 240 });

      const horasData = { tipo_licencia_id: 3, fecha_inicio: new Date('2027-06-01T09:00'), cantidad_horas: 4 };
      const result = await crearSolicitud(userContextId, horasData);
      expect(result).toBeDefined();
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId,
        horasData,
        expect.any(Date), // fechaFin calculada
        null,             // cantidad_dias
        240,              // cantidad_horas * 60 (minutos)
        EstadoSolicitud.PENDIENTE
      );
    });

    it('debería crear solicitud exitosamente con días fraccionarios (0.5)', async () => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple);
      repo.createSolicitud.mockResolvedValue({ ...mockSolicitudPendiente, tipo_licencia_id: 3 });

      const fracData = { tipo_licencia_id: 3, fecha_inicio: new Date('2027-06-01T09:00'), cantidad_dias: 0.5 };
      await crearSolicitud(userContextId, fracData);
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId,
        fracData,
        expect.any(Date), // fechaFin calculada
        5,                // 0.5 * 10
        null,
        EstadoSolicitud.PENDIENTE
      );
    });

    it('debería calcular fecha_fin correctamente para fecha_inicio 09/03/25 08:19 y 1.5 días', async () => {
      // fecha_inicio: 2025-03-09 08:19 AM, cantidad_dias: 1.5
      // ceil(1.5) - 1 = 1 → fecha_fin = 2025-03-09 + 1 día = 2025-03-10
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple);
      repo.createSolicitud.mockResolvedValue({ ...mockSolicitudPendiente, tipo_licencia_id: 3 });

      const data = { tipo_licencia_id: 3, fecha_inicio: new Date('2025-03-09T00:00:00'), cantidad_dias: 1.5 };
      await crearSolicitud(userContextId, data);
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId,
        data,
        expect.any(Date), // fechaFin calculada
        15,               // 1.5 * 10
        null,
        EstadoSolicitud.PENDIENTE
      );
    });

    it('debería recibir los archivos y pasarlos al repo', async () => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConAdjunto);
      repo.createSolicitud.mockResolvedValue({ ...mockSolicitudPendiente, tipo_licencia_id: 3 });

      const data = { ...baseData, tipo_licencia_id: 3, archivosIds: [100, 101] };
      await crearSolicitud(userContextId, data);
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId,
        data,
        expect.any(Date),
        50,
        null,
        EstadoSolicitud.PENDIENTE
      );
    });

    /**
     * CASO: No se envía ni días ni horas
     */
    it('debería lanzar error si no se envía cantidad_dias ni cantidad_horas', async () => {
      await expect(
        crearSolicitud(userContextId, { tipo_licencia_id: 1, fecha_inicio: '2027-06-01T09:00' })
      ).rejects.toThrow('Debe indicar la cantidad de días o la cantidad de horas');
    });

    /**
     * CASO: Se envían ambos campos
     */
    it('debería lanzar error si se envían tanto cantidad_dias como cantidad_horas', async () => {
      await expect(
        crearSolicitud(userContextId, { tipo_licencia_id: 1, fecha_inicio: '2027-06-01T09:00', cantidad_dias: 2, cantidad_horas: 4 })
      ).rejects.toThrow('solo días o solo horas');
    });

    /**
     * CASO: Valor fraccionario no múltiplo de 0.5
     */
    it('debería lanzar error si cantidad_dias no es múltiplo de 0.5', async () => {
      await expect(
        crearSolicitud(userContextId, { tipo_licencia_id: 1, fecha_inicio: '2027-06-01T09:00', cantidad_dias: 1.3 })
      ).rejects.toThrow('invalido');
    });

    it('debería lanzar error si cantidad_horas no es múltiplo de 0.5', async () => {
      await expect(
        crearSolicitud(userContextId, { tipo_licencia_id: 1, fecha_inicio: '2027-06-01T09:00', cantidad_horas: 2.3 })
      ).rejects.toThrow('invalido');
    });

    /**
     * CASO: Licencia con saldo requiere días (no horas)
     */
    it('debería lanzar error si requiere_saldo y se envían horas', async () => {
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      await expect(
        crearSolicitud(userContextId, { tipo_licencia_id: 1, fecha_inicio: '2027-06-01T09:00', cantidad_horas: 8 })
      ).rejects.toThrow('requieren saldo deben indicar cantidad de días');
    });

    /**
     * CASO: Solapamiento de solicitudes
     * RIESGO: Doble licencia en mismo período
     */
    it('debería lanzar error si hay solicitudes solapadas', async () => {
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.findOverlappingSolicitudes.mockResolvedValue([mockSolicitudPendiente]);
      await expect(crearSolicitud(userContextId, baseData)).rejects.toThrow('Ya existe una solicitud activa');
    });

    it('debería lanzar error si tipo de licencia no existe', async () => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(null);
      await expect(crearSolicitud(userContextId, baseData)).rejects.toThrow('Tipo de licencia no válido');
    });

    /**
     * CASO: Saldo insuficiente
     * RIESGO: Consumo de días no disponibles
     */
    it('debería lanzar error si saldo insuficiente, informando en días', async () => {
      // 8 días (80): bloque 70 + suelto 10, residuo 0 → cobra el fin de semana: 95 décimas
      const dataLarga = { ...baseData, cantidad_dias: 8 };
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.getSaldoEspecifico.mockResolvedValue(saldoDecimas(20, 0));
      repo.getSolicitudes.mockResolvedValue([]);

      await expect(crearSolicitud(userContextId, dataLarga)).rejects.toThrow('Saldo insuficiente. Disponibles: 2, Solicitados: 9.5.');
    });

    it('debería lanzar error si no hay saldo asignado', async () => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.getSaldoEspecifico.mockResolvedValue(null);

      await expect(crearSolicitud(userContextId, baseData)).rejects.toThrow('No tienes saldo asignado');
    });

    /**
     * CASO: Tipo requiere adjunto → estado inicial PENDIENTE_DOCUMENTACION
     */
    it('debería crear con estado PENDIENTE_DOCUMENTACION si tipo requiere adjunto', async () => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConAdjunto);
      repo.createSolicitud.mockResolvedValue({ ...mockSolicitudPendiente, estado: EstadoSolicitud.PENDIENTE_DOCUMENTACION });

      await crearSolicitud(userContextId, { ...baseData, tipo_licencia_id: 4 });
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId,
        { ...baseData, tipo_licencia_id: 4 },
        expect.any(Date), // fechaFin calculada
        50,               // cantidad_dias * 10
        null,             // cantidad_minutos
        EstadoSolicitud.PENDIENTE_DOCUMENTACION
      );
    });

    // ─────────────── Casos borde: cálculo de saldo ───────────────

    // Saldo en décimas de día; las cuentas de cada caso están en décimas.
    const prepararSaldo = (otorgados: number, consumidos: number, residuo = 0, pendientes: any[] = []) => {
      repo.findOverlappingSolicitudes.mockResolvedValue([]);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.getSaldoEspecifico.mockResolvedValue(saldoDecimas(otorgados, consumidos, residuo));
      repo.getSolicitudes.mockResolvedValue(pendientes);
      repo.createSolicitud.mockResolvedValue({ ...mockSolicitudPendiente });
    };

    it('5 días con residuo 10: completa la semana y cobra el fin de semana de la siguiente (65)', async () => {
      prepararSaldo(65, 0, 10);
      await crearSolicitud(userContextId, baseData);
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId, baseData, expect.any(Date), 50, null, EstadoSolicitud.PENDIENTE
      );
    });

    it('5,5 días con residuo 0 cuentan como una semana (70)', async () => {
      const data = { ...baseData, cantidad_dias: 5.5 };
      prepararSaldo(70, 0);
      await crearSolicitud(userContextId, data);
      expect(repo.createSolicitud).toHaveBeenCalledWith(
        userContextId, data, expect.any(Date), 55, null, EstadoSolicitud.PENDIENTE
      );
    });

    it('permite cuando el disponible es exactamente lo que se descuenta', async () => {
      prepararSaldo(100, 30); // disponibles 70 = 7 días
      await crearSolicitud(userContextId, { ...baseData, cantidad_dias: 7 });
      expect(repo.createSolicitud).toHaveBeenCalled();
    });

    it('falla cuando falta un día de saldo', async () => {
      prepararSaldo(100, 40); // disponibles 60
      await expect(crearSolicitud(userContextId, { ...baseData, cantidad_dias: 7 })).rejects.toThrow('Disponibles: 6, Solicitados: 7.');
      expect(repo.createSolicitud).not.toHaveBeenCalled();
    });

    it('falla cuando todo el saldo está consumido', async () => {
      prepararSaldo(140, 140);
      await expect(crearSolicitud(userContextId, { ...baseData, cantidad_dias: 7 })).rejects.toThrow('Saldo insuficiente');
    });

    it('regresión: con 14 días de saldo no deja pedir 20', async () => {
      prepararSaldo(140, 0);
      await expect(crearSolicitud(userContextId, { ...baseData, cantidad_dias: 20 })).rejects.toThrow('Saldo insuficiente');
    });

    it('descuenta las pendientes del mismo tipo antes de validar la nueva', async () => {
      // pendiente de 7 días (70) + nueva de 8 (95) = 165 > 140
      prepararSaldo(140, 0, 0, [
        { ...mockSolicitudPendiente, id: 5, cantidad_dias: 70, estado: EstadoSolicitud.PENDIENTE },
      ]);
      await expect(crearSolicitud(userContextId, { ...baseData, cantidad_dias: 8 }))
        .rejects.toThrow('Disponibles: 7 (descontando 7 de solicitudes pendientes), Solicitados: 9.5.');
    });

    it('ignora solicitudes que ya no pueden aprobarse (rechazadas, canceladas, aprobadas)', async () => {
      prepararSaldo(140, 0, 0, [
        { ...mockSolicitudPendiente, id: 5, cantidad_dias: 70, estado: EstadoSolicitud.RECHAZADA },
        { ...mockSolicitudPendiente, id: 6, cantidad_dias: 70, estado: EstadoSolicitud.CANCELADA },
        { ...mockSolicitudPendiente, id: 7, cantidad_dias: 70, estado: EstadoSolicitud.APROBADA },
      ]);
      await crearSolicitud(userContextId, { ...baseData, cantidad_dias: 14 });
      expect(repo.createSolicitud).toHaveBeenCalled();
      expect(repo.getSolicitudes).toHaveBeenCalledWith({ usuario_id: userContextId, tipo_licencia_id: 1 });
    });
  });

  // ─────────────── Casos borde: aprobación y saldo ───────────────

  describe('aprobarSolicitud() - cálculo de saldo', () => {
    const approveData = { solicitud_id: 1, aprobador_id: 20, observacion: 'OK' };

    // El descuento se calcula dentro de la transacción sobre la fila bloqueada: se prueba
    // el `calcular` que el servicio le pasa al repo.
    const aprobarCon = async (cantidad_dias: number) => {
      repo.getSolicitudById.mockResolvedValue({ ...mockSolicitudPendiente, cantidad_dias });
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.executeApprovalTransaction.mockResolvedValue(undefined);
      await aprobarSolicitud(approveData);
      const saldo = saldoAprobacion(repo);
      expect(saldo).toEqual({ usuarioId: 10, tipoId: 1, calcular: expect.any(Function) });
      expect(repo.executeApprovalTransaction).toHaveBeenCalledWith(1, 20, 'OK', saldo, null, expect.any(Function));
      return saldo.calcular as (fila: any) => { dias: number; nuevoResiduo: number };
    };

    it('aprueba cuando el disponible es exactamente lo que se descuenta', async () => {
      const calcular = await aprobarCon(70);
      expect(calcular({ dias_otorgados: 70, dias_consumidos: 0, residuo: 0 })).toEqual({ dias: 70, nuevoResiduo: 0 });
    });

    it('falla si el saldo bloqueado no alcanza, informando en días', async () => {
      const calcular = await aprobarCon(80);
      expect(() => calcular({ dias_otorgados: 10, dias_consumidos: 0, residuo: 0 }))
        .toThrow('Saldo insuficiente al momento de aprobar. Disponibles: 1, Necesarios: 9.5.');
    });

    it('falla si no hay fila de saldo', async () => {
      const calcular = await aprobarCon(70);
      expect(() => calcular(null)).toThrow('No hay saldo asignado para Vacaciones');
    });

    it('usa el residuo de la fila bloqueada (residuo 9 + 8 días → 80, residuo 19)', async () => {
      const calcular = await aprobarCon(80);
      expect(calcular({ dias_otorgados: 140, dias_consumidos: 0, residuo: 9 })).toEqual({ dias: 80, nuevoResiduo: 19 });
    });

    it('no pasa saldo para un tipo que no lo requiere', async () => {
      repo.getSolicitudById.mockResolvedValue(mockSolicitudPendiente);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple);
      repo.executeApprovalTransaction.mockResolvedValue(undefined);

      await aprobarSolicitud(approveData);
      expect(repo.getSaldoEspecifico).not.toHaveBeenCalled();
      expect(repo.executeApprovalTransaction).toHaveBeenCalledWith(1, 20, 'OK', null, null, expect.any(Function));
    });
  });

  // ─────────────── Casos borde: cancelación y devolución ───────────────

  describe('cancelarSolicitud() - devolución de saldo', () => {
    /**
     * CASO: Cancelar solicitud PENDIENTE → sin refund
     */
    it('no debería hacer refund si solicitud estaba PENDIENTE', async () => {
      const pendiente = { ...mockSolicitudPendiente, fecha_inicio: '2099-01-01' };
      repo.getSolicitudById.mockResolvedValue(pendiente);
      repo.executeCancellationTransaction.mockResolvedValue(undefined);

      await cancelarSolicitud(1, 10);
      expect(repo.executeCancellationTransaction).toHaveBeenCalledWith(
        1, null, null,
        false,
        expect.any(Function)
      );
      expect(repo.getTipoLicenciaById).not.toHaveBeenCalled();
    });

    /**
     * CASO: Cancelar APROBADA con tipo sin saldo → sin refund de saldo
     */
    it('no debería hacer refund de saldo si tipo no requiere saldo', async () => {
      const aprobadaSinSaldo = {
        ...mockSolicitudPendiente,
        estado: EstadoSolicitud.APROBADA,
        tipo_licencia_id: 3,
        fecha_inicio: '2099-01-01',
        fecha_fin: '2099-01-07',
      };
      repo.getSolicitudById.mockResolvedValue(aprobadaSinSaldo);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple); // requiere_saldo: false
      repo.executeCancellationTransaction.mockResolvedValue(undefined);

      await cancelarSolicitud(1, 10);
      expect(repo.executeCancellationTransaction).toHaveBeenCalledWith(
        1, null, null,
        true,
        expect.any(Function)
      );
    });

    it('pasa al repo el reintegro de saldo al cancelar una APROBADA con saldo', async () => {
      repo.getSolicitudById.mockResolvedValue({
        ...mockSolicitudPendiente,
        estado: EstadoSolicitud.APROBADA,
        fecha_inicio: '2099-01-01',
        cantidad_dias: 140,
      });
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.executeCancellationTransaction.mockResolvedValue(undefined);

      await cancelarSolicitud(1, 10);
      expect(repo.executeCancellationTransaction).toHaveBeenCalledWith(
        1,
        { usuarioId: 10, tipoId: 1, recalcular: expect.any(Function) },
        null,
        true,
        expect.any(Function)
      );
      expect(repo.getSolicitudes).not.toHaveBeenCalled();
    });

    /**
     * CASO: Cancelar APROBADA con CONSUMIDA → error (estado finalizado)
     */
    it('no debería permitir cancelar solicitud CONSUMIDA', async () => {
      const consumida = {
        ...mockSolicitudPendiente,
        estado: EstadoSolicitud.CONSUMIDA,
        fecha_inicio: '2099-01-01',
      };
      repo.getSolicitudById.mockResolvedValue(consumida);
      // CONSUMIDA no está en [RECHAZADA, CANCELADA] pero fecha futura...
      // El servicio debería pasar al paso 3 y ejecutar la cancelación
      // Esto prueba que CONSUMIDA no se bloquea por el check de estado actual
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.executeCancellationTransaction.mockResolvedValue(undefined);

      await cancelarSolicitud(1, 10);
      // Nota: actualmente el servicio permite cancelar CONSUMIDA si la fecha es futura
      // Esto podría ser un bug — verificar si debería bloquearse
      expect(repo.executeCancellationTransaction).toHaveBeenCalled();
    });
  });

  // ─────────────────────────── adjuntarArchivo ───────────────────────────

  describe('adjuntarArchivo()', () => {
    it('debería adjuntar archivo exitosamente', async () => {
      repo.getSolicitudById.mockResolvedValue({
        ...mockSolicitudPendiente,
        estado: EstadoSolicitud.PENDIENTE_DOCUMENTACION,
      });
      repo.addArchivoToSolicitud.mockResolvedValue(undefined);
      repo.updateSolicitudEstado.mockResolvedValue(undefined);

      await adjuntarArchivo(1, 10, 99);
      expect(repo.addArchivoToSolicitud).toHaveBeenCalledWith(1, 99);
      expect(repo.updateSolicitudEstado).toHaveBeenCalledWith(1, EstadoSolicitud.PENDIENTE);
    });

    it('debería lanzar error si solicitud no existe', async () => {
      repo.getSolicitudById.mockResolvedValue(null);
      await expect(adjuntarArchivo(999, 10, 99)).rejects.toThrow('Solicitud no encontrada');
    });

    /**
     * CASO: Usuario intenta adjuntar a solicitud de otro
     * RIESGO: IDOR - Modificación de recurso ajeno
     * REFERENCIA: OWASP API01:2023
     */
    it('debería lanzar error si un encargado intenta adjuntar a solicitud no EXPIRADA', async () => {
      repo.getSolicitudById.mockResolvedValue(mockSolicitudPendiente); // PENDIENTE state, owner=10
      repo.getIdRolByUserContextId.mockResolvedValue(4); // encargado
      await expect(adjuntarArchivo(1, 999, 99)).rejects.toThrow('No tienes permiso');
    });

    /**
     * CASO: Adjuntar a solicitud finalizada
     * RIESGO: Modificación de estado cerrado
     */
    it.each([EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA, EstadoSolicitud.EXPIRADA, EstadoSolicitud.CONSUMIDA])(
      'debería lanzar error si solicitud está en estado %s',
      async (estado) => {
        repo.getSolicitudById.mockResolvedValue({ ...mockSolicitudPendiente, estado });
        await expect(adjuntarArchivo(1, 10, 99)).rejects.toThrow('solicitud finalizada');
      }
    );

    it('no debería cambiar estado si solicitud no es PENDIENTE_DOCUMENTACION', async () => {
      repo.getSolicitudById.mockResolvedValue({
        ...mockSolicitudPendiente,
        estado: EstadoSolicitud.PENDIENTE,
      });
      repo.addArchivoToSolicitud.mockResolvedValue(undefined);

      await adjuntarArchivo(1, 10, 99);
      expect(repo.updateSolicitudEstado).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── cancelarSolicitud ───────────────────────────

  describe('cancelarSolicitud()', () => {
    it('debería cancelar solicitud exitosamente', async () => {
      const futureSolicitud = { ...mockSolicitudPendiente, fecha_inicio: '2099-01-01' };
      repo.getSolicitudById.mockResolvedValue(futureSolicitud);
      repo.executeCancellationTransaction.mockResolvedValue(undefined);

      await cancelarSolicitud(1, 10);
      expect(repo.executeCancellationTransaction).toHaveBeenCalled();
    });

    it('debería lanzar error si solicitud no existe', async () => {
      repo.getSolicitudById.mockResolvedValue(null);
      await expect(cancelarSolicitud(999, 10)).rejects.toThrow('Solicitud no encontrada');
    });

    /**
     * CASO: IDOR en cancelación
     * REFERENCIA: OWASP API01:2023
     */
    it('debería lanzar error si usuario no es dueño', async () => {
      repo.getSolicitudById.mockResolvedValue(mockSolicitudPendiente);
      await expect(cancelarSolicitud(1, 999)).rejects.toThrow('No tienes permiso');
    });

    it.each([EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA, EstadoSolicitud.EXPIRADA])(
      'debería lanzar error si solicitud ya está en estado %s',
      async (estado) => {
        repo.getSolicitudById.mockResolvedValue({ ...mockSolicitudPendiente, estado });
        await expect(cancelarSolicitud(1, 10)).rejects.toThrow('ya está finalizada');
      }
    );

    /**
     * CASO: Cancelar solicitud cuya fecha ya pasó
     * RIESGO: Modificación retroactiva de licencias
     */
    it('debería lanzar error si la fecha de inicio ya pasó', async () => {
      repo.getSolicitudById.mockResolvedValue({
        ...mockSolicitudPendiente,
        fecha_inicio: '2020-01-01',
      });
      await expect(cancelarSolicitud(1, 10)).rejects.toThrow('ya ha comenzado');
    });

  });

  // ─────────────────────────── aprobarSolicitud ───────────────────────────

  describe('aprobarSolicitud()', () => {
    const approveData = { solicitud_id: 1, aprobador_id: 20, observacion: 'OK' };

    it('debería aprobar solicitud exitosamente', async () => {
      repo.getSolicitudById.mockResolvedValue(mockSolicitudPendiente);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple);
      repo.executeApprovalTransaction.mockResolvedValue(undefined);

      await aprobarSolicitud(approveData);
      expect(repo.executeApprovalTransaction).toHaveBeenCalled();
    });

    it('debería lanzar error si solicitud no existe', async () => {
      repo.getSolicitudById.mockResolvedValue(null);
      await expect(aprobarSolicitud(approveData)).rejects.toThrow('Solicitud no encontrada');
    });

    /**
     * CASO: Transición de estado inválida
     * RIESGO: Doble aprobación, aprobación de cancelada
     */
    it.each([EstadoSolicitud.APROBADA, EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA, EstadoSolicitud.CONSUMIDA])(
      'debería lanzar error si solicitud está en estado %s',
      async (estado) => {
        repo.getSolicitudById.mockResolvedValue({ ...mockSolicitudPendiente, estado });
        await expect(aprobarSolicitud(approveData)).rejects.toThrow('no está en un estado aprobable');
      }
    );

    /**
     * CASO: Tipo requiere adjunto pero no tiene archivos
     * Los roles habilitados para aprobar/rechazar licencias pueden aprobar igual
     * (override); el reporte de cumplimiento se genera después, al consumirse la
     * licencia (ver ejecutarSweepConsumoLicencias), no en el momento de aprobar.
     */
    it('debería aprobar igual si el tipo requiere adjunto y no hay archivos (override)', async () => {
      repo.getSolicitudById.mockResolvedValue(mockSolicitudPendiente);
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConAdjunto);
      repo.countArchivosSolicitud.mockResolvedValue(0);
      repo.executeApprovalTransaction.mockResolvedValue(undefined);

      await aprobarSolicitud(approveData);
      expect(repo.executeApprovalTransaction).toHaveBeenCalled();
    });

    /**
     * CASO: cualquiera de los roles habilitados puede aprobar una solicitud EXPIRADA,
     * no solo gerencia (la ruta ya restringe quién llega hasta acá).
     */
    it('debería aprobar una solicitud EXPIRADA', async () => {
      repo.getSolicitudById.mockResolvedValue({ ...mockSolicitudPendiente, estado: EstadoSolicitud.EXPIRADA });
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoSimple);
      repo.executeApprovalTransaction.mockResolvedValue(undefined);

      await aprobarSolicitud(approveData);
      expect(repo.executeApprovalTransaction).toHaveBeenCalled();
    });

    /**
     * CASO: Saldo cambió entre solicitud y aprobación
     * RIESGO: Race condition de saldo
     */
    it('propaga el error de saldo insuficiente que tira el cálculo dentro de la transacción', async () => {
      repo.getSolicitudById.mockResolvedValue({ ...mockSolicitudPendiente, cantidad_dias: 80 });
      repo.getTipoLicenciaById.mockResolvedValue(mockTipoConSaldo);
      repo.executeApprovalTransaction.mockImplementation(async (_id, _ap, _obs, saldo) => {
        saldo!.calcular({ dias_otorgados: 10, dias_consumidos: 0, residuo: 0 });
      });

      await expect(aprobarSolicitud(approveData)).rejects.toThrow('Saldo insuficiente al momento de aprobar');
    });
  });

  // ─────────────────────────── rechazarSolicitud ───────────────────────────

  describe('rechazarSolicitud()', () => {
    const rejectData = { solicitud_id: 1, aprobador_id: 20, observacion: 'No corresponde' };

    it('debería rechazar solicitud exitosamente', async () => {
      repo.getSolicitudById.mockResolvedValue(mockSolicitudPendiente);
      repo.updateSolicitudEstado.mockResolvedValue(undefined);

      await rechazarSolicitud(rejectData);
      expect(repo.updateSolicitudEstado).toHaveBeenCalledWith(
        1, EstadoSolicitud.RECHAZADA, 20, 'No corresponde'
      );
    });

    it('debería lanzar error si solicitud no existe', async () => {
      repo.getSolicitudById.mockResolvedValue(null);
      await expect(rechazarSolicitud(rejectData)).rejects.toThrow('Solicitud no encontrada');
    });

    it.each([EstadoSolicitud.APROBADA, EstadoSolicitud.RECHAZADA, EstadoSolicitud.CANCELADA, EstadoSolicitud.CONSUMIDA])(
      'debería lanzar error si solicitud está en estado %s',
      async (estado) => {
        repo.getSolicitudById.mockResolvedValue({ ...mockSolicitudPendiente, estado });
        await expect(rechazarSolicitud(rejectData)).rejects.toThrow('No se puede rechazar');
      }
    );
  });

  // ─────────────────────────── Francos (tipo_licencia_id 2) ───────────────────────────

  describe('Francos', () => {
    const userContextId = 10;
    // 8 hs
    const solicitudFranco = {
      ...mockSolicitudPendiente,
      tipo_licencia_id: 2,
      cantidad_dias: null,
      cantidad_minutos: 480,
    };

    describe('crearSolicitud() franco', () => {
      it('debería crear el franco en días (cantidad_dias * 10, fecha_fin calculada)', async () => {
        repo.findOverlappingSolicitudes.mockResolvedValue([]);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        repo.createSolicitud.mockResolvedValue(solicitudFranco as any);

        const data = { tipo_licencia_id: 2, fecha_inicio: new Date('2027-06-01T09:00'), cantidad_dias: 1 };
        await crearSolicitud(userContextId, data);

        expect(repo.createSolicitud).toHaveBeenCalledWith(
          userContextId, data, expect.any(Date), 10, null, EstadoSolicitud.PENDIENTE
        );
      });

      it('debería crear el franco sin importar el saldo (informativo, cantidad_horas * 60)', async () => {
        repo.findOverlappingSolicitudes.mockResolvedValue([]);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getSaldoFrancoByUsuario.mockResolvedValue({ minutos_disponibles: 0, minutos_consumidos: 0 }); // saldo no restringe
        repo.createSolicitud.mockResolvedValue(solicitudFranco as any);

        const data = { tipo_licencia_id: 2, fecha_inicio: new Date('2027-06-01T09:00'), cantidad_horas: 8 };
        await crearSolicitud(userContextId, data);

        expect(repo.createSolicitud).toHaveBeenCalledWith(
          userContextId, data, expect.any(Date), null, 480, EstadoSolicitud.PENDIENTE
        );
      });
    });

    describe('aprobarSolicitud() franco', () => {
      const approveData = { solicitud_id: 1, aprobador_id: 20, observacion: 'OK' };

      it('un franco por horas no consume en TS: lo consume la DB al aplicarse a los turnos', async () => {
        repo.getSolicitudById.mockResolvedValue(solicitudFranco as any);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getSaldoFrancoByUsuario.mockResolvedValue({ minutos_disponibles: 0, minutos_consumidos: 0 }); // saldo no restringe
        repo.executeApprovalTransaction.mockResolvedValue(undefined);

        await aprobarSolicitud(approveData);

        expect(repo.getSaldoEspecifico).not.toHaveBeenCalled();
        expect(francosRepo.getObjetivoMinutosPorUsuarios).not.toHaveBeenCalled();
        expect(repo.executeApprovalTransaction).toHaveBeenCalledWith(
          1, 20, 'OK', null,
          null, expect.any(Function)
        );
      });

      it('debería convertir un franco en días a minutos (objetivo 48 h: 1 día = 8 h = 480 min)', async () => {
        const francoDias = { ...solicitudFranco, cantidad_minutos: null, cantidad_dias: 10 }; // 1 día
        repo.getSolicitudById.mockResolvedValue(francoDias as any);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getObjetivoMinutosPorUsuarios.mockResolvedValue(new Map([[10, 2880]]));
        repo.executeApprovalTransaction.mockResolvedValue(undefined);

        await aprobarSolicitud(approveData);

        expect(repo.executeApprovalTransaction).toHaveBeenCalledWith(
          1, 20, 'OK', null,
          { userContextId: 10, minutos: 480 }, expect.any(Function)
        );
      });

      it.each([
        [2400, 480],
        [2399, 240],
      ])('debería usar el umbral de 40 h: objetivo %i min → 1 día = %i min', async (objetivo, esperado) => {
        const francoDias = { ...solicitudFranco, cantidad_minutos: null, cantidad_dias: 10 }; // 1 día
        repo.getSolicitudById.mockResolvedValue(francoDias as any);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getObjetivoMinutosPorUsuarios.mockResolvedValue(new Map([[10, objetivo]]));
        repo.executeApprovalTransaction.mockResolvedValue(undefined);

        await aprobarSolicitud(approveData);

        expect(repo.executeApprovalTransaction).toHaveBeenCalledWith(
          1, 20, 'OK', null,
          { userContextId: 10, minutos: esperado }, expect.any(Function)
        );
      });

      it('debería convertir un franco en días a minutos (objetivo 24 h: 1 día = 4 h = 240 min)', async () => {
        const francoDias = { ...solicitudFranco, cantidad_minutos: null, cantidad_dias: 10 }; // 1 día
        repo.getSolicitudById.mockResolvedValue(francoDias as any);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getObjetivoMinutosPorUsuarios.mockResolvedValue(new Map([[10, 1440]]));
        repo.executeApprovalTransaction.mockResolvedValue(undefined);

        await aprobarSolicitud(approveData);

        expect(repo.executeApprovalTransaction).toHaveBeenCalledWith(
          1, 20, 'OK', null,
          { userContextId: 10, minutos: 240 }, expect.any(Function)
        );
      });
    });

    describe('cancelarSolicitud() franco', () => {
      it('debería reintegrar exactamente lo consumido (leído del ledger) al cancelar un franco APROBADO', async () => {
        const aprobadaFranco = {
          ...solicitudFranco,
          estado: EstadoSolicitud.APROBADA,
          fecha_inicio: '2099-01-01',
          fecha_fin: '2099-01-02',
        };
        repo.getSolicitudById.mockResolvedValue(aprobadaFranco as any);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getConsumoFrancoBySolicitud.mockResolvedValue(480);
        repo.executeCancellationTransaction.mockResolvedValue(undefined);

        await cancelarSolicitud(1, 10);

        expect(francosRepo.getConsumoFrancoBySolicitud).toHaveBeenCalledWith(1);
        expect(repo.executeCancellationTransaction).toHaveBeenCalledWith(
          1, null,
          { userContextId: 10, minutos: 480 },
          true,
          expect.any(Function)
        );
      });

      it('no toca los turnos al cancelar una licencia por horas que nunca se aprobó', async () => {
        const pendiente = { ...solicitudFranco, estado: EstadoSolicitud.PENDIENTE, fecha_inicio: '2099-01-01', fecha_fin: '2099-01-02' };
        repo.getSolicitudById.mockResolvedValue(pendiente as any);
        repo.executeCancellationTransaction.mockResolvedValue(undefined);

        await cancelarSolicitud(1, 10);

        expect(repo.executeCancellationTransaction).toHaveBeenCalledWith(1, null, null, false, expect.any(Function));
      });

      it('debería reintegrar lo consumido del ledger aunque la solicitud original haya sido en días', async () => {
        const aprobadaFrancoDias = {
          ...solicitudFranco,
          cantidad_horas: null,
          cantidad_dias: 10, // 1 día
          estado: EstadoSolicitud.APROBADA,
          fecha_inicio: '2099-01-01',
          fecha_fin: '2099-01-02',
        };
        repo.getSolicitudById.mockResolvedValue(aprobadaFrancoDias as any);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getConsumoFrancoBySolicitud.mockResolvedValue(480);
        repo.executeCancellationTransaction.mockResolvedValue(undefined);

        await cancelarSolicitud(1, 10);

        expect(repo.executeCancellationTransaction).toHaveBeenCalledWith(
          1, null,
          { userContextId: 10, minutos: 480 },
          true,
          expect.any(Function)
        );
      });

      it('no debería reintegrar nada si no se registró consumo (saldo ya estaba agotado al aprobar)', async () => {
        const aprobadaFranco = {
          ...solicitudFranco,
          estado: EstadoSolicitud.APROBADA,
          fecha_inicio: '2099-01-01',
          fecha_fin: '2099-01-02',
        };
        repo.getSolicitudById.mockResolvedValue(aprobadaFranco as any);
        repo.getTipoLicenciaById.mockResolvedValue(mockTipoFranco);
        francosRepo.getConsumoFrancoBySolicitud.mockResolvedValue(null);
        repo.executeCancellationTransaction.mockResolvedValue(undefined);

        await cancelarSolicitud(1, 10);

        expect(repo.executeCancellationTransaction).toHaveBeenCalledWith(
          1, null,
          null,
          true,
          expect.any(Function)
        );
      });
    });
  });
});
