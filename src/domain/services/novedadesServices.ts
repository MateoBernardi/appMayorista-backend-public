import { getNovedades, createNovedad, deleteNovedad, updateNovedad } from "../../adapters/db/novedadesRepo";
import { NovedadDTO } from "../dto/NovedadDTO";

export const fetchNovedades = async (): Promise<NovedadDTO[]> => {
    return await getNovedades();
}

export const addNovedad = async (titulo: string, descripcion: string, id_etiqueta: number, prioridad: number, created_by: number): Promise<NovedadDTO> => {
    return await createNovedad(titulo, descripcion, id_etiqueta, prioridad, created_by);
}

export const removeNovedad = async (id: number): Promise<{ id: number }> => {
    return await deleteNovedad(id);
}

export const modifyNovedad = async (id: number, titulo: string, descripcion: string, id_etiqueta: number, prioridad: number, created_by: number): Promise<NovedadDTO> => {
    return await updateNovedad(id, titulo, descripcion, id_etiqueta, prioridad, created_by);
}