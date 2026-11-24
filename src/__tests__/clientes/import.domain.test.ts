jest.mock('../../adapters/db/clientesRepo');

import * as clientesRepo from '../../adapters/db/clientesRepo';
import { importClientesService } from '../../domain/services/clientesServices';
import { ClienteImportDTO, LocalidadDTO } from '../../domain/dto/ClienteDTO';

const mockClientesRepo = jest.mocked(clientesRepo);

const localidadCordoba: LocalidadDTO = {
  id_localidad: 5,
  nombre: 'Cordoba',
  zona: 'centro',
  codigo_postal: '5000',
};

const condicionIvaConsumidorFinal = { id_condicion: 1, descripcion: 'TEST_Consumidor Final' };

const makeRow = (overrides: Partial<ClienteImportDTO> = {}): ClienteImportDTO => ({
  descripcion: 'Cliente Uno',
  localidad: 'Cordoba',
  cuit: '20-12345678-6',
  direccion: 'Calle 1',
  ...overrides,
});

describe('importClientesService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClientesRepo.getCondicionIvaPorDescripcion.mockResolvedValue(condicionIvaConsumidorFinal);
    mockClientesRepo.getAllLocalidades.mockResolvedValue([localidadCordoba]);
    mockClientesRepo.getClientesByCuitsOrEmails.mockResolvedValue([]);
  });

  it('returns 0 for an empty file without touching the repo', async () => {
    const result = await importClientesService([]);
    expect(result).toBe(0);
    expect(mockClientesRepo.getCondicionIvaPorDescripcion).not.toHaveBeenCalled();
    expect(mockClientesRepo.createClientesBulk).not.toHaveBeenCalled();
  });

  it('validates rows, resolves the localidad and condicion iva, and inserts returning the repo count', async () => {
    const rows: ClienteImportDTO[] = [
      makeRow({ cuit: '20-12345678-6', telefono: '3511234567', email: 'uno@test.com' }),
      makeRow({ descripcion: 'Cliente Dos', localidad: 'cordoba', cuit: '20-98765432-6' }),
    ];
    mockClientesRepo.createClientesBulk.mockResolvedValue(2);

    const result = await importClientesService(rows);

    expect(result).toBe(2);
    expect(mockClientesRepo.createClientesBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        descripcion: 'Cliente Uno',
        cuit: '20-12345678-6',
        id_localidad: 5,
        id_condicion_iva: 1,
        email: 'uno@test.com',
        telefonos: [{ telefono: '3511234567', tipo: 'principal' }],
      }),
      expect.objectContaining({
        descripcion: 'Cliente Dos',
        cuit: '20-98765432-6',
        id_localidad: 5,
        id_condicion_iva: 1,
        email: '',
        telefonos: [],
      }),
    ]);
  });

  it('rejects the whole file when a row has an invalid CUIT check digit', async () => {
    const rows: ClienteImportDTO[] = [
      makeRow({ cuit: '20-12345678-6' }),
      makeRow({ descripcion: 'Cliente Dos', cuit: '20-12345678-9' }),
    ];

    await expect(importClientesService(rows)).rejects.toThrow('Clientes inválidos');
    expect(mockClientesRepo.createClientesBulk).not.toHaveBeenCalled();
  });

  it('rejects the whole file when a row references an unknown localidad', async () => {
    const rows: ClienteImportDTO[] = [makeRow({ localidad: 'Ciudad Inexistente' })];

    await expect(importClientesService(rows)).rejects.toThrow(/no existe/);
    expect(mockClientesRepo.createClientesBulk).not.toHaveBeenCalled();
  });

  it('rejects the whole file when the same cuit appears twice in the file', async () => {
    const rows: ClienteImportDTO[] = [
      makeRow({ cuit: '20-12345678-6' }),
      makeRow({ descripcion: 'Cliente Dos', cuit: '20-12345678-6' }),
    ];

    await expect(importClientesService(rows)).rejects.toThrow(/duplicado/);
    expect(mockClientesRepo.createClientesBulk).not.toHaveBeenCalled();
  });

  it('defaults telefono to an empty array and email to an empty string when absent', async () => {
    const rows: ClienteImportDTO[] = [makeRow()];
    mockClientesRepo.createClientesBulk.mockResolvedValue(1);

    await importClientesService(rows);

    expect(mockClientesRepo.createClientesBulk).toHaveBeenCalledWith([
      expect.objectContaining({ telefonos: [], email: '' }),
    ]);
  });

  it('throws AppError 500 when the default condicion iva cannot be resolved', async () => {
    mockClientesRepo.getCondicionIvaPorDescripcion.mockResolvedValue(undefined);
    const rows: ClienteImportDTO[] = [makeRow()];

    await expect(importClientesService(rows)).rejects.toThrow(/Consumidor Final/);
    expect(mockClientesRepo.createClientesBulk).not.toHaveBeenCalled();
  });

  it('rejects the whole file when the cuit already exists in the database', async () => {
    mockClientesRepo.getClientesByCuitsOrEmails.mockResolvedValue([{ cuit: '20-12345678-6', email: null }]);
    const rows: ClienteImportDTO[] = [makeRow({ cuit: '20-12345678-6' })];

    await expect(importClientesService(rows)).rejects.toThrow('Clientes inválidos');
    expect(mockClientesRepo.createClientesBulk).not.toHaveBeenCalled();
  });
});
