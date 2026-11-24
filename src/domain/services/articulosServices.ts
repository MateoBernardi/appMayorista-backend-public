import { getAllArticulos, getArticulosBySearch, getArticulosSinStock, getArticulosPublicBySearch, getArticulosSobranteMayorista } from '../../adapters/db/articulosRepo';
import { deleteArticulosBulk, updateArticulosListRepo } from '../../adapters/db/articulosRepo';
import { validarOArrojar, codigosAEliminar, validateSearchField } from '../validations/articulosValidations';
import { ArticuloDTO, ArticuloPaginadoDTO, ArticuloBusquedaPublicaDTO } from '../dto/ArticuloDTO';
import { procesarArchivoArticulos } from '../../adapters/inputs_outputs/sincronizarArticulos';

export const fetchArticulos = async (rubro: string, page: number = 1, limit: number = 30, filter?: string, soloOfertas?: boolean): Promise<ArticuloPaginadoDTO> => {
  const articulosPaginados = await getAllArticulos(rubro, page, limit, filter, soloOfertas);
  return articulosPaginados;
};

export const fetchArticulosBySearch = async (
  palabra: string,
  rubro: string,
  campo?: string,
  page: number = 1,
  limit: number = 30
): Promise<ArticuloPaginadoDTO> => {
  if (!campo) {
    if (/^[^a-zA-Z]+$/.test(palabra)) {
      campo = 'codigo_articulo';
    } else {
      campo = 'descripcion';
    }
  }
  if (!validateSearchField(campo, palabra)) return { articulos: [], page, totalPages: 0, total: 0 };
  return getArticulosBySearch(palabra, rubro, campo as 'descripcion' | 'codigo_articulo', page, limit);
};

export const fetchArticulosPublicBySearch = async (
  palabra: string,
  rubro: string,
  seccionImagen: string,
): Promise<ArticuloBusquedaPublicaDTO> => {
  // No validamos campo, siempre busca por descripción (palabra clave)
  return await getArticulosPublicBySearch(palabra, rubro, seccionImagen);
};

export const procesarArticulosService = async (articulos: ArticuloDTO[]): Promise<number> => {
  if (articulos.length === 0) return 0;
  return syncArticulos(articulos);
};

export const procesarArticulosUploadService = async (filePath: string): Promise<number> => {
  const articulos = await procesarArchivoArticulos(filePath);
  return procesarArticulosService(articulos);
};

export const syncArticulos = async (articulos: ArticuloDTO[]): Promise<number> => {
  validarOArrojar(articulos);
  const count = await updateArticulosListService(articulos);
  await eliminarArticulosSinStock(articulos);
  return count;
};

export async function updateArticulosListService(articulos: ArticuloDTO[]): Promise<number> {
  const articulosInsertados = await updateArticulosListRepo(articulos);
  return articulosInsertados;
}

// 3. Extraer eliminación de artículos sin stock
export async function eliminarArticulosSinStock(articulos: ArticuloDTO[]): Promise<void> {
  const sinStock = await getArticulosSinStock();
  const codigos = codigosAEliminar(sinStock, articulos);
  await deleteArticulosBulk(codigos);
}

const padInt = (n: number, len: number) => String(Math.floor(Number(n))).padStart(len, '0');
const padStr = (s: string, len: number) => s.substring(0, len).padEnd(len, ' ');
const fmtPrice = (p: number) => parseFloat(String(p)).toFixed(2).padStart(12, '0');
const fmtStock = (stock: number, ventaTipo: string | undefined, len: number) => {
  const value = Number.isFinite(Number(stock)) ? Number(stock) : 0;
  if (ventaTipo === 'kilogramo') {
    const fixed = value.toFixed(3);
    const dotIdx = fixed.indexOf('.');
    return fixed.substring(0, dotIdx).padStart(len, '0') + '.' + fixed.substring(dotIdx + 1);
  }
  if (Number.isInteger(value)) {
    return padInt(value, len) + '.000';
  }
  return value.toFixed(3).padStart(len, '0');
};
const fmtBarcode = (b: number | undefined | null, len: number) =>
  b ? String(b).padStart(len, '0') : ' '.repeat(len);
const fmtRenta = (r: number) => {
  const pct = (parseFloat(String(r)) * 100).toFixed(3);
  const dotIdx = pct.indexOf('.');
  const int = pct.substring(0, dotIdx);
  const dec = pct.substring(dotIdx + 1);
  return int.padStart(3, '0') + '.' + dec;
};
const ventaTipoChar = (venta_tipo: string | undefined) => {
  if (venta_tipo === 'kilogramo') return 'K';
  return 'U';
};

export const generarTXTStockService = async (): Promise<{fileName: string, contenido: string}> => {
  const articulos = await getArticulosSobranteMayorista();
  const lineas: string[] = [];

  for (const articulo of articulos) {
    const linea = [
      padInt(articulo.codigo_articulo, 6),
      padStr(articulo.descripcion, 40),
      fmtBarcode(articulo.cod_barra_articulo, 13),
      fmtBarcode(articulo.cod_barra_caja, 14),
      padInt(articulo.cant_unidades_caja, 4),
      fmtPrice(articulo.precio_costo),
      fmtPrice(articulo.precio_venta),
      fmtPrice(articulo.precio_venta_volumen),
      fmtStock(articulo.stock_actual, articulo.venta_tipo, 6),
      fmtRenta(articulo.rentabilidad_minima ?? 0),
      articulo.rubro + ventaTipoChar(articulo.venta_tipo),
    ].join(';');
    lineas.push(linea);
  }

  const contenido = lineas.join('\r\n');
  const fileName = `articulos_sobrante_${new Date().toISOString().split('T')[0]}.txt`;
  return { fileName, contenido };
}

const fmtCsvNumber = (n: number | undefined, decimals: number = 2): string => {
  const value = Number.isFinite(Number(n)) ? Number(n) : 0;
  return value.toLocaleString('es-ES', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals,
    useGrouping: true
  });
};

const fmtCsvRentabilidad = (r: number | undefined): string => fmtCsvNumber((r ?? 0) * 100);

const fmtCsvTimestamp = (fecha: Date | string | undefined | null): string => {
  if (!fecha) return '';
  const d = fecha instanceof Date ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}000`;
};

const escapeCsvField = (value: string): string => {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const generarCSVArticulosService = async (): Promise<{ fileName: string, contenido: string }> => {
  const articulos = await getArticulosSobranteMayorista();
  const header = 'codigo_articulo,descripcion,cod_barra_articulo,cod_barra_caja,cant_unidades_caja,precio_costo,precio_venta,precio_venta_volumen,stock_actual,updated_at,rentabilidad_minima,deleted_at,rubro,venta_tipo';
  const lineas: string[] = [header];

  for (const articulo of articulos) {
    const linea = [
      articulo.codigo_articulo,
      escapeCsvField(articulo.descripcion),
      articulo.cod_barra_articulo ?? 0,
      articulo.cod_barra_caja ?? 0,
      articulo.cant_unidades_caja,
      `"${fmtCsvNumber(articulo.precio_costo)}"`,
      `"${fmtCsvNumber(articulo.precio_venta)}"`,
      `"${fmtCsvNumber(articulo.precio_venta_volumen)}"`,
      `"${fmtCsvNumber(articulo.stock_actual)}"`,
      fmtCsvTimestamp(articulo.updated_at),
      `"${fmtCsvRentabilidad(articulo.rentabilidad_minima)}"`,
      fmtCsvTimestamp(articulo.deleted_at),
      articulo.rubro,
      articulo.venta_tipo ?? '',
    ].join(',');
    lineas.push(linea);
  }

  const contenido = lineas.join('\r\n');
  const fileName = `articulos_mayorista_${new Date().toISOString().split('T')[0]}.csv`;
  return { fileName, contenido };
};
