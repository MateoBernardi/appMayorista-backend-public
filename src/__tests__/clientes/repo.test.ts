jest.mock('../../adapters/db/pgClient', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  },
}));

import { pool } from '../../adapters/db/pgClient';
import { searchClientesRepo } from '../../adapters/db/clientesRepo';

const mockPool = jest.mocked(pool);

describe('clientesRepo - searchClientesRepo', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockPool.query as jest.Mock).mockResolvedValue({ rows: [] });
  });

  it('no consulta la DB y retorna [] si la query está vacía o son solo espacios', async () => {
    const result = await searchClientesRepo('   ');

    expect(mockPool.query).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('filtra por deleted_at IS NULL y limita a 30 resultados', async () => {
    await searchClientesRepo('Perez');

    const [sql] = (mockPool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('c.deleted_at IS NULL');
    expect(sql).toContain('LIMIT 30');
  });

  it('busca en descripcion, localidad (l.nombre) y direccion', async () => {
    await searchClientesRepo('Perez');

    const [sql] = (mockPool.query as jest.Mock).mock.calls[0];
    expect(sql).toContain('c.descripcion ILIKE');
    expect(sql).toContain('l.nombre ILIKE');
    expect(sql).toContain('c.direccion ILIKE');
    expect(sql).toContain('JOIN localidades l ON c.id_localidad = l.id_localidad');
  });

  it('para una sola palabra, arma 2 parámetros (ilike + raw) además de la query completa', async () => {
    await searchClientesRepo('Perez');

    const [, values] = (mockPool.query as jest.Mock).mock.calls[0];
    // $1 = query completa, $2 = '%Perez%', $3 = 'Perez'
    expect(values).toEqual(['Perez', '%Perez%', 'Perez']);
  });

  it('para múltiples palabras, escala los parámetros y exige que TODAS matcheen (AND)', async () => {
    await searchClientesRepo('Juan Perez');

    const [sql, values] = (mockPool.query as jest.Mock).mock.calls[0];
    // $1 = query completa, $2-$3 = ilike de cada palabra, $4-$5 = raw de cada palabra
    expect(values).toEqual(['Juan Perez', '%Juan%', '%Perez%', 'Juan', 'Perez']);
    expect(sql).toMatch(/\$2.*AND.*\$3/s);
  });

  it('ignora espacios extra entre palabras al tokenizar', async () => {
    await searchClientesRepo('  Juan   Perez  ');

    const [, values] = (mockPool.query as jest.Mock).mock.calls[0];
    expect(values).toEqual(['  Juan   Perez  ', '%Juan%', '%Perez%', 'Juan', 'Perez']);
  });

  it('retorna las filas obtenidas de la DB', async () => {
    const rows = [{ id_cliente: 1, descripcion: 'Perez', nombre: 'Villa Allende' }];
    (mockPool.query as jest.Mock).mockResolvedValue({ rows });

    const result = await searchClientesRepo('Perez');

    expect(result).toBe(rows);
  });
});
