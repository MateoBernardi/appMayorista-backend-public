import { VisitaDTO } from '../../domain/dto/ClienteDTO';
import { pool } from './pgClient';

export const createVisita = async (
  id_cliente: number,
  resultado: string,
  observacion_visita: string | null,
  proxima_visita: Date | null
): Promise<number> => {
  const query = `
    INSERT INTO visitas (id_cliente, fecha_visita, resultado, observacion_visita, proxima_visita, created_at)
    VALUES ($1, CURRENT_DATE, $2, $3, $4, NOW())
    RETURNING id_visita;
  `;
  const { rows } = await pool.query(query, [id_cliente, resultado, observacion_visita, proxima_visita]);
  return rows[0].id_visita;
};

export const getVisitasByCliente = async (id_cliente: number): Promise<VisitaDTO[]> => {
  const query = `
    SELECT id_visita, id_cliente, fecha_visita, resultado, observacion_visita, proxima_visita, created_at, updated_at
    FROM visitas
    WHERE id_cliente = $1 AND deleted_at IS NULL
    ORDER BY fecha_visita DESC, created_at DESC;
  `;
  const { rows } = await pool.query(query, [id_cliente]);
  return rows;
};

export const updateVisita = async (
  id_visita: number,
  fields: Partial<Pick<VisitaDTO, 'resultado' | 'observacion_visita' | 'proxima_visita'>>
): Promise<VisitaDTO | undefined> => {
  const updates: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if ('resultado' in fields) {
    updates.push(`resultado = $${idx++}`);
    values.push(fields.resultado);
  }
  if ('observacion_visita' in fields) {
    updates.push(`observacion_visita = $${idx++}`);
    values.push(fields.observacion_visita);
  }
  if ('proxima_visita' in fields) {
    updates.push(`proxima_visita = $${idx++}`);
    values.push(fields.proxima_visita);
  }

  if (updates.length === 0) return undefined;

  updates.push(`updated_at = NOW()`);
  values.push(id_visita);

  const query = `
    UPDATE visitas
    SET ${updates.join(', ')}
    WHERE id_visita = $${idx} AND deleted_at IS NULL
    RETURNING *;
  `;
  const { rows } = await pool.query(query, values);
  return rows[0];
};

export const softDeleteVisita = async (id_visita: number): Promise<VisitaDTO | undefined> => {
  const query = `
    UPDATE visitas
    SET deleted_at = NOW()
    WHERE id_visita = $1 AND deleted_at IS NULL
    RETURNING *;
  `;
  const { rows } = await pool.query(query, [id_visita]);
  return rows[0];
};
