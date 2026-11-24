/**
 * Tests de domain: planificacionServices — preview, confirmación, generación semanal y aviso por mail.
 * Capa: Domain. El repo, el lector de la planilla, las licencias y el mail están mockeados;
 * las reglas (planificacionReglas) y el parser de errores son los reales.
 */

const mockClient = { query: jest.fn(), release: jest.fn() };
jest.mock('../../adapters/db/pgClient', () => ({ pool: { connect: jest.fn() } }));
jest.mock('../../adapters/db/planificacionRepo');
jest.mock('../../adapters/inputs_outputs/lectorPlanillaGoogle', () => ({ leerPlanilla: jest.fn() }));
jest.mock('../../domain/services/planillaParser', () => ({ parsePlanilla: jest.fn() }));
jest.mock('../../domain/services/licenciasTurnosServices', () => ({ aplicarLicenciasATurnos: jest.fn() }));
jest.mock('../../domain/services/mailService', () => ({ sendMailService: jest.fn() }));

import { pool } from '../../adapters/db/pgClient';
import * as repo from '../../adapters/db/planificacionRepo';
import { leerPlanilla } from '../../adapters/inputs_outputs/lectorPlanillaGoogle';
import { parsePlanilla } from '../../domain/services/planillaParser';
import { aplicarLicenciasATurnos } from '../../domain/services/licenciasTurnosServices';
import { sendMailService } from '../../domain/services/mailService';
import {
  confirmarPlanificacionService,
  generarSemanaService,
  getInfoPlanificacionService,
  notificarResultadoSemanal,
  previsualizarPlanificacionService,
} from '../../domain/services/planificacionServices';
import type { SnapshotTurno, TurnoDiario } from '../../domain/services/planificacionReglas';

const r = jest.mocked(repo);
const parser = jest.mocked(parsePlanilla);
const licencias = jest.mocked(aplicarLicenciasATurnos);
const mail = jest.mocked(sendMailService);

const ANA = { userContextId: 5, nombre: 'Ana', apellido: 'Perez', rolNombre: 'empleado-deposito' };
const LUIS = { userContextId: 9, nombre: 'Luis', apellido: 'Gomez', rolNombre: 'encargado' };

// Miércoles 2026-11-04: ventana = 04/11 .. sábado 07/11, lunes 02/11
const AHORA = '2026-11-04 10:00:00';

const sentencias = (): string[] => mockClient.query.mock.calls.map((c) => String(c[0]));
const orden = (fn: unknown): number => (fn as jest.Mock).mock.invocationCallOrder[0]!;

const viejo = (p: Partial<TurnoDiario>): TurnoDiario => ({
  id: 1, userContextId: 5, turno: 'Mañana', esperadoIn: '2026-11-05 08:00:00', esperadoOut: '2026-11-05 12:00:00',
  sedeIdIn: 2, sedeIdOut: 2, licencia: false, minutosLicencia: 0, horarioCorrido: false,
  marcadoInAt: null, marcadoOutAt: null, generica: false, feriado: false, ...p,
});

beforeEach(() => {
  jest.resetAllMocks();
  (pool.connect as jest.Mock).mockResolvedValue(mockClient);
  mockClient.query.mockResolvedValue({});
  r.ahoraAr.mockResolvedValue(AHORA);
  r.getUsuarios.mockResolvedValue([ANA, LUIS]);
  r.getSedesActivas.mockResolvedValue([2]);
  r.contarTurnosSnapshotActivo.mockResolvedValue(0);
  r.getUsuariosSnapshotActivo.mockResolvedValue([]);
  r.getTurnosDiarios.mockResolvedValue([]);
  r.getSolicitudesAprobadas.mockResolvedValue([]);
  r.getObjetivosUsuarios.mockResolvedValue([]);
  r.getObjetivosSnapshot.mockResolvedValue([]);
  r.getUsuariosConObjetivo.mockResolvedValue([]);
  r.getTurnosExistentesDelRango.mockResolvedValue([]);
  r.getDiasConCorrido.mockResolvedValue([]);
  r.actualizarModificaciones.mockResolvedValue([]);
  r.insertarAltas.mockResolvedValue([]);
  r.insertarTurnosSemana.mockResolvedValue([]);
  r.insertarSinteticos.mockResolvedValue(0);
  r.promoverObjetivosPendientes.mockResolvedValue(0);
  r.existeActivoConHash.mockResolvedValue(false);
});

describe('previsualizarPlanificacionService', () => {
  const payloadOk = {
    turnos: [{ user_context_id: 5, dia_semana: 5, turno: 'Mañana', hora_in: '08:00', hora_out: '12:00', sede_id: 2 }],
    objetivos: [{ user_context_id: 5, horas: 40 }],
  };

  it('crea el snapshot PREVIEW, calcula el diff y lo guarda', async () => {
    (leerPlanilla as jest.Mock).mockResolvedValue([['x']]);
    parser.mockReturnValue({ payload: payloadOk as any, errores: [] });
    r.insertarSnapshotPreview.mockResolvedValue({ id: 77, expiraAt: '2026-11-04T13:30:00.000Z' });
    r.existeActivoConHash.mockResolvedValue(true);

    const res = await previsualizarPlanificacionService(12);

    expect(res.ok).toBe(true);
    expect(res.snapshotId).toBe(77);
    expect(res.expiraAt).toBe('2026-11-04T13:30:00.000Z');
    expect(res.igualAlVigente).toBe(true);
    expect(res.resumen).toMatchObject({ altas: 1, modificaciones: 0, bajas: 0 });
    expect(res.detalle[0]).toMatchObject({ apellido: 'Perez', fecha: '2026-11-06', accion: 'alta', despues: { in: '08:00', out: '12:00', sede: 2 } });
    // 4 h cargadas contra 40 h de objetivo
    expect(res.faltantes.proximaSemana[0]).toMatchObject({ user_context_id: 5, horas: 4, objetivo: 40 });

    const [, creadoPor, hash] = r.insertarSnapshotPreview.mock.calls[0]!;
    expect(creadoPor).toBe(12);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.insertarSnapshotObjetivos).toHaveBeenCalledWith(mockClient, 77, [{ userContextId: 5, minutosObjetivo: 2400 }]);
    expect(r.guardarDiff).toHaveBeenCalledWith(mockClient, 77, expect.objectContaining({ resumen: expect.any(Object) }));
    expect(orden(r.expirarPreviews)).toBeLessThan(orden(r.insertarSnapshotPreview));
    expect(sentencias()).toEqual(['BEGIN', 'COMMIT']);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('el hash es estable aunque cambie el orden de los turnos', async () => {
    const dos = {
      turnos: [
        { user_context_id: 5, dia_semana: 5, turno: 'Mañana', hora_in: '08:00', hora_out: '12:00', sede_id: 2 },
        { user_context_id: 5, dia_semana: 4, turno: 'Mañana', hora_in: '08:00', hora_out: '12:00', sede_id: 2 },
      ],
      objetivos: [],
    };
    r.insertarSnapshotPreview.mockResolvedValue({ id: 1, expiraAt: 'x' });
    parser.mockReturnValue({ payload: dos as any, errores: [] });
    await previsualizarPlanificacionService(12);
    parser.mockReturnValue({ payload: { ...dos, turnos: [...dos.turnos].reverse() } as any, errores: [] });
    await previsualizarPlanificacionService(12);

    expect(r.insertarSnapshotPreview.mock.calls[0]![2]).toBe(r.insertarSnapshotPreview.mock.calls[1]![2]);
  });

  it('errores del parser: 422 con { errores } y no abre transacción', async () => {
    (leerPlanilla as jest.Mock).mockResolvedValue([]);
    parser.mockReturnValue({ payload: { turnos: [], objetivos: [] }, errores: ['Fila 3: sede inválida'] });

    await expect(previsualizarPlanificacionService(12)).rejects.toMatchObject({
      statusCode: 422,
      details: { errores: ['Fila 3: sede inválida'] },
    });
    expect(r.insertarSnapshotPreview).not.toHaveBeenCalled();
    expect(mockClient.query).not.toHaveBeenCalled();
  });

  it('errores de validación: 422, rollback y no se crea el snapshot', async () => {
    parser.mockReturnValue({ payload: payloadOk as any, errores: [] });
    r.getUsuarios.mockResolvedValue([]);

    await expect(previsualizarPlanificacionService(12)).rejects.toMatchObject({
      statusCode: 422,
      details: { errores: expect.arrayContaining(['Usuario 5 inexistente o dado de baja.']) },
    });
    expect(r.expirarPreviews).not.toHaveBeenCalled();
    expect(r.insertarSnapshotPreview).not.toHaveBeenCalled();
    expect(sentencias()).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('guarda anti-borrado: rechaza una planilla con menos de la mitad de los turnos vigentes', async () => {
    parser.mockReturnValue({ payload: payloadOk as any, errores: [] });
    r.contarTurnosSnapshotActivo.mockResolvedValue(10);

    await expect(previsualizarPlanificacionService(12)).rejects.toMatchObject({
      statusCode: 422,
      details: { errores: [expect.stringContaining('parece que se borró contenido')] },
    });
  });
});

describe('confirmarPlanificacionService', () => {
  const snapshotTurnos: SnapshotTurno[] = [
    { userContextId: 5, diaSemana: 5, turno: 'Mañana', horaIn: '08:00', horaOut: '12:00', sedeId: 2 }, // alta (vie)
    { userContextId: 5, diaSemana: 6, turno: 'Tarde', horaIn: '16:00', horaOut: '20:00', sedeId: 2 }, // modificación (sáb)
    { userContextId: 9, diaSemana: 5, turno: 'Mañana', horaIn: '08:00', horaOut: '12:00', sedeId: 2 }, // alta del actor
  ];
  const viejos: TurnoDiario[] = [
    viejo({ id: 100, turno: 'Tarde', esperadoIn: '2026-11-07 15:00:00', esperadoOut: '2026-11-07 19:00:00' }),
    viejo({ id: 101, turno: 'Mañana', esperadoIn: '2026-11-05 08:00:00', esperadoOut: '2026-11-05 12:00:00' }), // baja (jue)
  ];

  const snapshotValido = { id: 7, estado: 'PREVIEW', creadoPor: 9, vencido: false };

  it('snapshot inexistente: 409 y rollback', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue(null);
    await expect(confirmarPlanificacionService(7, 9)).rejects.toMatchObject({ statusCode: 409 });
    expect(sentencias()).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('snapshot que no está en PREVIEW: 409', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue({ ...snapshotValido, estado: 'ACTIVO' });
    await expect(confirmarPlanificacionService(7, 9)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('preview de otro usuario: 409', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue({ ...snapshotValido, creadoPor: 1 });
    await expect(confirmarPlanificacionService(7, 9)).rejects.toMatchObject({ statusCode: 409 });
    expect(r.getTurnosSnapshot).not.toHaveBeenCalled();
  });

  it('preview vencido: 412 y rollback (el EXPIRADO se deshace, como el RAISE de la función SQL)', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue({ ...snapshotValido, vencido: true });

    await expect(confirmarPlanificacionService(7, 9)).rejects.toMatchObject({ statusCode: 412 });
    expect(r.marcarExpirado).toHaveBeenCalledWith(mockClient, 7);
    expect(sentencias()).toEqual(['BEGIN', 'ROLLBACK']);
    expect(r.eliminarBajasSinMarcado).not.toHaveBeenCalled();
  });

  it('aplica el diff en el orden de snapshot_aplicar y notifica sin el actor', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue(snapshotValido);
    r.getTurnosSnapshot.mockResolvedValue(snapshotTurnos);
    r.getTurnosDiarios.mockResolvedValue(viejos);
    r.actualizarModificaciones.mockResolvedValue([100]);
    r.insertarAltas.mockResolvedValue([200, 201]);

    const res = await confirmarPlanificacionService(7, 9);

    expect(res).toEqual({ ok: true, snapshotId: 7, altas: 2, modificaciones: 1, bajas: 1, omitidos: 0, usuariosAfectados: [5] });

    expect(r.lockPlanificacion).toHaveBeenCalledWith(mockClient);
    expect(r.eliminarBajasSinMarcado).toHaveBeenCalledWith(mockClient, [101]);
    expect(r.actualizarModificaciones.mock.calls[0]![1]).toHaveLength(1);
    expect(r.eliminarGenericasDeDias).toHaveBeenCalledWith(mockClient, expect.arrayContaining([{ userContextId: 5, fecha: '2026-11-06' }]));
    expect(licencias).toHaveBeenCalledWith(mockClient, [100, 200, 201]);
    expect(r.encolarNotificaciones).toHaveBeenCalledWith(mockClient, 7, [5]);

    const secuencia = [
      r.lockPlanificacion, r.getSnapshotParaActualizar, r.eliminarBajasSinMarcado, r.actualizarModificaciones,
      r.eliminarGenericasDeDias, r.insertarAltas, licencias, r.getUsuariosConObjetivo, r.insertarSinteticos,
      r.upsertObjetivosDesdeSnapshot, r.marcarActivoReemplazado, r.activarSnapshot, r.encolarNotificaciones,
    ].map(orden);
    expect([...secuencia].sort((a, b) => a - b)).toEqual(secuencia);
    expect(sentencias()).toEqual(['BEGIN', 'COMMIT']);
  });

  it('marca los días vacíos de la ventana (desde hoy hasta el sábado)', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue(snapshotValido);
    r.getTurnosSnapshot.mockResolvedValue(snapshotTurnos);
    r.getUsuariosConObjetivo.mockResolvedValue([{ userContextId: 5, rolNombre: 'empleado-deposito', minutosObjetivo: 2400 }]);

    await confirmarPlanificacionService(7, 9);

    expect(r.getTurnosExistentesDelRango).toHaveBeenCalledWith(mockClient, '2026-11-04', '2026-11-07');
    const sinteticos = r.insertarSinteticos.mock.calls[0]![1];
    // Ana: 4 días de la ventana (mié a sáb), 2 turnos sintéticos por día; el vie y el sáb tienen turno real... aun sin
    // estar insertados (mock), los sintéticos cubren los 4 días sin turno real cargado en planificacion_diaria
    expect(sinteticos.length).toBe(8);
    expect(sinteticos[0]).toMatchObject({ userContextId: 5, turno: 'Mañana', licencia: true, generica: true, minutosLicencia: 240 });
  });

  it('sin afectados no encola notificaciones (solo cambios del propio actor)', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue(snapshotValido);
    r.getTurnosSnapshot.mockResolvedValue([snapshotTurnos[2]!]);

    const res = await confirmarPlanificacionService(7, 9);

    expect(res.usuariosAfectados).toEqual([]);
    expect(r.encolarNotificaciones).toHaveBeenCalledWith(mockClient, 7, []);
  });

  it('si una escritura falla hace rollback y libera el client', async () => {
    r.getSnapshotParaActualizar.mockResolvedValue(snapshotValido);
    r.getTurnosSnapshot.mockResolvedValue(snapshotTurnos);
    r.insertarAltas.mockRejectedValue(new Error('boom'));

    await expect(confirmarPlanificacionService(7, 9)).rejects.toThrow('boom');
    expect(sentencias()).toEqual(['BEGIN', 'ROLLBACK']);
    expect(mockClient.release).toHaveBeenCalled();
  });
});

describe('generarSemanaService', () => {
  const plantilla: SnapshotTurno[] = [
    { userContextId: 5, diaSemana: 1, turno: 'Mañana', horaIn: '08:00', horaOut: '12:00', sedeId: 2 },
    { userContextId: 5, diaSemana: 2, turno: 'Mañana', horaIn: '08:00', horaOut: '12:00', sedeId: 2 },
    { userContextId: 77, diaSemana: 1, turno: 'Tarde', horaIn: '16:00', horaOut: '20:00', sedeId: 2 }, // dado de baja
  ];

  it('no es lunes: 400', async () => {
    await expect(generarSemanaService('2026-11-10')).rejects.toMatchObject({ statusCode: 400 });
    expect(sentencias()).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('sin snapshot ACTIVO devuelve SIN_SNAPSHOT con el lunes por defecto (próximo lunes)', async () => {
    r.ahoraAr.mockResolvedValue('2026-11-08 12:00:00'); // domingo
    r.getSnapshotActivoId.mockResolvedValue(null);

    const res = await generarSemanaService();

    expect(res).toEqual({ ok: false, motivo: 'SIN_SNAPSHOT', lunes: '2026-11-09' });
    expect(r.insertarTurnosSemana).not.toHaveBeenCalled();
    expect(sentencias()).toEqual(['BEGIN', 'COMMIT']);
  });

  it('un lunes sin parámetro genera la semana del lunes siguiente', async () => {
    r.ahoraAr.mockResolvedValue('2026-11-09 09:00:00');
    r.getSnapshotActivoId.mockResolvedValue(null);
    expect(await generarSemanaService()).toMatchObject({ lunes: '2026-11-16' });
  });

  it('genera la semana, aplica licencias a los insertados y promueve objetivos', async () => {
    r.ahoraAr.mockResolvedValue('2026-11-08 12:00:00');
    r.getSnapshotActivoId.mockResolvedValue(3);
    r.getTurnosSnapshot.mockResolvedValue(plantilla);
    r.getUsuarios.mockResolvedValue([ANA]); // el 77 ya no existe
    r.getObjetivosUsuarios.mockResolvedValue([{ userContextId: 5, minutosObjetivo: 600, minutosObjetivoPendiente: null }]);
    r.insertarTurnosSemana.mockResolvedValue([500, 501]);
    r.promoverObjetivosPendientes.mockResolvedValue(2);

    const res = await generarSemanaService();

    expect(res).toMatchObject({ ok: true, lunes: '2026-11-09', snapshotId: 3, generados: 2, objetivosPromovidos: 2 });
    // 8 h de plantilla contra 10 h de objetivo: falta
    expect((res as any).faltantes).toEqual([{ user_context_id: 5, nombre: 'Ana', apellido: 'Perez', horas: 8, objetivo: 10 }]);

    const filas = r.insertarTurnosSemana.mock.calls[0]![1];
    expect(filas.map((f) => f.esperadoIn)).toEqual(['2026-11-09 08:00:00', '2026-11-10 08:00:00']);
    expect(r.eliminarGenericasDeDias).toHaveBeenCalledWith(mockClient, expect.arrayContaining([{ userContextId: 5, fecha: '2026-11-10' }]));
    expect(licencias).toHaveBeenCalledWith(mockClient, [500, 501]);
    expect(r.getTurnosExistentesDelRango).toHaveBeenCalledWith(mockClient, '2026-11-09', '2026-11-14');

    // Faltantes antes de promover; días vacíos antes de promover
    expect(orden(r.getObjetivosUsuarios)).toBeLessThan(orden(r.promoverObjetivosPendientes));
    expect(orden(r.insertarTurnosSemana)).toBeLessThan(orden(licencias));
    expect(orden(licencias)).toBeLessThan(orden(r.insertarSinteticos));
    expect(orden(r.insertarSinteticos)).toBeLessThan(orden(r.promoverObjetivosPendientes));
  });

  it('saltea los días que ya están en horario corrido', async () => {
    r.ahoraAr.mockResolvedValue('2026-11-08 12:00:00');
    r.getSnapshotActivoId.mockResolvedValue(3);
    r.getTurnosSnapshot.mockResolvedValue(plantilla.slice(0, 2));
    r.getUsuarios.mockResolvedValue([ANA]);
    r.getDiasConCorrido.mockResolvedValue([{ userContextId: 5, fecha: '2026-11-09' }]);

    await generarSemanaService('2026-11-09');

    expect(r.insertarTurnosSemana.mock.calls[0]![1].map((f) => f.esperadoIn)).toEqual(['2026-11-10 08:00:00']);
  });
});

describe('notificarResultadoSemanal', () => {
  const OLD_ENV = process.env;
  beforeEach(() => { process.env = { ...OLD_ENV, ALERTAS_EMAIL_TO: 'admin@x.com' }; });
  afterAll(() => { process.env = OLD_ENV; });

  it('no manda mail si salió bien y no hay faltantes', async () => {
    await notificarResultadoSemanal({ ok: true, lunes: '2026-11-09', snapshotId: 3, generados: 10, objetivosPromovidos: 0, faltantes: [] });
    expect(mail).not.toHaveBeenCalled();
  });

  it('avisa los faltantes con el texto del workflow', async () => {
    await notificarResultadoSemanal({
      ok: true, lunes: '2026-11-09', snapshotId: 3, generados: 10, objetivosPromovidos: 0,
      faltantes: [{ user_context_id: 5, nombre: 'Ana', apellido: 'Perez', horas: 8, objetivo: 10 }],
    });
    expect(mail).toHaveBeenCalledWith({
      to: 'admin@x.com',
      subject: 'Planificación semanal: revisar',
      text: 'Semana del 2026-11-09 generada (10 turnos). Usuarios por debajo de su objetivo semanal:\n- Perez Ana: 8 hs de 10 hs',
    });
  });

  it('avisa cuando no se generó la semana', async () => {
    await notificarResultadoSemanal({ ok: false, motivo: 'SIN_SNAPSHOT', lunes: '2026-11-09' });
    expect(mail).toHaveBeenCalledWith(expect.objectContaining({
      text: 'No se generó la semana del 2026-11-09: SIN_SNAPSHOT.',
    }));
  });

  it('sin ALERTAS_EMAIL_TO loguea un warning y no manda mail', async () => {
    delete process.env.ALERTAS_EMAIL_TO;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await notificarResultadoSemanal({ ok: false, motivo: 'SIN_SNAPSHOT', lunes: '2026-11-09' });
    expect(mail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('getInfoPlanificacionService', () => {
  const OLD_ENV = process.env;
  afterEach(() => { process.env = OLD_ENV; });

  it('devuelve el link configurado y la última publicación', async () => {
    process.env = { ...OLD_ENV, PLANIFICACION_PLANILLA_URL: ' https://docs.google.com/x ' };
    r.getUltimaPublicacionPlanificacion.mockResolvedValue({
      snapshotId: 4, aplicadoAt: new Date('2026-11-04T12:00:00Z'), nombre: 'Ana', apellido: 'Perez',
    });

    expect(await getInfoPlanificacionService()).toEqual({
      planillaUrl: 'https://docs.google.com/x',
      ultimaPublicacion: { snapshotId: 4, aplicadoAt: '2026-11-04T12:00:00.000Z', publicadoPor: { nombre: 'Ana', apellido: 'Perez' } },
    });
  });

  it('sin link ni publicación devuelve nulls', async () => {
    process.env = { ...OLD_ENV };
    delete process.env.PLANIFICACION_PLANILLA_URL;
    r.getUltimaPublicacionPlanificacion.mockResolvedValue(null);
    expect(await getInfoPlanificacionService()).toEqual({ planillaUrl: null, ultimaPublicacion: null });
  });
});
