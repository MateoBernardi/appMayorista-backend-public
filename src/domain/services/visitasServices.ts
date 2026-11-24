import { VisitaDTO } from '../dto/ClienteDTO';
import { createVisita, getVisitasByCliente, updateVisita, softDeleteVisita } from '../../adapters/db/visitasRepo';
import { BadRequestError, NotFoundError } from '../../adapters/errors/AppError';

export const registerVisita = async (
  id_cliente: number,
  resultado: string,
  observacion_visita: string | null,
  proxima_visita: Date | null
): Promise<number> => {
  if (!resultado || resultado.trim().length === 0) throw new BadRequestError('El resultado es requerido');
  return createVisita(id_cliente, resultado, observacion_visita, proxima_visita);
};

export const fetchVisitasByCliente = async (id_cliente: number): Promise<VisitaDTO[]> => {
  return getVisitasByCliente(id_cliente);
};

export const editVisita = async (
  id_visita: number,
  fields: Partial<Pick<VisitaDTO, 'resultado' | 'observacion_visita' | 'proxima_visita'>>
): Promise<VisitaDTO> => {
  if (Object.keys(fields).length === 0) throw new BadRequestError('No se enviaron campos para actualizar');
  const updated = await updateVisita(id_visita, fields);
  if (!updated) throw new NotFoundError('Visita no encontrada');
  return updated;
};

export const removeVisita = async (id_visita: number): Promise<VisitaDTO> => {
  const deleted = await softDeleteVisita(id_visita);
  if (!deleted) throw new NotFoundError('Visita no encontrada');
  return deleted;
};
