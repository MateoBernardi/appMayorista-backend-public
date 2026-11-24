import { TipoCategoria, TipoPregunta, TipoEvaluado } from "../../types/encuestas";

export interface EncuestaDTO {
    id: number;
    titulo: string;
    descripcion?: string;
    categoria: TipoCategoria;
    es_anonima: boolean;
    fecha_creacion: Date;
    fecha_fin: Date;
    created_by?: number;
}

export interface PreguntaDTO {
    id: number;
    encuesta_id: number;
    titulo: string;
    tipo_pregunta: TipoPregunta;
    orden: number;
    es_obligatoria: boolean;
}

export interface OpcionDTO {
    id: number;
    pregunta_id: number;
    texto_opcion: string;
}

export interface RespuestaDTO {
    id: number;
    pregunta_id: number;
    opcion_id?: number;
    respuesta_texto?: string;
    valor_rating?: number;
    evaluado_id?: number;
    evaluado_tipo?: TipoEvaluado;
    fecha_respuesta: Date;
}

export interface CrearEncuestaInput {
    titulo: string;
    descripcion?: string;
    categoria: TipoCategoria;
    es_anonima: boolean;
    fecha_fin: Date;
    created_by?: number;
}

export interface CrearPreguntaInput {
    encuesta_id: number;
    titulo: string;
    tipo_pregunta: TipoPregunta;
    orden: number;
    es_obligatoria?: boolean;
    opciones?: string[]; // Para preguntas de tipo multiple_choice
}

export interface CrearRespuestaInput {
    pregunta_id: number;
    opcion_id?: number;
    respuesta_texto?: string;
    valor_rating?: number;
    evaluado_id?: number;
    evaluado_tipo?: TipoEvaluado;
}

export interface EncuestaConPreguntasDTO extends EncuestaDTO {
    preguntas: (PreguntaDTO & { opciones?: OpcionDTO[] })[];
}

export interface ParticipanteDTO {
    user_context_id: number;
    nombre: string;
    apellido: string;
}

export interface EncuestaConRespuestasDTO extends EncuestaDTO {
    creador_nombre?: string;
    creador_apellido?: string;
    convocados: number[];
    participantes: ParticipanteDTO[];
    preguntas: (PreguntaDTO & {
        opciones?: OpcionDTO[];
        respuestas: RespuestaDTO[];
    })[];
}
