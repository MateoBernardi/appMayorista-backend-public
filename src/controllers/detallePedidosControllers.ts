import { Request, Response, NextFunction } from 'express';
import { generarComprobantesPDF, formatearFechaRemito, PedidoInput } from '../adapters/inputs_outputs/generarRemito';
import { asAppError, BadRequestError, NotFoundError } from '../adapters/errors/AppError';
import { generarFacturasTXT } from '../adapters/inputs_outputs/generarFactura';
import { updateArticuloInPedidoService } from '../domain/services/detallePedidosServices';
import { updateEstado } from '../domain/services/pedidosServices';

export const generarFacturasTXTController = async (req: Request, res: Response, next: NextFunction) => {
  const pedidos_ids: number[] = req.body.pedidos_ids;

  try {
    const { fileName, contenido } = await generarFacturasTXT(pedidos_ids);

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    for (const nro_pedido of pedidos_ids) {
      await updateEstado(nro_pedido, 'preparado');
    }

    res.send(contenido);
    console.log(`Archivo virtual ${fileName} enviado correctamente`);
  } catch (err) {
    next(asAppError(err, 'Ocurrió un problema inesperado. Intentá de nuevo en unos minutos.'));
  }
};

export const getRemitoPDF = async (req: Request, res: Response, next: NextFunction) => {
  const nro_pedido = req.params.nro_pedido as string;
  const id_cliente = req.params.id_cliente as string;

  try {
    if (!nro_pedido || !id_cliente) {
      console.error('[getRemitoPDF] nro_pedido o id_cliente no proporcionado');
      throw new BadRequestError('Nro de pedido e id_cliente son requeridos');
    }

    const { getDetallePedido } = await import('../adapters/db/detallePedidosRepo');
    const { getClienteById } = await import('../adapters/db/clientesRepo');

    // 1. Obtener detalles del pedido
    const pedidoData = await getDetallePedido(Number(nro_pedido));
    const resultado = pedidoData.detalle;
    if (!resultado || resultado.length === 0) {
      console.warn('No se encontraron detalles para el pedido:', nro_pedido);
      throw new NotFoundError('No se encontraron detalles para ese pedido');
    }

    // 2. Obtener datos del cliente usando id_cliente recibido
    const cliente = await getClienteById(Number(id_cliente));
    if (!cliente) {
      console.warn('No se encontró el cliente:', id_cliente);
      throw new NotFoundError('No se encontró el cliente');
    }

    // 3. Armar objetos para el PDF
    const clienteInfo = {
      nombre: cliente.descripcion,
      direccion: cliente.direccion,
      localidad: cliente.nombre || '',
      cuit_dni: cliente.cuit || '',
      email: cliente.email || '',
    };
    const primerDetalle = resultado[0];
    const remitoInfo = {
      numero: nro_pedido,
      fecha: formatearFechaRemito(primerDetalle.fecha),
    };

    const filename = `remito_${remitoInfo.numero}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    const pedidoInput: PedidoInput = {
      cliente: clienteInfo,
      remito: remitoInfo,
      detalle: resultado
    };

    const pdfStream = generarComprobantesPDF([pedidoInput]);

    pdfStream.on('error', (error) => {
      console.error('Error generando PDF:', error);
      if (!res.headersSent) {
        next(asAppError(error, 'No se pudo generar el PDF'));
      }
    });

    pdfStream.pipe(res);

  } catch (err) {
    console.error('Error general:', err);
    next(asAppError(err, 'No se pudo generar el PDF'));
  }
};

export const getRemitosConsolidadosLogistica = async (req: Request, res: Response, next: NextFunction) => {
  const { listaPedidos } = req.body as { listaPedidos: { nro_pedido: number; id_cliente: number }[] };

  try {
    if (!listaPedidos || !Array.isArray(listaPedidos) || listaPedidos.length === 0) {
      throw new BadRequestError('Se requiere una lista de pedidos válida para consolidar.');
    }

    const { getDetallePedido } = await import('../adapters/db/detallePedidosRepo');
    const { getClienteById } = await import('../adapters/db/clientesRepo');

    const pedidosUnicos = Array.from(
      new Map(listaPedidos.map(item => [item.nro_pedido, item])).values()
    );

    const pedidosProcesados: PedidoInput[] = await Promise.all(
      pedidosUnicos.map(async (item) => {
        const pedidoData = await getDetallePedido(item.nro_pedido);
        const resultado = pedidoData.detalle;
        
        if (!resultado || resultado.length === 0) {
          throw new NotFoundError(`No se encontraron detalles para el pedido N° ${item.nro_pedido}`);
        }

        const cliente = await getClienteById(item.id_cliente);
        if (!cliente) {
          throw new NotFoundError(`No se encontró el cliente ID ${item.id_cliente}`);
        }

        return {
          cliente: {
            nombre: cliente.descripcion,
            direccion: cliente.direccion,
            localidad: cliente.nombre || '',
            cuit_dni: cliente.cuit || '',
            email: cliente.email || '',
            zona: cliente.zona || '',
          },
          remito: {
            numero: item.nro_pedido.toString(),
            fecha: formatearFechaRemito(resultado[0]?.fecha),
          },
          detalle: resultado,
        };
      })
    );

    // Agrupar los remitos por zona para que las hojas queden consecutivas por zona
    pedidosProcesados.sort((a, b) => (a.cliente.zona || '').localeCompare(b.cliente.zona || ''));

    const fechaHoy = new Date().toISOString().split('T')[0];
    const filename = `carga_camion_${fechaHoy}.pdf`;
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache');

    // Pasamos todo el arreglo. Si hay más de 1 pedido, incluye hoja de depósito final.
    const pdfStream = generarComprobantesPDF(pedidosProcesados);

    pdfStream.on('error', (error) => {
      console.error('Error generando PDF masivo:', error);
      if (!res.headersSent) next(asAppError(error, 'Error procesando consolidado'));
    });

    pdfStream.pipe(res);
  } catch (err) {
    next(asAppError(err, 'Error interno al generar el reporte de logística'));
  }
};

export const getDetallePedido = async (req: Request, res: Response, next: NextFunction) => {
  const nro_pedido = req.params.nro_pedido;
  try {
    if (!nro_pedido) {
      throw new BadRequestError('Nro de pedido es requerido');
    }
    // Modificado para obtener el monto total del pedido
    const { getDetallePedido } = await import('../adapters/db/detallePedidosRepo');
    const pedidoData = await getDetallePedido(Number(nro_pedido));
    const resultado = pedidoData.detalle;
    const monto_total_pedido = pedidoData.monto_total_pedido;
    if (!resultado || resultado.length === 0) {
      throw new NotFoundError('No se encontraron detalles para ese pedido');
    }
    res.json({
      detalle: resultado,
      monto_total_pedido
    });
  } catch (err) {
    next(asAppError(err, 'No se pudieron obtener detalles del pedido'));
  }
}

export const updateArticuloInPedidoController = async (req: Request, res: Response, next: NextFunction) => {
  const nro_pedido = req.params.nro_pedido as string;
  const action = req.params.action as string;
  const articulo = req.body;

  try {
    if (!nro_pedido || !articulo) {
      throw new BadRequestError('Nro de pedido y articulo son requeridos');
    }
    await updateArticuloInPedidoService(Number(nro_pedido), articulo, action);
    res.json({ message: 'Artículo actualizado correctamente' });
  } catch (err) {
    next(asAppError(err, 'No se pudo validar el artículo'));
  }
}
