/**
 * Tests de adapters/db: getSaldoFrancoByUsuario + regresión SQL de upsertHorarios.
 * Capa: Adapter (DB)
 */

jest.mock('../../adapters/db/pgClient', () => ({
  pool: { connect: jest.fn(), query: jest.fn() },
}));

import { pool } from '../../adapters/db/pgClient';
import {
  getSaldoFrancoByUsuario,
  getExtraHorasSaldoActual,
  liquidarHorasFranco,
  getMovimientosByUsuario,
} from '../../adapters/db/saldosFrancosRepo';
import { upsertHorarios, acreditarHorasFrancos } from '../../adapters/db/horariosRepo';
import { AppError } from '../../adapters/errors/AppError';
import { HorariosDTO } from '../../domain/dto/HorariosDTO';

const connectMock = pool.connect as jest.Mock;
const queryMock = pool.query as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('getSaldoFrancoByUsuario', () => {
  it('devuelve el saldo en minutos cuando existe la fila', async () => {
    queryMock.mockResolvedValue({ rows: [{ minutos_disponibles: 750, minutos_consumidos: 180 }] });

    const saldo = await getSaldoFrancoByUsuario(10);

    expect(saldo).toEqual({ minutos_disponibles: 750, minutos_consumidos: 180 });
  });

  it('devuelve 0/0 cuando el usuario no tiene fila', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    const saldo = await getSaldoFrancoByUsuario(99);

    expect(saldo).toEqual({ minutos_disponibles: 0, minutos_consumidos: 0 });
  });
});

describe('upsertHorarios — regresión SQL (Fix 1 y Fix 2)', () => {
  const makeDto = (overrides: Partial<HorariosDTO> = {}): HorariosDTO => ({
    userContextId: 1,
    fecha: new Date('2026-06-15'),
    turno: 'M',
    horario_in: new Date('2026-06-15T09:00:00'),
    horario_out: new Date('2026-06-15T17:00:00'),
    sede_id_in: 10,
    sede_id_out: 10,
    licencia: false,
    feriado: false,
    ...overrides,
  });

  const captureInsert = async (rows: HorariosDTO[]): Promise<string> => {
    const client = {
      query: jest.fn((sql: string) => Promise.resolve({ rowCount: rows.length, rows: [] })),
      release: jest.fn(),
    };
    connectMock.mockResolvedValue(client);
    await upsertHorarios(rows, jest.fn().mockResolvedValue(undefined));
    const insert = client.query.mock.calls
      .map((c) => c[0] as string)
      .find((s) => s.includes('INSERT INTO planificacion_diaria'));
    expect(insert).toBeDefined();
    return insert as string;
  };

  const countChar = (s: string, ch: string): number => s.split(ch).length - 1;

  it('los paréntesis del INSERT están balanceados', async () => {
    const sql = await captureInsert([makeDto()]);
    expect(countChar(sql, '(')).toBe(countChar(sql, ')'));
  });

  it('no genera tuplas partidas (el bug `),(ROUND` no debe aparecer)', async () => {
    const sql = await captureInsert([makeDto()]);
    expect(/\)\s*,\s*\(ROUND/.test(sql)).toBe(false);
  });

  it('no escribe minutos_trabajados (queda en su default; el feriado sigue con COALESCE)', async () => {
    const sql = await captureInsert([makeDto()]);
    expect(sql).not.toContain('minutos_trabajados');
    expect(sql).toContain('COALESCE(');
  });

  it('escala con múltiples filas manteniendo paréntesis balanceados', async () => {
    const sql = await captureInsert([makeDto(), makeDto({ userContextId: 2 })]);
    expect(countChar(sql, '(')).toBe(countChar(sql, ')'));
    expect(/\)\s*,\s*\(ROUND/.test(sql)).toBe(false);
  });
});

describe('upsertHorarios — aplica las licencias aprobadas a los turnos', () => {
  const dto: HorariosDTO = {
    userContextId: 7,
    fecha: new Date('2026-10-20'),
    turno: 'Mañana',
    horario_in: new Date('2026-10-20T09:00:00'),
    horario_out: new Date('2026-10-20T12:00:00'),
    sede_id_in: 1,
    sede_id_out: 1,
    licencia: false,
    feriado: false,
  };

  const run = async (returned: { id: number; minutos_licencia: number }[]) => {
    const client = {
      query: jest.fn((sql: string) =>
        Promise.resolve(sql.includes('INSERT INTO planificacion_diaria') ? { rowCount: returned.length, rows: returned } : { rows: [] })),
      release: jest.fn(),
    };
    connectMock.mockResolvedValue(client);
    const aplicar = jest.fn().mockResolvedValue(undefined);
    await upsertHorarios([dto], aplicar);
    const calls = client.query.mock.calls.map((c: unknown[]) => ({ sql: c[0] as string, params: c[1] }));
    return { calls, aplicar, client };
  };

  it('aplica las licencias a los turnos sin licencia aplicada, antes del COMMIT', async () => {
    const orden: string[] = [];
    const client = {
      query: jest.fn((sql: string) => {
        orden.push(sql.includes('INSERT INTO planificacion_diaria') ? 'INSERT' : sql);
        return Promise.resolve(sql.includes('INSERT INTO planificacion_diaria')
          ? { rowCount: 2, rows: [{ id: 850, minutos_licencia: 0 }, { id: 851, minutos_licencia: 45 }] }
          : { rows: [] });
      }),
      release: jest.fn(),
    };
    connectMock.mockResolvedValue(client);
    const aplicar = jest.fn(async () => { orden.push('APLICAR'); });

    await upsertHorarios([dto], aplicar);

    expect(aplicar).toHaveBeenCalledWith(client, [850]);
    expect(orden.indexOf('APLICAR')).toBeGreaterThan(orden.indexOf('INSERT'));
    expect(orden.indexOf('COMMIT')).toBeGreaterThan(orden.indexOf('APLICAR'));
    expect(orden.some(s => s.includes('aplicar_licencias_a_turnos'))).toBe(false);
  });

  it('no invoca el callback si todos ya tenían licencia aplicada', async () => {
    const { aplicar } = await run([{ id: 851, minutos_licencia: 45 }]);

    expect(aplicar).not.toHaveBeenCalled();
  });
});

describe('getExtraHorasSaldoActual', () => {
  it('devuelve el diff disponibles − consumidas, incluso negativo (sin clampear)', async () => {
    queryMock.mockResolvedValue({
      rows: [
        { userContextId: 1, nombre: 'Ana', apellido: 'Pérez', minutos: 570 },
        { userContextId: 2, nombre: 'Beto', apellido: 'Gómez', minutos: -180 },
      ],
    });

    const result = await getExtraHorasSaldoActual({});

    expect(result).toEqual([
      { userContextId: 1, nombre: 'Ana', apellido: 'Pérez', minutos: 570 },
      { userContextId: 2, nombre: 'Beto', apellido: 'Gómez', minutos: -180 },
    ]);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain('sf.minutos_disponibles - sf.minutos_consumidos');
  });

  it('pasa los filtros como parámetros', async () => {
    queryMock.mockResolvedValue({ rows: [] });

    await getExtraHorasSaldoActual({ userContextId: 7, rolNombre: 'gerencia' });

    expect(queryMock).toHaveBeenCalledWith(expect.any(String), [7, 'gerencia']);
  });
});

describe('liquidarHorasFranco', () => {
  // `selectResult` responde al SELECT ... FOR UPDATE (balance actual antes de liquidar);
  // `updateResult` responde al UPDATE (balance luego de liquidar), si no se llega a ejecutar.
  const makeClient = (
    selectResult: { rowCount: number; rows: any[] },
    updateResult?: { rowCount: number; rows: any[] }
  ) => ({
    query: jest.fn((sql: string) => {
      if (sql.includes('FOR UPDATE')) return Promise.resolve(selectResult);
      if (sql.includes('UPDATE saldos_francos')) return Promise.resolve(updateResult ?? { rowCount: 1, rows: [] });
      return Promise.resolve({ rowCount: 1, rows: [] });
    }),
    release: jest.fn(),
  });

  it('incrementa solo minutos_consumidos y escribe un movimiento liquidacion', async () => {
    const client = makeClient(
      { rowCount: 1, rows: [{ minutos_disponibles: 600, minutos_consumidos: 0 }] },
      { rowCount: 1, rows: [{ minutos_disponibles: 600, minutos_consumidos: 75 }] }
    );
    connectMock.mockResolvedValue(client);

    const saldo = await liquidarHorasFranco(3, 75);

    expect(saldo).toEqual({ minutos_disponibles: 600, minutos_consumidos: 75 });

    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    // Se hace SELECT ... FOR UPDATE antes de mutar (defensa contra carreras).
    expect(sqls.some((s) => s.includes('FOR UPDATE'))).toBe(true);
    // El UPDATE toca minutos_consumidos pero NO minutos_disponibles.
    const update = sqls.find((s) => s.includes('UPDATE saldos_francos')) as string;
    expect(update).toContain('minutos_consumidos = minutos_consumidos + $2');
    expect(update).not.toContain('minutos_disponibles =');
    // Se inserta un movimiento tipo liquidacion.
    const insert = sqls.find((s) => s.includes('INSERT INTO saldos_francos_movimientos')) as string;
    expect(insert).toContain("'liquidacion'");
    // Commit ejecutado.
    expect(sqls).toContain('COMMIT');
  });

  it('lanza AppError(404) cuando el usuario no tiene fila de saldo', async () => {
    const client = makeClient({ rowCount: 0, rows: [] });
    connectMock.mockResolvedValue(client);

    await expect(liquidarHorasFranco(999, 50)).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 404,
    });
    await expect(liquidarHorasFranco(999, 50)).rejects.toBeInstanceOf(AppError);

    // No debe insertarse ningún movimiento y debe hacer ROLLBACK.
    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes('INSERT INTO saldos_francos_movimientos'))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
  });

  it('lanza AppError(422) cuando se pide liquidar más que el saldo disponible', async () => {
    // disponible = 600 - 420 = 180 minutos (3 h); se piden 181.
    const client = makeClient({ rowCount: 1, rows: [{ minutos_disponibles: 600, minutos_consumidos: 420 }] });
    connectMock.mockResolvedValue(client);

    await expect(liquidarHorasFranco(3, 181)).rejects.toMatchObject({
      name: 'AppError',
      statusCode: 422,
      message: expect.stringContaining('3 hs'),
    });

    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    // No debe llegar a mutar el balance ni insertar movimiento; debe hacer ROLLBACK.
    expect(sqls.some((s) => s.includes('UPDATE saldos_francos'))).toBe(false);
    expect(sqls.some((s) => s.includes('INSERT INTO saldos_francos_movimientos'))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
  });

  it('permite liquidar exactamente el saldo disponible (borde, no lanza)', async () => {
    const client = makeClient(
      { rowCount: 1, rows: [{ minutos_disponibles: 600, minutos_consumidos: 300 }] },
      { rowCount: 1, rows: [{ minutos_disponibles: 600, minutos_consumidos: 600 }] }
    );
    connectMock.mockResolvedValue(client);

    const saldo = await liquidarHorasFranco(3, 300);

    expect(saldo).toEqual({ minutos_disponibles: 600, minutos_consumidos: 600 });
    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    expect(sqls).toContain('COMMIT');
  });
});

describe('getMovimientosByUsuario', () => {
  it('devuelve movimientos en minutos ordenados por created_at DESC', async () => {
    const createdAt = new Date('2026-06-15T10:00:00Z');
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 5,
          tipo_movimiento: 'consumo',
          minutos: 45,
          minutos_disponibles_resultante: 600,
          minutos_consumidos_resultante: 240,
          created_at: createdAt,
        },
      ],
    });

    const desde = new Date('2026-06-01');
    const hasta = new Date('2026-07-01');
    const result = await getMovimientosByUsuario(7, desde, hasta);

    expect(result).toEqual([
      {
        id: 5,
        tipoMovimiento: 'consumo',
        minutos: 45,
        minutosDisponiblesResultante: 600,
        minutosConsumidosResultante: 240,
        createdAt,
      },
    ]);
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), [7, desde, hasta]);
    const sql = queryMock.mock.calls[0][0] as string;
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('WHERE user_context_id = $1 AND created_at >= $2 AND created_at < $3');
  });

  it('mapea los snapshots de saldo a null cuando faltan', async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 6,
          tipo_movimiento: 'ajuste_manual',
          minutos: 30,
          minutos_disponibles_resultante: null,
          minutos_consumidos_resultante: null,
          created_at: new Date('2026-06-16T00:00:00Z'),
        },
      ],
    });

    const result = await getMovimientosByUsuario(7, new Date('2026-06-01'), new Date('2026-07-01'));

    expect(result[0].minutosDisponiblesResultante).toBeNull();
    expect(result[0].minutosConsumidosResultante).toBeNull();
  });
});

describe('acreditarHorasFrancos — escribe movimientos acreditacion', () => {
  const makeClient = (ledgerRowCount: number) => ({
    query: jest.fn((sql: string) => {
      if (sql.includes('resumen_semanal_ejecutado')) {
        return Promise.resolve({ rowCount: ledgerRowCount, rows: ledgerRowCount ? [{ semana: '2026-06-20' }] : [] });
      }
      if (sql.includes('saldos_francos_movimientos')) {
        return Promise.resolve({ rowCount: 1, rows: [] });
      }
      return Promise.resolve({ rowCount: 0, rows: [] });
    }),
    release: jest.fn(),
  });

  it('inserta un movimiento acreditacion junto al upsert de balance', async () => {
    const client = makeClient(1);
    connectMock.mockResolvedValue(client);

    await acreditarHorasFrancos([{ userContextId: 1, minutos: 180 }], new Date('2026-06-20'));

    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    const upsertMov = sqls.find((s) => s.includes('saldos_francos_movimientos')) as string;
    expect(upsertMov).toBeDefined();
    expect(upsertMov).toContain("'acreditacion'");
    // El cast debe ser INT (no NUMERIC) y debe actualizar updated_at.
    expect(upsertMov).toContain('minutos INT');
    expect(upsertMov).not.toContain('minutos NUMERIC');
    expect(upsertMov).toContain('updated_at = now()');
    expect(sqls).toContain('COMMIT');
  });

  it('re-corrida idempotente (semana ya ejecutada) no upserta ni inserta movimientos', async () => {
    const client = makeClient(0);
    connectMock.mockResolvedValue(client);

    const res = await acreditarHorasFrancos([{ userContextId: 1, minutos: 180 }], new Date('2026-06-20'));

    expect(res).toBe(-1);
    const sqls = client.query.mock.calls.map((c) => c[0] as string);
    expect(sqls.some((s) => s.includes('saldos_francos_movimientos'))).toBe(false);
    expect(sqls).toContain('ROLLBACK');
  });
});
