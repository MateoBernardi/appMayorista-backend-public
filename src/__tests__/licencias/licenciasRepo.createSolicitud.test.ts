/**
 * Tests de adapters/db: createSolicitud — vínculo de archivos adjuntos al crear.
 * solicitudes_archivos tiene (solicitud_id, archivo_id): insertar en otra columna
 * hacía fallar el INSERT y se deshacía toda la creación.
 * Capa: Adapter (DB)
 */

jest.mock('../../adapters/db/pgClient', () => ({
  pool: { connect: jest.fn(), query: jest.fn() },
}));

import { pool } from '../../adapters/db/pgClient';
import { createSolicitud } from '../../adapters/db/licenciasRepo';

const connectMock = pool.connect as jest.Mock;

type QueryCall = { sql: string; params: unknown[] };

const makeClient = () => {
  const calls: QueryCall[] = [];
  const query = jest.fn((sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('INSERT INTO solicitudes_ausencia')) {
      return Promise.resolve({ rows: [{ id: 55 }] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn(), calls };
};

const data = {
  tipo_licencia_id: 3,
  fecha_inicio: '2026-10-20',
  observacion: 'obs',
} as any;

beforeEach(() => jest.clearAllMocks());

describe('createSolicitud — archivos adjuntos', () => {
  it('vincula los archivos en solicitudes_archivos (solicitud_id, archivo_id)', async () => {
    const client = makeClient();
    connectMock.mockResolvedValue(client);

    await createSolicitud(7, { ...data, archivosIds: [10, 11] }, new Date('2026-10-21'), 2, null, 'PENDIENTE' as any);

    const insert = client.calls.find((c) => c.sql.includes('INSERT INTO solicitudes_archivos'));
    expect(insert).toBeDefined();
    expect(insert!.sql).toMatch(/solicitudes_archivos\s*\(\s*solicitud_id\s*,\s*archivo_id\s*\)/);
    expect(insert!.params).toEqual([55, 10, 11]);
    expect(client.calls.some((c) => c.sql === 'COMMIT')).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('sin archivos no toca solicitudes_archivos', async () => {
    const client = makeClient();
    connectMock.mockResolvedValue(client);

    await createSolicitud(7, data, new Date('2026-10-21'), 2, null, 'PENDIENTE' as any);

    expect(client.calls.some((c) => c.sql.includes('solicitudes_archivos'))).toBe(false);
  });
});
