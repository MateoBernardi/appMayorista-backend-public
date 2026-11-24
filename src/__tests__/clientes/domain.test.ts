jest.mock('../../adapters/db/clientesRepo');
jest.mock('../../adapters/db/pedidosRepo');
jest.mock('../../domain/validations/clientesValidations');

import * as clientesRepo from '../../adapters/db/clientesRepo';
import * as pedidosRepo from '../../adapters/db/pedidosRepo';
import * as clientesValidations from '../../domain/validations/clientesValidations';
import {
  fetchClientes,
  NewCliente,
  updateClienteFields,
  removeCliente,
  getClientesVisitadosHoy,
  fetchAllLocalidades,
  fetchZonasDisponibles,
  fetchClientesPorLocalidad,
  searchClientesService,
} from '../../domain/services/clientesServices';

const mockClientesRepo = jest.mocked(clientesRepo);
const mockPedidosRepo = jest.mocked(pedidosRepo);
const mockValidations = jest.mocked(clientesValidations);

describe('ClientesServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockValidations.clienteValidator.validateData as jest.Mock).mockReturnValue([]);
    (mockValidations.validateClienteUpdate as jest.Mock).mockReturnValue(null);
    (mockValidations.validateSearchQuery as jest.Mock).mockReturnValue(true);
  });

  describe('fetchClientes', () => {
    it('should delegate to getAllActiveClients and return results', async () => {
      const clientes = [{ id_cliente: 1, descripcion: 'Test' }] as any;
      mockClientesRepo.getAllActiveClients.mockResolvedValue(clientes);
      const result = await fetchClientes('norte');
      expect(mockClientesRepo.getAllActiveClients).toHaveBeenCalledWith('norte');
      expect(result).toBe(clientes);
    });
  });

  describe('searchClientesService', () => {
    it('should validate search query and return results', async () => {
      const clientes = [{ id_cliente: 1, descripcion: 'Test' }] as any;
      mockClientesRepo.searchClientesRepo.mockResolvedValue(clientes);
      const result = await searchClientesService('Test');
      expect(mockValidations.validateSearchQuery).toHaveBeenCalledWith('Test');
      expect(mockClientesRepo.searchClientesRepo).toHaveBeenCalledWith('Test');
      expect(result).toBe(clientes);
    });

    it('should return an empty array without querying the repo when the query is invalid', async () => {
      (mockValidations.validateSearchQuery as jest.Mock).mockReturnValue(false);
      const result = await searchClientesService('   ');
      expect(mockClientesRepo.searchClientesRepo).not.toHaveBeenCalled();
      expect(result).toEqual([]);
    });
  });

  describe('NewCliente', () => {
    const clienteData = {
      descripcion: 'Test Cliente',
      direccion: 'Calle 1',
      cuit: '20-12345678-9',
      id_condicion_iva: 1,
      telefonos: [],
      id_localidad: 1,
    } as any;

    it('should validate and create a cliente returning its new id', async () => {
      mockClientesRepo.createCliente.mockResolvedValue(5);
      const result = await NewCliente(clienteData);
      expect(mockValidations.clienteValidator.validateData).toHaveBeenCalledWith([clienteData]);
      expect(mockClientesRepo.createCliente).toHaveBeenCalledWith(clienteData);
      expect(result).toBe(5);
    });

    it('should propagate errors thrown by the validator', async () => {
      (mockValidations.clienteValidator.validateData as jest.Mock).mockImplementation(() => {
        throw new Error('Datos inválidos');
      });
      await expect(NewCliente(clienteData)).rejects.toThrow('Datos inválidos');
      expect(mockClientesRepo.createCliente).not.toHaveBeenCalled();
    });
  });

  describe('updateClienteFields', () => {
    it('should validate and update, returning result', async () => {
      const updated = { success: true };
      mockClientesRepo.updateCliente.mockResolvedValue(updated as any);
      const result = await updateClienteFields(1, { descripcion: 'New' });
      expect(mockValidations.validateClienteUpdate).toHaveBeenCalledWith(1, { descripcion: 'New' });
      expect(mockClientesRepo.updateCliente).toHaveBeenCalledWith(1, { descripcion: 'New' });
      expect(result).toBe(updated);
    });

    it('should throw when repo returns null/undefined (not found)', async () => {
      mockClientesRepo.updateCliente.mockResolvedValue(null as any);
      await expect(updateClienteFields(99, { descripcion: 'x' })).rejects.toThrow('no encontrado');
    });

    it('should propagate errors from validateClienteUpdate', async () => {
      (mockValidations.validateClienteUpdate as jest.Mock).mockImplementation(() => {
        throw new Error('ID inválido');
      });
      await expect(updateClienteFields(-1, {})).rejects.toThrow('ID inválido');
      expect(mockClientesRepo.updateCliente).not.toHaveBeenCalled();
    });
  });

  describe('removeCliente', () => {
    it('should throw when cliente has pending or prepared pedidos', async () => {
      mockPedidosRepo.getPedidos.mockImplementation(async (page: number, limit: number, id_cliente: number, estado: string, fecha_inicio: string | undefined, fecha_fin: string | undefined) => {
        if (estado === 'pendiente') return [{ id_cliente: 1 }] as any;
        return [];
      });
      await expect(removeCliente(1)).rejects.toThrow('pedidos en estado pendiente');
      expect(mockClientesRepo.deleteCliente).not.toHaveBeenCalled();
    });

    it('should block deletion when cliente has a prepared pedido', async () => {
      mockPedidosRepo.getPedidos.mockImplementation(async (page: number, limit: number, id_cliente: number, estado: string, fecha_inicio: string | undefined, fecha_fin: string | undefined) => {
        if (estado === 'preparado') return [{ id_cliente: 2 }] as any;
        return [];
      });
      await expect(removeCliente(2)).rejects.toThrow('pedidos en estado pendiente o preparado');
    });

    it('should delete and return cliente when no active pedidos exist', async () => {
      mockPedidosRepo.getPedidos.mockResolvedValue([]);
      const deleted = { id_cliente: 3 } as any;
      mockClientesRepo.deleteCliente.mockResolvedValue(deleted);
      const result = await removeCliente(3);
      expect(mockClientesRepo.deleteCliente).toHaveBeenCalledWith(3);
      expect(result).toBe(deleted);
    });
  });

  describe('getClientesVisitadosHoy', () => {
    it('should delegate to fetchClientesVisitadosZona', async () => {
      const data = { visitados: 5 } as any;
      mockClientesRepo.fetchClientesVisitadosZona.mockResolvedValue(data);
      const result = await getClientesVisitadosHoy('sur');
      expect(mockClientesRepo.fetchClientesVisitadosZona).toHaveBeenCalledWith('sur');
      expect(result).toBe(data);
    });
  });

  describe('fetchAllLocalidades', () => {
    it('should delegate to getAllLocalidades', async () => {
      const localidades = [{ id: 1, nombre: 'Córdoba' }] as any;
      mockClientesRepo.getAllLocalidades.mockResolvedValue(localidades);
      const result = await fetchAllLocalidades();
      expect(result).toBe(localidades);
    });
  });

  describe('fetchZonasDisponibles', () => {
    it('should delegate to getZonasDisponibles', async () => {
      const zonas = [{ zona: 1 }, { zona: 2 }] as any;
      mockClientesRepo.getZonasDisponibles.mockResolvedValue(zonas);
      const result = await fetchZonasDisponibles();
      expect(result).toBe(zonas);
    });
  });

  describe('fetchClientesPorLocalidad', () => {
    it('should delegate to getAllClientesByLocalidad', async () => {
      const id_localidad = 1;
      const clientes = [{ id_cliente: 1, descripcion: 'Cliente 1' }] as any;
      mockClientesRepo.getAllClientesByLocalidad.mockResolvedValue(clientes);
      const result = await fetchClientesPorLocalidad(id_localidad);
      expect(mockClientesRepo.getAllClientesByLocalidad).toHaveBeenCalledWith(id_localidad);
      expect(result).toBe(clientes);
    });
  });

});
