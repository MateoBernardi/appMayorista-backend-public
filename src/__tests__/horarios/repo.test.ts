/**
 * Tests de adapters/db: updateShiftsManually — SQL (licencia) y manejo de la transacción.
 * Capa: Adapter (DB)
 */

jest.mock('../../adapters/db/pgClient', () => ({
  pool: { connect: jest.fn(), query: jest.fn() },
}));

import { pool } from '../../adapters/db/pgClient';
import {
  updateShiftsManually,
  registerScan,
  getHorasSemanalesVsObjetivo,
  getHorasExcedentesSemanales,
  getHorasExtrasPostSabado,
  getUsuariosSinMarcarHoy,
  SALIDA_GRACIA_MINUTOS,
  calcularHorasTrabajadasRecientes,
  SQL_CALCULAR_HORAS_TRABAJADAS,
  getTurnosSemanaProyeccion,
} from '../../adapters/db/horariosRepo';
import { getSaldosVacacionesTodos } from '../../adapters/db/licenciasRepo';
import { ConflictError } from '../../adapters/errors/AppError';
import { HorariosDTO } from '../../domain/dto/HorariosDTO';

const queryMock = jest.fn();
const releaseMock = jest.fn();
(pool.connect as jest.Mock).mockResolvedValue({ query: queryMock, release: releaseMock });

// Llamadas a client.query excluyendo BEGIN/COMMIT/ROLLBACK.
const updateCall = () => queryMock.mock.calls.find(([sql]) => !/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql))!;

const turnoRow = { userContextId: 1, nombre: 'Ana', apellido: 'Gómez', previoIn: null, previoOut: null, nuevoIn: null, nuevoOut: null, licencia: false };

const mockUpdate = (rows: unknown[]) =>
  queryMock.mockImplementation(async (sql: string) =>
    /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? {} : { rowCount: rows.length, rows });

const makeDto = (overrides: Partial<HorariosDTO> = {}): HorariosDTO => ({
  id: 1,
  userContextId: 1,
  turno: 'Mañana',
  horario_in: new Date('2026-06-15T08:00:00'),
  horario_out: new Date('2026-06-15T16:00:00'),
  sede_id_in: 10,
  sede_id_out: 10,
  licencia: false,
  feriado: false,
  ...overrides,
});

beforeEach(() => {
  queryMock.mockReset();
  releaseMock.mockReset();
});

describe('updateShiftsManually — regresión SQL (licencia)', () => {
  it('el SQL de UPDATE incluye la columna licencia', async () => {
    mockUpdate([turnoRow]);

    await updateShiftsManually(makeDto());

    const [sql] = updateCall();
    expect(sql).toContain('licencia');
  });

  it('pasa datos.licencia = true en los params cuando se marca licencia', async () => {
    mockUpdate([turnoRow]);

    await updateShiftsManually(makeDto({ licencia: true }));

    const [, params] = updateCall();
    expect(params).toContain(true);
  });

  it('cada placeholder del SQL tiene su parámetro y no sobra ninguno (si no, Postgres no puede tipar el hueco)', async () => {
    mockUpdate([turnoRow]);
    await updateShiftsManually(makeDto({ horarioCorrido: true }));
    const [sql, params] = updateCall();
    const usados = new Set([...String(sql).matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
    expect([...usados].sort((a, b) => a - b)).toEqual(params.map((_: unknown, i: number) => i + 1));
  });

  it('pasa datos.licencia = false en los params cuando no está de licencia', async () => {
    mockUpdate([turnoRow]);

    await updateShiftsManually(makeDto({ licencia: false }));

    const [, params] = updateCall();
    expect(params).toContain(false);
  });

  it('devuelve el turno actualizado y hace COMMIT', async () => {
    mockUpdate([turnoRow]);

    const result = await updateShiftsManually(makeDto());

    expect(result).toEqual({ turno: turnoRow, resultado: undefined });
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('devuelve null cuando no se encontró el id a actualizar, sin correr beforeCommit', async () => {
    mockUpdate([]);
    const beforeCommit = jest.fn();

    const result = await updateShiftsManually(makeDto({ id: 999 }), beforeCommit);

    expect(result).toBeNull();
    expect(beforeCommit).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalledWith('COMMIT');
  });

  it('propaga el resultado de beforeCommit', async () => {
    mockUpdate([turnoRow]);

    const result = await updateShiftsManually(makeDto(), async () => 'avisado');

    expect(result).toEqual({ turno: turnoRow, resultado: 'avisado' });
  });

  it('hace ROLLBACK y relanza si beforeCommit falla', async () => {
    mockUpdate([turnoRow]);

    await expect(updateShiftsManually(makeDto(), async () => { throw new Error('sin aviso'); })).rejects.toThrow('sin aviso');

    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
    expect(queryMock).not.toHaveBeenCalledWith('COMMIT');
    expect(releaseMock).toHaveBeenCalled();
  });

  it('bloquea la fila del turno durante la transacción', async () => {
    mockUpdate([turnoRow]);

    await updateShiftsManually(makeDto());

    const [sql] = updateCall();
    expect(sql).toMatch(/FOR UPDATE OF p/);
  });

  it('la columna licencia queda protegida por marcado_in_at IS NULL (no se pisa tras el escaneo)', async () => {
    mockUpdate([turnoRow]);

    await updateShiftsManually(makeDto());

    const [sql] = updateCall();
    expect(sql).toMatch(/licencia\s*=\s*CASE WHEN marcado_in_at IS NULL THEN \$5 ELSE licencia END/);
  });
});

describe('updateShiftsManually — horas_trabajadas y horario corrido', () => {
  const diaRow = (id: string, overrides: Record<string, unknown> = {}) => ({
    id, licencia: false, marcado_in_at: null, marcado_out_at: null, ...overrides,
  });

  // El primer query no transaccional es el UPDATE principal; el siguiente, el SELECT del día.
  const mockCorrido = (dia: unknown[]) =>
    queryMock.mockImplementation(async (sql: string) => {
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return {};
      if (/^\s*WITH previo/.test(sql)) return { rowCount: 1, rows: [turnoRow] };
      if (/FOR UPDATE OF p/.test(sql)) return { rowCount: dia.length, rows: dia };
      return { rowCount: 1, rows: [] };
    });

  const sqlCalls = () => queryMock.mock.calls.map(([sql]) => String(sql));

  it('ya no escribe horas_trabajadas', async () => {
    mockUpdate([turnoRow]);

    await updateShiftsManually(makeDto());

    const [sql] = updateCall();
    expect(sql).not.toContain('horas_trabajadas');
  });

  it('no consolida el día si no se pide horario corrido', async () => {
    mockCorrido([diaRow('1'), diaRow('2')]);

    await updateShiftsManually(makeDto());

    expect(sqlCalls().some(sql => /DELETE FROM planificacion_diaria WHERE id = ANY/.test(sql))).toBe(false);
  });

  it('con horario corrido conserva el primer turno, elimina el resto y deja esperado_out NULL con la sede de entrada', async () => {
    mockCorrido([diaRow('10'), diaRow('11'), diaRow('12')]);

    await updateShiftsManually(makeDto({ horarioCorrido: true }));

    const del = queryMock.mock.calls.find(([sql]) => /DELETE FROM planificacion_diaria WHERE id = ANY/.test(String(sql)))!;
    expect(del[1]).toEqual([['11', '12']]);
    const upd = queryMock.mock.calls.find(([sql]) => /horario_corrido = true/.test(String(sql)))!;
    expect(String(upd[0])).toMatch(/esperado_out = NULL/);
    expect(String(upd[0])).toMatch(/sede_id_out = sede_id_in/);
    expect(upd[1]).toEqual(['10']);
    expect(queryMock).toHaveBeenCalledWith('COMMIT');
  });

  it('rechaza el horario corrido (ROLLBACK) si el día tiene licencia', async () => {
    mockCorrido([diaRow('10'), diaRow('11', { licencia: true })]);

    await expect(updateShiftsManually(makeDto({ horarioCorrido: true }))).rejects.toBeInstanceOf(ConflictError);

    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
    expect(queryMock).not.toHaveBeenCalledWith('COMMIT');
    expect(sqlCalls().some(sql => /DELETE FROM planificacion_diaria WHERE id = ANY/.test(sql))).toBe(false);
  });

  it('rechaza el horario corrido si un turno a eliminar ya tiene marcado', async () => {
    mockCorrido([diaRow('10'), diaRow('11', { marcado_in_at: '2026-06-15 16:01:00' })]);

    await expect(updateShiftsManually(makeDto({ horarioCorrido: true }))).rejects.toBeInstanceOf(ConflictError);
    expect(queryMock).toHaveBeenCalledWith('ROLLBACK');
  });

  it('rechaza el horario corrido si el turno que queda ya tiene la salida marcada', async () => {
    mockCorrido([diaRow('10', { marcado_out_at: '2026-06-15 12:00:00' })]);

    await expect(updateShiftsManually(makeDto({ horarioCorrido: true }))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('registerScan — salida anticipada', () => {
  it('no informa salida anticipada cuando el turno es horario corrido', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? {} : { rowCount: 1, rows: [{ marcadoAt: '2026-06-15 12:00:00', llegadaTarde: false, salidaAnticipada: false }] });

    await registerScan(
      { userContextId: 1, fecha: '2026-06-15', turno: 'Mañana', latitud: 0, longitud: 0, deviceId: 'd', token: 't' },
      'OUT', 5, null
    );

    const marcado = queryMock.mock.calls.find(([sql]) => /UPDATE planificacion_diaria SET marcado_out_at/.test(String(sql)))!;
    expect(String(marcado[0])).toContain('NOT horario_corrido');
  });
});

describe('registerScan — escritura condicional (sin falsos positivos)', () => {
  const scan = { userContextId: 1, fecha: '2026-06-15', turno: 'Mañana', latitud: 0, longitud: 0, deviceId: 'd', token: 't' };

  it('solo marca si la columna sigue vacía (y la salida, si la entrada está marcada)', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? {} : { rowCount: 1, rows: [{ marcadoAt: '2026-06-15 12:00:00', llegadaTarde: false, salidaAnticipada: false }] });

    await registerScan(scan, 'OUT', 5, null);

    const update = queryMock.mock.calls.find(([sql]) => /UPDATE planificacion_diaria SET marcado_out_at/.test(String(sql)))!;
    expect(String(update[0])).toMatch(/AND marcado_out_at IS NULL/);
    expect(String(update[0])).toMatch(/AND marcado_in_at IS NOT NULL/);
  });

  it('si otro escaneo ya marcó: ROLLBACK, no inserta el scan y devuelve registrado=false', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? {} : { rowCount: 0, rows: [] });

    const result = await registerScan(scan, 'IN', 5, null);

    expect(result).toEqual({ registrado: false });
    const sqls = queryMock.mock.calls.map(([sql]) => String(sql));
    expect(sqls).toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
    expect(sqls.some((sql) => /INSERT INTO scans/.test(sql))).toBe(false);
  });

  it('con la marca escrita inserta el scan y hace COMMIT antes de devolver registrado=true', async () => {
    queryMock.mockImplementation(async (sql: string) =>
      /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) ? {} : { rowCount: 1, rows: [{ marcadoAt: '2026-06-15 08:00:00', llegadaTarde: false, salidaAnticipada: false }] });

    const result = await registerScan(scan, 'IN', 5, null);

    expect(result).toEqual({ registrado: true, reporte: null });
    const sqls = queryMock.mock.calls.map(([sql]) => String(sql));
    expect(sqls.some((sql) => /INSERT INTO scans/.test(sql))).toBe(true);
    expect(sqls[sqls.length - 1]).toBe('COMMIT');
  });
});

describe('getHorasSemanalesVsObjetivo — objetivo pendiente', () => {
  it('expone minutosObjetivoPendiente (null si no hay) y lo agrupa en el SQL', async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [
        { userContextId: 1, nombre: 'Ana', apellido: 'Gómez', minutosObjetivo: '2880', minutosObjetivoPendiente: '2400', minutosTrabajados: '0' },
        { userContextId: 2, nombre: 'Luis', apellido: 'Paz', minutosObjetivo: '1440', minutosObjetivoPendiente: null, minutosTrabajados: '545' },
      ],
    });

    const filas = await getHorasSemanalesVsObjetivo({ fechaInicio: '2026-10-05', fechaFin: '2026-10-10' });

    expect(filas.map(f => f.minutosObjetivoPendiente)).toEqual([2400, null]);
    expect(filas[1]).toMatchObject({ minutosObjetivo: 1440, minutosTrabajados: 545 });
    const [sql] = (pool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('uho.minutos_objetivo_pendiente');
    expect(sql).toMatch(/GROUP BY[^)]*uho\.minutos_objetivo_pendiente/);
  });
});

describe('getHorasExcedentesSemanales — licencias', () => {
  it('descuenta del objetivo las horas de licencia aplicadas a los turnos de la semana', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ userContextId: 15, minutos: '125' }] });

    const filas = await getHorasExcedentesSemanales(new Date(2026, 8, 28), new Date(2026, 9, 3, 13));

    expect(filas).toEqual([{ userContextId: 15, minutos: 125 }]);
    const [sql] = (pool.query as jest.Mock).mock.lastCall;
    expect(sql).toMatch(/SUM\(minutos_licencia\)/);
    expect(sql).not.toContain('cantidad_minutos');
  });

  it('parte los turnos que cruzan el sábado 13 hs: lo anterior va a la semana y lo posterior a extras', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

    await getHorasExcedentesSemanales(new Date(2026, 8, 28), new Date(2026, 9, 3, 13));
    const [sqlSemana] = (pool.query as jest.Mock).mock.lastCall;
    await getHorasExtrasPostSabado(new Date(2026, 9, 3, 13), new Date(2026, 9, 4));
    const [sqlExtras] = (pool.query as jest.Mock).mock.lastCall;

    expect(sqlSemana).toContain('SUM(total - post)');
    expect(sqlExtras).toContain('SUM(post)');
    for (const sql of [sqlSemana, sqlExtras]) {
      expect(sql).toMatch(/LEAST\(p\.minutos_trabajados, GREATEST\(0/);
      expect(sql).toContain("time '13:00'");
    }
  });

  it('los feriados suman a las horas trabajadas como un día más (no van directo a extras)', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

    await getHorasExcedentesSemanales(new Date(2026, 8, 28), new Date(2026, 9, 3, 13));

    const [sql] = (pool.query as jest.Mock).mock.lastCall;
    expect(sql).not.toMatch(/\bferiado\s*(=|IS)/i);
    expect(sql).not.toContain('horas_feriados');
  });
});

describe('getUsuariosSinMarcarHoy — un aviso por turno', () => {
  it('reclama el aviso en el mismo UPDATE: entrada a la mitad del turno, salida tras la gracia', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [{ userContextId: 3, nombre: 'Ana', apellido: 'G', rolNombre: 'empleado-super', falta: 'ENTRADA' }] });

    const filas = await getUsuariosSinMarcarHoy();

    expect(filas).toHaveLength(1);
    const [sql, params] = (pool.query as jest.Mock).mock.lastCall;
    expect(params).toEqual([SALIDA_GRACIA_MINUTOS]);
    expect(sql).toContain('UPDATE planificacion_diaria');
    expect(sql).toContain('aviso_entrada_at IS NULL');
    expect(sql).toContain('aviso_salida_at IS NULL');
    expect(sql).toMatch(/planificacion_fin_turno\(pd\.id\) - pd\.esperado_in\) \/ 2/);
    expect(sql).toContain('SKIP LOCKED');
  });
});

describe('calcularHorasTrabajadasRecientes — horas según marcados', () => {
  it('ejecuta el UPDATE con la ventana como parámetro y devuelve cuántos turnos cambiaron', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rowCount: 7 });

    const actualizados = await calcularHorasTrabajadasRecientes();

    expect(actualizados).toBe(7);
    expect(pool.query).toHaveBeenCalledWith(SQL_CALCULAR_HORAS_TRABAJADAS, [1]);
  });

  it('acepta una ventana mayor (backfill) y devuelve 0 si el driver no informa rowCount', async () => {
    (pool.query as jest.Mock).mockClear();
    (pool.query as jest.Mock).mockResolvedValue({});

    expect(await calcularHorasTrabajadasRecientes(7)).toBe(0);
    expect((pool.query as jest.Mock).mock.calls[0][1][0]).toBe(7);
  });


  describe('SQL', () => {
    const sql = SQL_CALCULAR_HORAS_TRABAJADAS;

    it('resta las licencias por horas (APROBADA/CONSUMIDA) que caen dentro del intervalo trabajado', () => {
      expect(sql).toContain('FROM solicitudes_ausencia sa');
      expect(sql).toContain("sa.estado IN ('APROBADA', 'CONSUMIDA')");
      expect(sql).toContain('sa.cantidad_minutos IS NOT NULL');
      expect(sql).toMatch(/END - COALESCE\(lic\.solape, 0\)\) AS minutos/);
    });

    it('solo toca turnos sin licencia y con entrada marcada', () => {
      expect(sql).toMatch(/p\.licencia = false/);
      expect(sql).toMatch(/p\.marcado_in_at IS NOT NULL/);
    });

    it('usa la hora argentina explícita para "hoy" y la ventana de días', () => {
      expect(sql).toContain("now() AT TIME ZONE 'America/Argentina/Buenos_Aires'");
      expect(sql).toMatch(/BETWEEN[\s\S]*- \$1::int[\s\S]*AND/);
    });

    it('aplica las tres reglas en orden: salida marcada, fin de turno, y jornada fija para el corrido', () => {
      const iSalida = sql.indexOf('WHEN p.marcado_out_at IS NOT NULL');
      const iFinTurno = sql.indexOf('WHEN p.esperado_out IS NOT NULL');
      const iCorrido = sql.indexOf('ELSE jornada_corrido_minutos(uho.minutos_objetivo)');
      expect(iSalida).toBeGreaterThan(-1);
      expect(iFinTurno).toBeGreaterThan(iSalida);
      expect(iCorrido).toBeGreaterThan(iFinTurno);
    });

    it('cuenta la entrada desde esperado_in o desde la marca si llegó tarde (llegar antes no suma)', () => {
      expect(sql).toContain('p.marcado_out_at - GREATEST(p.esperado_in, p.marcado_in_at)');
      expect(sql).toContain('p.esperado_out - GREATEST(p.esperado_in, p.marcado_in_at)');
    });

    it('calcula en minutos, nunca da negativo y es idempotente (solo escribe si cambia)', () => {
      expect(sql).toContain('/ 60.0)::int');
      expect(sql).not.toContain('360');
      expect(sql).toMatch(/GREATEST\(0, ROUND/);
      expect(sql).toMatch(/minutos_trabajados IS DISTINCT FROM c\.minutos/);
    });

    it('no hardcodea la jornada del corrido: la toma de jornada_corrido_minutos() (única definición)', () => {
      expect(sql).not.toMatch(/\b(240|480|1800)\b/);
      expect(sql).toContain('make_interval(mins => jornada_corrido_minutos(uho.minutos_objetivo))');
    });
  });
});

describe('getTurnosSemanaProyeccion', () => {
  it('trae empleados (mismos filtros que la vista semanal) y sus turnos con minutos esperados y realizados', async () => {
    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock)
      .mockResolvedValueOnce({ rows: [{ userContextId: 7, nombre: 'Mateo', apellido: 'B', minutosObjetivo: '2880', minutosObjetivoPendiente: null, minutosLicencia: '60', minutosSaldoFrancos: '570', ahora: new Date(2026, 9, 20, 10) }] })
      .mockResolvedValueOnce({ rows: [{ id: '850', userContextId: 7, fecha: '2026-10-20', turno: 'Mañana', esperadoIn: new Date(2026, 9, 20, 10), fin: new Date(2026, 9, 20, 12), licencia: false, marcadoInAt: null, marcadoOutAt: null, minutosEsperados: '90', minutosRealizados: '90' }] });

    const res = await getTurnosSemanaProyeccion({ fechaInicio: '2026-10-19', fechaFin: '2026-10-25', idRolViewer: 4 });

    expect(res.usuarios[0]).toMatchObject({ minutosLicencia: 60, minutosSaldoFrancos: 570 });
    expect(res.turnos[0]).toMatchObject({ id: 850, minutosEsperados: 90, minutosRealizados: 90 });
    const [sqlUsuarios, paramsUsuarios] = (pool.query as jest.Mock).mock.calls[0];
    expect(sqlUsuarios).toContain('planificacion_ahora_ar() AS ahora');
    expect(sqlUsuarios).toContain('saldos_francos');
    expect(paramsUsuarios).toEqual(['2026-10-19', '2026-10-25', null, null, 4]);
    const [sqlTurnos, paramsTurnos] = (pool.query as jest.Mock).mock.calls[1];
    // Mismo cálculo de minutos por marcas que el cron (fragmento compartido)
    expect(sqlTurnos).toContain('WHEN p.marcado_out_at IS NOT NULL');
    expect(sqlTurnos).toContain('lic_esp.solape');
    expect(paramsTurnos).toEqual(['2026-10-19', '2026-10-25', [7]]);
  });

  it('sin empleados no consulta turnos', async () => {
    (pool.query as jest.Mock).mockReset();
    (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

    const res = await getTurnosSemanaProyeccion({ fechaInicio: '2026-10-19', fechaFin: '2026-10-25' });

    expect(res.usuarios).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});


describe('getSaldosVacacionesTodos', () => {
  it('filtra por VACACIONES con INNER JOIN y usa el parámetro de rol', async () => {
    (pool.query as jest.Mock).mockResolvedValue({
      rows: [{ userContextId: 7, nombre: 'Ana', apellido: 'Gómez', rolNombre: 'empleado-super', diasOtorgados: '140', diasConsumidos: '35' }],
    });

    const filas = await getSaldosVacacionesTodos({ idRolViewer: 2 });

    expect(filas).toEqual([{ userContextId: 7, nombre: 'Ana', apellido: 'Gómez', rolNombre: 'empleado-super', diasOtorgados: 140, diasConsumidos: 35 }]);
    const [sql, params] = (pool.query as jest.Mock).mock.lastCall;
    expect(sql).toContain("t.codigo = 'VACACIONES'");
    expect(sql).not.toMatch(/LEFT JOIN/);
    expect(sql).not.toContain('anio');
    expect(sql).toContain('vi.id_rol >= $1');
    expect(params).toEqual([2]);
  });

  it('sin rol pasa null', async () => {
    (pool.query as jest.Mock).mockResolvedValue({ rows: [] });

    await getSaldosVacacionesTodos({});

    const [, params] = (pool.query as jest.Mock).mock.lastCall;
    expect(params).toEqual([null]);
  });
});
