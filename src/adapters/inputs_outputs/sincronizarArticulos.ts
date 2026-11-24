import fs from 'fs';
import readline from 'readline';
import { ArticuloDTO } from '../../domain/dto/ArticuloDTO';

export const procesarArchivoArticulos = async (filePath: string): Promise<ArticuloDTO[]> => {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    const articulos: ArticuloDTO[] = [];

    for await (const line of rl) {
        const cleanLine = line.trim();
        if (!cleanLine) continue;

        const valores = cleanLine.split(';').map((v: string) => v.trim());

        const codigo_articulo = parseInt(valores[0] || '', 10) || 0;
        const descripcion = (valores[1] || '').trim();
        const cod_barra_articulo = parseInt(valores[2] || '', 10) || 0;
        const cod_barra_caja = parseInt(valores[3] || '', 10) || 0;

        const unidadesCaja = parseInt((valores[4] || '').replace(/^0+/, '') || '0', 10);
        const cant_unidades_caja = unidadesCaja === 0 ? 1 : unidadesCaja;

        const precioLimpio = (v: string) => parseFloat(v.replace(/^0+/, '') || '0') || 0;
        const precio_costo = precioLimpio(valores[5] || '');
        const precio_venta = precioLimpio(valores[6] || '');
        const precio_venta_volumen = precioLimpio(valores[7] || '');

        const stock_actual = parseFloat((valores[8] || '').replace(/^0+/, '') || '0') || 0;

        const rentabilidadLimpia = (valores[9] || '').replace(/^0+/, '') || '0';
        let rentabilidad_minima = parseFloat(rentabilidadLimpia) / 100 || 0;

        const rubroRaw = (valores[10] || '').trim();
        const rubro = rubroRaw.charAt(0);

        if (rubro === 'I') {
            rentabilidad_minima = 0;
        }

        let venta_tipo: 'unidad' | 'kilogramo' | undefined;
        if (rubroRaw.length === 2 && (rubroRaw[0] === 'I' || rubroRaw[0] === 'M')) {
            const x = rubroRaw[1];
            if (x === 'U' || x === 'B') venta_tipo = 'unidad';
            else if (x === 'K') venta_tipo = 'kilogramo';
        }

        if (codigo_articulo && descripcion.length > 0) {
            articulos.push({
                codigo_articulo,
                descripcion,
                cod_barra_articulo,
                cod_barra_caja,
                cant_unidades_caja,
                precio_costo,
                precio_venta,
                precio_venta_volumen,
                stock_actual,
                rentabilidad_minima,
                rubro,
                ...(venta_tipo !== undefined && { venta_tipo }),
            });
        }
    }

    return articulos;
};
