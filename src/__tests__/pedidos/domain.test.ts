jest.mock('../../adapters/db/pedidosRepo');
jest.mock('../../adapters/db/clientesRepo');
jest.mock('../../domain/validations/pedidosValidations');
jest.mock('../../domain/services/detallePedidosServices');

import * as pedidosRepo from '../../adapters/db/pedidosRepo';
import * as clientesRepo from '../../adapters/db/clientesRepo';
import * as pedidosValidations from '../../domain/validations/pedidosValidations';
import * as detallePedidosServices from '../../domain/services/detallePedidosServices';
import {
  datosPedido,
  pagoValido,
  fetchPedidosService,
  updateEstado,
  deletePedidoService
} from '../../domain/services/pedidosServices';
import { describe } from 'node:test';

const mockPedidosRepo = jest.mocked(pedidosRepo);
const mockClientesRepo = jest.mocked(clientesRepo);
const mockValidations = jest.mocked(pedidosValidations);
const mockDetallePedidosServices = jest.mocked(detallePedidosServices);

const validPedido = { id_cliente: 1, estado: 'pendiente', id_condicion: 2 } as any;
const validPago = { nro_pedido: 1, medio_pago: 'efectivo', monto: 1000 } as any;

describe('PedidosServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockValidations.pedidoValidator.validateData as jest.Mock).mockReturnValue([]);
    (mockValidations.pagosValidator.validateData as jest.Mock).mockReturnValue([]);
    (mockValidations.validateEstadoPedido as jest.Mock).mockReturnValue(null);
  });

  describe('datosPedido', () => {
    it('should return errors when cliente is not found', async () => {
      mockClientesRepo.getClienteById.mockResolvedValue(null as any);
      const errors = await datosPedido(validPedido);
      expect(errors).toEqual([{ campo: 'id_cliente', error: 'Cliente no encontrado' }]);
      expect(mockPedidosRepo.getCondicionVentaById).not.toHaveBeenCalled();
    });

    it('should return errors when condicion is not found', async () => {
      mockClientesRepo.getClienteById.mockResolvedValue({ id_cliente: 1 } as any);
      mockPedidosRepo.getCondicionVentaById.mockResolvedValue(null as any);
      const errors = await datosPedido(validPedido);
      expect(errors).toEqual([{ campo: 'id_condicion', error: 'Condición de venta no encontrada' }]);
    });

    it('should return validator errors when DTO is invalid', async () => {
      mockClientesRepo.getClienteById.mockResolvedValue({ id_cliente: 1 } as any);
      mockPedidosRepo.getCondicionVentaById.mockResolvedValue({ id: 2 } as any);
      (mockValidations.pedidoValidator.validateData as jest.Mock).mockReturnValue([
        { fila: 1, errores: ['estado inválido'] },
      ]);
      const errors = await datosPedido(validPedido);
      expect(errors).toEqual([{ fila: 1, errores: ['estado inválido'] }]);
    });

    it('should return empty array when all data is valid', async () => {
      mockClientesRepo.getClienteById.mockResolvedValue({ id_cliente: 1 } as any);
      mockPedidosRepo.getCondicionVentaById.mockResolvedValue({ id: 2 } as any);
      const errors = await datosPedido(validPedido);
      expect(errors).toEqual([]);
    });
  });

  describe('pagoValido', () => {
    it('should return empty array when pago data is valid', async () => {
      const errors = await pagoValido(validPago);
      expect(mockValidations.pagosValidator.validateData).toHaveBeenCalled();
      expect(errors).toEqual([]);
    });

    it('should return validator errors when pago data is invalid', async () => {
      (mockValidations.pagosValidator.validateData as jest.Mock).mockReturnValue([
        { fila: 1, errores: ['monto debe ser mayor a cero'] },
      ]);
      const errors = await pagoValido(validPago);
      expect(errors).toEqual([{ fila: 1, errores: ['monto debe ser mayor a cero'] }]);
    });
  });

  describe('fetchPedidosService', () => {
    it('should delegate to getPedidos and return results for an state', async () => {
      const pedidos = [{ nro_pedido: 1 }] as any;
      mockPedidosRepo.getPedidos.mockResolvedValue(pedidos);
      const result = await fetchPedidosService(1, 30, undefined, 'preparado', undefined, undefined);
      expect(mockPedidosRepo.getPedidos).toHaveBeenCalledWith(1, 30, undefined, 'preparado', undefined, undefined);
      expect(result).toBe(pedidos);
    });
  });

  describe('fetchPedidosService', () => {
    it('should delegate to getPedidos and return results for a cliente', async () => {
      const pedidos = [{ nro_pedido: 2 }] as any;
      mockPedidosRepo.getPedidos.mockResolvedValue(pedidos);
      const result = await fetchPedidosService(1, 30, 1, undefined, undefined, undefined);
      expect(mockPedidosRepo.getPedidos).toHaveBeenCalledWith(1, 30, 1, undefined, undefined, undefined);
      expect(result).toBe(pedidos);
    });
  });

  describe('fetchPedidosService', () => {
    it('should delegate to getPedidos and return results for a date range', async () => {
      const pedidos = [{ nro_pedido: 2 }] as any;
      mockPedidosRepo.getPedidos.mockResolvedValue(pedidos);
      const result = await fetchPedidosService(1, 30, undefined, undefined, '2023-01-01', '2023-12-31');
      expect(mockPedidosRepo.getPedidos).toHaveBeenCalledWith(1, 30, undefined, undefined, '2023-01-01', '2023-12-31');
      expect(result).toBe(pedidos);
    });
  });

  describe('updateEstado', () => {
    it('should throw when pedido is not found', async () => {
      mockPedidosRepo.getPedidoByNumero.mockResolvedValue(null as any);
      await expect(updateEstado(999, 'preparado')).rejects.toThrow('Pedido no encontrado');
      expect(mockPedidosRepo.updateEstadoPedido).not.toHaveBeenCalled();
    });

    it('should propagate errors from validateEstadoPedido', async () => {
      mockPedidosRepo.getPedidoByNumero.mockResolvedValue({ nro_pedido: 1 } as any);
      (mockValidations.validateEstadoPedido as jest.Mock).mockImplementation(() => {
        throw new Error('Estado de pedido inválido');
      });
      await expect(updateEstado(1, 'cancelado')).rejects.toThrow('Estado de pedido inválido');
      expect(mockPedidosRepo.updateEstadoPedido).not.toHaveBeenCalled();
    });

    it('should update estado when validations pass', async () => {
      mockPedidosRepo.getPedidoByNumero.mockResolvedValue({ nro_pedido: 1, estado: 'pendiente' } as any);
      mockPedidosRepo.updateEstadoPedido.mockResolvedValue(undefined as any);
      await updateEstado(1, 'preparado');
      expect(mockPedidosRepo.updateEstadoPedido).toHaveBeenCalledWith(1, 'preparado');
    });
  });

  describe ('deletePedido', () => {
    it('should delete pedido succesfully', async () => {
      const mockDetalle = [{ nro_pedido: 1, codigo_articulo: 'A01' }] as any;
      mockDetallePedidosServices.fetchDetallePedido.mockResolvedValue(mockDetalle);
      mockPedidosRepo.deletePedido.mockResolvedValue(undefined as any);
      await deletePedidoService(1);
      expect(mockPedidosRepo.deletePedido).toHaveBeenCalledWith(mockDetalle);
    });
  });
});
