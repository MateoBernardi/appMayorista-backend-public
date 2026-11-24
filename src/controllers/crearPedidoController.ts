import { Request, Response, NextFunction } from 'express';
import { enviarRemitoCorreoService, fetchCreatePedido } from '../domain/services/crearPedidoService';
import { asAppError, BadRequestError } from '../adapters/errors/AppError';
import { ClienteInfo } from '../adapters/inputs_outputs/generarRemito';

export const crearPedidoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id_cliente, estado, id_condicion, articulos, pagoData, fecha } = req.body;
    const pedidoData = { id_cliente, estado, id_condicion, fecha };
    const resultado = await fetchCreatePedido(pedidoData, articulos, pagoData);
    res.status(201).json({ success: true, pedido: resultado.pedido, detalle: resultado.detalle });
  } catch (error: any) {
    next(asAppError(error, "No se pudo crear pedido"));
  }
};

export const enviarRemitoController = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { nro_pedido, ...clienteData } = req.body;

    if (!nro_pedido) {
      throw new BadRequestError('Nro de pedido y datos del cliente son requeridos');
    }

    const requiredFields = ['nombre', 'direccion', 'email'] as const;
    const missingFields = requiredFields.filter(
      field => typeof clienteData[field] !== 'string' || clienteData[field].trim().length === 0
    );
    if (missingFields.length > 0) {
      throw new BadRequestError(`Faltan datos del cliente: ${missingFields.join(', ')}`);
    }

    const clienteInfo: ClienteInfo = {
      nombre: clienteData.nombre,
      direccion: clienteData.direccion,
      localidad: clienteData.localidad || '',
      cuit_dni: clienteData.cuit_dni || '',
      email: clienteData.email,
    };

    await enviarRemitoCorreoService(parseInt(nro_pedido), clienteInfo);

    res.status(200).json({ success: true, message: 'Remito enviado por correo' });
  } catch (error: any) {
    console.error('[enviarRemitoController]', error);
    next(asAppError(error, 'No se pudo enviar el remito'));
  }
};
