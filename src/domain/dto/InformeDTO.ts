export type TipoEntrada = 'relato' | 'mensaje';
export type TipoAdjunto = 'imagen' | 'video' | 'documento';

export interface AdjuntoDTO {
  id: string;
  entrada_id: string;
  tipo: TipoAdjunto;
  nombre: string;
  mime: string;
  tamano: number;
  orden: number;
}

export interface EntradaDTO {
  id: string;
  informe_id: string;
  tipo: TipoEntrada;
  autor_id: number;
  menciones: number[];
  creado_en: Date;
  editado_en: Date | null;
  cuerpo: string;
  adjuntos: AdjuntoDTO[];
  /** Si quien consulta ya vio la entrada; solo viene en la lectura del informe. */
  visto?: boolean | undefined;
}

export interface EntradaVistoDTO {
  user_context_id: number;
  nombre: string;
  apellido: string;
  visto_en: Date;
}

export type EntradaFilaDTO = Omit<EntradaDTO, 'adjuntos'>;

export interface PersonaResumenDTO {
  id: number;
  nombre: string;
  apellido: string;
}

export interface InformeResumenDTO {
  informe_id: string;
  creador: number;
  creador_nombre: string | null;
  creador_apellido: string | null;
  creada_en: Date;
  entradas: number;
  adjuntos: number;
  ultima_actividad: Date;
  preview: string;
  mencionado: boolean;
}

export interface InformeListadoDTO {
  informes: InformeResumenDTO[];
  nextCursor: string | null;
}

export interface InformeDetalleDTO {
  informe_id: string;
  creador: number;
  entradas: EntradaDTO[];
  personas: Record<number, PersonaResumenDTO>;
}

export interface NuevoAdjuntoDTO {
  tipo: TipoAdjunto;
  r2_key: string;
  nombre: string;
  mime: string;
  tamano: number;
  orden?: number | undefined;
}

export interface AdjuntoArchivoDTO {
  r2_key: string;
  nombre: string;
  mime: string;
}

export type ResultadoAgregarEntrada =
  | { status: 'ok'; entrada: EntradaFilaDTO }
  | { status: 'no_existe' };

type RechazoEscritura = { status: 'no_existe' } | { status: 'no_autor' };

export type ResultadoEscritura<T = unknown> = ({ status: 'ok' } & T) | RechazoEscritura;
