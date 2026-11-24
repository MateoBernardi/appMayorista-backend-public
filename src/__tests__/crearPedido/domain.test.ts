jest.mock('../../adapters/db/crearPedidoRepo');
jest.mock('../../adapters/db/detallePedidosRepo');
jest.mock('../../adapters/db/clientesRepo');
jest.mock('../../domain/services/detallePedidosServices');
jest.mock('../../domain/services/pedidosServices');
jest.mock('../../adapters/inputs_outputs/generarRemito');
jest.mock('../../adapters/comunications/sendMail');

import * as crearPedidoRepo from '../../adapters/db/crearPedidoRepo';
import * as clientesRepo from '../../adapters/db/clientesRepo';
import * as detalleRepo from '../../adapters/db/detallePedidosRepo';
import * as detallePedidosServices from '../../domain/services/detallePedidosServices';
import * as pedidosServices from '../../domain/services/pedidosServices';
import * as generarRemito from '../../adapters/inputs_outputs/generarRemito';
import * as sendMailModule from '../../adapters/comunications/sendMail';
import { enviarRemitoCorreoService, fetchCreatePedido } from '../../domain/services/crearPedidoService';

const mockRepo = jest.mocked(crearPedidoRepo);
const mockRepoClientes = jest.mocked(clientesRepo);
const mockRepoDetalle = jest.mocked(detalleRepo);
const mockDetalle = jest.mocked(detallePedidosServices);
const mockPedidos = jest.mocked(pedidosServices);
const mockCreatePDF = jest.mocked(generarRemito);

const validPedido = { id_cliente: 1, estado: 'pendiente', id_condicion: 2 } as any;
const validPago = { nro_pedido: 1, medio_pago: 'efectivo', monto: 1000 } as any;
const validArticulos = [
  { codigo_articulo: 100, articulo: 'Prod', cantidad: 2, precio_unitario: 50, total: 100, total_pedido: 100 },
] as any;

describe('CrearPedidoService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPedidos.datosPedido.mockResolvedValue([]);
    mockPedidos.pagoValido.mockResolvedValue([]);
    mockDetalle.validarArticulosParaPedido.mockResolvedValue(validArticulos);
    mockRepo.crearPedidoTransaccional.mockResolvedValue({ nro_pedido: 1 } as any);
  });

  describe('fetchCreatePedido', () => {
    it('should throw when articulosPedido is not an array', async () => {
      await expect(
        fetchCreatePedido(validPedido, 'not-an-array' as any, validPago)
      ).rejects.toThrow('articulosPedido debe ser un array');
      expect(mockRepo.crearPedidoTransaccional).not.toHaveBeenCalled();
    });

    it('should call validarArticulosParaPedido with the articles array', async () => {
      await fetchCreatePedido(validPedido, validArticulos, validPago);
      expect(mockDetalle.validarArticulosParaPedido).toHaveBeenCalledWith(validArticulos);
    });

    it('should propagate errors thrown by validarArticulosParaPedido', async () => {
      mockDetalle.validarArticulosParaPedido.mockRejectedValue(new Error('Stock insuficiente'));
      await expect(
        fetchCreatePedido(validPedido, validArticulos, validPago)
      ).rejects.toThrow('Stock insuficiente');
      expect(mockRepo.crearPedidoTransaccional).not.toHaveBeenCalled();
    });

    it('should call crearPedidoTransaccional with all three arguments on happy path', async () => {
      const transaction = { nro_pedido: 42 };
      mockRepo.crearPedidoTransaccional.mockResolvedValue(transaction as any);
      const result = await fetchCreatePedido(validPedido, validArticulos, validPago);
      expect(mockRepo.crearPedidoTransaccional).toHaveBeenCalledWith(
        validPedido,
        validArticulos,
        validPago
      );
      expect(result).toBe(transaction);
    });

    it('should propagate errors from crearPedidoTransaccional', async () => {
      mockRepo.crearPedidoTransaccional.mockRejectedValue(new Error('DB error'));
      await expect(
        fetchCreatePedido(validPedido, validArticulos, validPago)
      ).rejects.toThrow('DB error');
    });
  });

  describe('enviarRemitoCorreoService', () => {
    const numeroPedido = 1;
    const clienteInfo = { nombre: 'Cliente', direccion: 'Calle 123', localidad: 'Ciudad', cuit_dni: '12345678', email: 'cliente@ejemplo.com' };
    const mockPDF = {} as any;
    const detalle = [{ nro_pedido: numeroPedido, codigo_articulo: 100, articulo: 'Prod', cantidad: 2, precio_unitario: 50, monto_total: 100, fecha: new Date('2026-06-15T00:00:00'), condicion_venta: 'Contado', medio_pago: 'Efectivo' }];
    const detalleResult = { detalle, monto_total_pedido: 100 };

    it('should delegate PDF generation to the middleware', async () => {
      mockRepoDetalle.getDetallePedido.mockResolvedValue(detalleResult);
      mockCreatePDF.generarComprobantesPDF.mockReturnValue(mockPDF);

      await enviarRemitoCorreoService(numeroPedido, clienteInfo);

      expect(mockCreatePDF.generarComprobantesPDF).toHaveBeenCalledWith([
        { cliente: clienteInfo, remito: expect.objectContaining({ numero: '1' }), detalle },
      ]);
    });

    it('should send the generated PDF via email', async () => {
      mockRepoDetalle.getDetallePedido.mockResolvedValue(detalleResult);
      mockCreatePDF.generarComprobantesPDF.mockReturnValue(mockPDF);
      const sendMailMock = jest.mocked(sendMailModule.sendRemitoMail).mockResolvedValue(undefined);

      await enviarRemitoCorreoService(numeroPedido, clienteInfo);

      expect(sendMailMock).toHaveBeenCalledWith(clienteInfo.email, 'Remito - Italo Argentina', mockPDF);
    });

    it('should reject with 404 and not send mail when the pedido has no detalle', async () => {
      mockRepoDetalle.getDetallePedido.mockResolvedValue({ detalle: [], monto_total_pedido: 0 });
      const sendMailMock = jest.mocked(sendMailModule.sendRemitoMail);

      await expect(enviarRemitoCorreoService(numeroPedido, clienteInfo)).rejects.toMatchObject({
        statusCode: 404,
        message: 'No se encontraron detalles para ese pedido',
      });
      expect(mockCreatePDF.generarComprobantesPDF).not.toHaveBeenCalled();
      expect(sendMailMock).not.toHaveBeenCalled();
    });
  });
  
});
