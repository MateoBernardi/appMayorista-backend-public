/**
 * Tests de adapters/db: executeApprovalTransaction — consumo de saldos_francos (minutos)
 * al aprobar un Franco por días: se debita siempre el total y el saldo neto puede quedar negativo.
 * La aplicación a los turnos (y el consumo del franco por horas) la hace el callback recibido (licenciasTurnosServices).
 * Capa: Adapter (DB)
 */

jest.mock('../../adapters/db/pgClient', () => ({
  pool: { connect: jest.fn(), query: jest.fn() },
}));

import { pool } from '../../adapters/db/pgClient';
import { executeApprovalTransaction, executeCancellationTransaction } from '../../adapters/db/licenciasRepo';

const connectMock = pool.connect as jest.Mock;

type QueryCall = { sql: string; params: unknown[] };

/** Crea un client mockeado cuyo `query` responde según el texto del SQL. */
const makeClient = (options: {
  saldoRow?: { minutos_disponibles: number; minutos_consumidos: number } | undefined;
}) => {
  const calls: QueryCall[] = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO saldos_francos ') && sql.includes('ON CONFLICT')) {
      const disponibles = options.saldoRow?.minutos_disponibles ?? 0;
      const nuevaConsumida = (options.saldoRow?.minutos_consumidos ?? 0) + Number(params[1]);
      return Promise.resolve({ rows: [{ minutos_disponibles: disponibles, minutos_consumidos: nuevaConsumida }] });
    }
    if (sql.includes('UPDATE solicitudes_ausencia')) {
      return Promise.resolve({ rows: [{ id: params[0] }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn(), calls };
};

const noop = async () => undefined;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('executeApprovalTransaction — consumo de francos', () => {
  const upsert = (c: ReturnType<typeof makeClient>) =>
    c.calls.find(x => x.sql.includes('INSERT INTO saldos_francos ') && x.sql.includes('ON CONFLICT'));

  it('consume el total solicitado aunque exceda el saldo (queda negativo)', async () => {
    const client = makeClient({ saldoRow: { minutos_disponibles: 300, minutos_consumidos: 0 } });
    connectMock.mockResolvedValue(client);

    await executeApprovalTransaction(1, 20, 'OK', null, { userContextId: 10, minutos: 480 }, noop);

    expect(upsert(client)?.params).toEqual([10, 480]);
    const insertCall = client.calls.find(c => c.sql.includes("'consumo'"));
    expect(insertCall?.params).toEqual([10, 480, 300, 480, 1]);
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true);
  });

  it('consume el total solicitado cuando el saldo alcanza', async () => {
    const client = makeClient({ saldoRow: { minutos_disponibles: 1200, minutos_consumidos: 120 } });
    connectMock.mockResolvedValue(client);

    await executeApprovalTransaction(1, 20, 'OK', null, { userContextId: 10, minutos: 480 }, noop);

    expect(upsert(client)?.params).toEqual([10, 480]);
  });

  it('debita igual cuando el saldo ya es 0 o negativo', async () => {
    const client = makeClient({ saldoRow: { minutos_disponibles: 180, minutos_consumidos: 360 } });
    connectMock.mockResolvedValue(client);

    await executeApprovalTransaction(1, 20, 'OK', null, { userContextId: 10, minutos: 480 }, noop);

    expect(upsert(client)?.params).toEqual([10, 480]);
    expect(client.calls.some(c => c.sql.includes("'consumo'"))).toBe(true);
  });

  it('crea la fila (upsert) cuando el usuario no tiene saldos_francos todavía', async () => {
    const client = makeClient({ saldoRow: undefined });
    connectMock.mockResolvedValue(client);

    await expect(
      executeApprovalTransaction(1, 20, 'OK', null, { userContextId: 10, minutos: 480 }, noop)
    ).resolves.toBeUndefined();

    expect(upsert(client)?.params).toEqual([10, 480]);
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true);
  });

  it('no toca saldos_francos cuando no hay francoUpdate', async () => {
    const client = makeClient({ saldoRow: undefined });
    connectMock.mockResolvedValue(client);

    await executeApprovalTransaction(1, 20, 'OK', null, null,noop);

    expect(upsert(client)).toBeUndefined();
  });

  it('invoca el callback de aplicar la licencia después de aprobar, con el client y antes del COMMIT', async () => {
    const client = makeClient({ saldoRow: undefined });
    connectMock.mockResolvedValue(client);
    const orden: string[] = [];
    const aplicar = jest.fn(async () => { orden.push(`cb:${client.calls.length}`); });

    await executeApprovalTransaction(7, 20, 'OK', null, null,aplicar);

    expect(aplicar).toHaveBeenCalledWith(client);
    const sqls = client.calls.map(c => c.sql);
    const iAprobar = sqls.findIndex(s => s.includes('UPDATE solicitudes_ausencia'));
    const nAlCallback = Number(orden[0].split(':')[1]);
    expect(nAlCallback).toBeGreaterThan(iAprobar);
    expect(sqls.indexOf('COMMIT')).toBeGreaterThanOrEqual(nAlCallback);
    expect(sqls.some(s => s.includes('aplicar_licencia'))).toBe(false);
  });

  it('si el callback falla hace ROLLBACK y propaga el error', async () => {
    const client = makeClient({ saldoRow: undefined });
    connectMock.mockResolvedValue(client);

    await expect(
      executeApprovalTransaction(7, 20, 'OK', null, null,async () => { throw new Error('boom'); })
    ).rejects.toThrow('boom');
    expect(client.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(false);
  });
});

/** Client que responde por fragmento de SQL (el primero que matchea). */
const makeSqlClient = (respuestas: [string, unknown[]][]) => {
  const calls: QueryCall[] = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const hit = respuestas.find(([frag]) => sql.includes(frag));
    return Promise.resolve({ rows: hit ? hit[1] : [] });
  });
  return { query, release: jest.fn(), calls };
};

const SELECT_SALDO = 'FROM saldos_ausencia';

describe('executeApprovalTransaction — saldo de días', () => {
  it('bloquea la fila, calcula sobre ella y guarda descuento y residuo en el saldo y la solicitud', async () => {
    const client = makeSqlClient([[SELECT_SALDO, [{ dias_otorgados: 140, dias_consumidos: 20, residuo: 9 }]]]);
    connectMock.mockResolvedValue(client);
    const calcular = jest.fn(() => ({ dias: 80, nuevoResiduo: 19 }));

    await executeApprovalTransaction(1, 20, 'OK', { usuarioId: 10, tipoId: 1, calcular }, null, noop);

    const select = client.calls.find(c => c.sql.includes(SELECT_SALDO))!;
    expect(select.sql).toContain('FOR UPDATE');
    expect(select.params).toEqual([10, 1]);
    expect(calcular).toHaveBeenCalledWith({ dias_otorgados: 140, dias_consumidos: 20, residuo: 9 });

    const updSaldo = client.calls.find(c => c.sql.includes('UPDATE saldos_ausencia'))!;
    expect(updSaldo.sql).toContain('dias_consumidos = dias_consumidos + $3');
    expect(updSaldo.sql).toContain('tipo_licencia_id = $2');
    expect(updSaldo.params).toEqual([10, 1, 80, 19]);

    const updSol = client.calls.find(c => c.sql.includes('UPDATE solicitudes_ausencia'))!;
    expect(updSol.params).toEqual([1, 'APROBADA', 20, 'OK', 9, 80]);
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true);
  });

  it('guarda residuo_al_aprobar 0 (no null) cuando el residuo previo es 0', async () => {
    const client = makeSqlClient([[SELECT_SALDO, [{ dias_otorgados: 140, dias_consumidos: 0, residuo: 0 }]]]);
    connectMock.mockResolvedValue(client);

    await executeApprovalTransaction(1, 20, 'OK', { usuarioId: 10, tipoId: 1, calcular: () => ({ dias: 70, nuevoResiduo: 0 }) }, null, noop);

    const updSol = client.calls.find(c => c.sql.includes('UPDATE solicitudes_ausencia'))!;
    expect(updSol.params[4]).toBe(0);
  });

  it('si el cálculo tira error (saldo insuficiente) hace ROLLBACK sin tocar el saldo', async () => {
    const client = makeSqlClient([[SELECT_SALDO, [{ dias_otorgados: 10, dias_consumidos: 0, residuo: 0 }]]]);
    connectMock.mockResolvedValue(client);

    await expect(executeApprovalTransaction(1, 20, 'OK', {
      usuarioId: 10, tipoId: 1, calcular: () => { throw new Error('Saldo insuficiente'); },
    }, null, noop)).rejects.toThrow('Saldo insuficiente');

    expect(client.calls.some(c => c.sql.includes('UPDATE saldos_ausencia'))).toBe(false);
    expect(client.calls.some(c => c.sql === 'ROLLBACK')).toBe(true);
  });
});

describe('executeCancellationTransaction — reintegro de días', () => {
  const fecha = new Date('2027-01-10T10:00:00');

  it('lee la cancelada y las posteriores en orden de aprobación, resta lo devuelto y re-encadena las posteriores', async () => {
    const client = makeSqlClient([
      [SELECT_SALDO, [{ dias_otorgados: 140, dias_consumidos: 90, residuo: 5 }]],
      ['WHERE id = $1 FOR UPDATE', [{ id: 2, cantidad_dias: 20, residuo_al_aprobar: 30, dias_descontados: 20, fecha_respuesta: fecha }]],
      ['ORDER BY fecha_respuesta, id', [{ id: 3, cantidad_dias: 10, residuo_al_aprobar: 50, dias_descontados: 25, fecha_respuesta: fecha }]],
    ]);
    connectMock.mockResolvedValue(client);
    const recalcular = jest.fn(() => ({
      diasADevolver: 35, nuevoResiduo: 40, posteriores: [{ id: 3, residuo_al_aprobar: 30, dias_descontados: 10 }],
    }));

    await executeCancellationTransaction(2, { usuarioId: 10, tipoId: 1, recalcular }, null, true, noop);

    expect(recalcular).toHaveBeenCalledWith(
      { id: 2, cantidad_dias: 20, residuo_al_aprobar: 30, dias_descontados: 20 },
      [{ id: 3, cantidad_dias: 10, residuo_al_aprobar: 50, dias_descontados: 25 }],
    );
    const posteriores = client.calls.find(c => c.sql.includes('ORDER BY fecha_respuesta, id'))!;
    expect(posteriores.sql).toContain("estado IN ('APROBADA', 'CONSUMIDA')");
    expect(posteriores.params).toEqual([10, 1, 2, fecha]);

    const updSaldo = client.calls.find(c => c.sql.includes('UPDATE saldos_ausencia'))!;
    expect(updSaldo.sql).toContain('dias_consumidos = dias_consumidos - $3');
    expect(updSaldo.params).toEqual([10, 1, 35, 40]);

    const updPosterior = client.calls.find(c => c.sql.includes('SET residuo_al_aprobar'))!;
    expect(updPosterior.params).toEqual([3, 30, 10]);
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true);
  });

  it('sin saldo no toca saldos_ausencia', async () => {
    const client = makeSqlClient([]);
    connectMock.mockResolvedValue(client);

    await executeCancellationTransaction(2, null, null, false, noop);

    expect(client.calls.some(c => c.sql.includes('saldos_ausencia'))).toBe(false);
    expect(client.calls.some(c => c.sql === 'COMMIT')).toBe(true);
  });
});
