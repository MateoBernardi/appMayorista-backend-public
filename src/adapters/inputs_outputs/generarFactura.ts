import { getPedidosByIds } from '../db/pedidosRepo';
import { getDetallePedido } from '../db/detallePedidosRepo';

// Definimos una interfaz limpia para el retorno
interface ArchivoTextoResultado {
  fileName: string;
  contenido: string;
}

/**
 * Genera el contenido de un archivo .txt para todos los pedidos del día (en memoria)
 */
export async function generarFacturasTXT(pedidos_ids: number[]): Promise<ArchivoTextoResultado> {
    const lineas: string[] = [];
    const pedidos = await getPedidosByIds(pedidos_ids);

    if(pedidos === null || pedidos.length === 0) {
        throw new Error('No se encontraron pedidos para los IDs proporcionados');
    }

    for (const pedido of pedidos) {
        if(pedido.estado !== 'pendiente') {
            throw new Error('Solo se pueden generar facturas para pedidos en estado "pendiente"');
        }

        const detallePedido = await getDetallePedido(pedido.nro_pedido!);

        // Línea A
        const lineaA = [
            'A',
            pedido.nro_pedido ?? '',
            pedido.fecha,
            pedido.cuit,
            pedido.descripcion,
            pedido.direccion,
            pedido.nombre
        ].join(';');
        lineas.push(lineaA);

        // Líneas B
        for (const detalle of detallePedido.detalle) {
            const lineaB = [
                'B',
                pedido.nro_pedido ?? '',
                detalle.codigo_articulo,
                detalle.cantidad,
                detalle.precio_unitario,
            ].join(';');
            lineas.push(lineaB);
        }

    }
    
    const contenido = lineas.join('\n');
    const fileName = `Facturas.txt`;

    // Retornamos los datos listos para el controlador
    return { fileName, contenido };
}