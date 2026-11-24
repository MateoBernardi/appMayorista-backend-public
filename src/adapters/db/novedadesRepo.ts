import { pool } from './pgClient';

export const getNovedades = async () => {
    const query = `
    SELECT 
      id,
      titulo,
      descripcion,
      id_etiqueta,
      prioridad,
      created_by,
      created_at
    FROM novedades
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC;
  `;
    const { rows } = await pool.query(query);
    return rows;
}

export const createNovedad = async (titulo: string, descripcion: string, id_etiqueta: number, prioridad: number, created_by: number) => {
    const query = `
    INSERT INTO novedades (titulo, descripcion, id_etiqueta, prioridad, created_by, created_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    RETURNING id, titulo, descripcion, id_etiqueta, prioridad, created_by, created_at;
  `;
    const values = [titulo, descripcion, id_etiqueta, prioridad, created_by];
    const { rows } = await pool.query(query, values);
    return rows[0];
}

export const deleteNovedad = async (id: number) => {
    const query = `
    UPDATE novedades
    SET deleted_at = NOW()
    WHERE id = $1;
  `;
    await pool.query(query, [id]);
    return { id };
}

export const updateNovedad = async (id: number, titulo: string, descripcion: string, id_etiqueta: number, prioridad: number, created_by: number) => {
    const query = `
    UPDATE novedades
    SET titulo = $1, descripcion = $2, id_etiqueta = $3, prioridad = $4, created_by = $5, created_at = NOW()
    WHERE id = $6
    RETURNING id, titulo, descripcion, id_etiqueta, prioridad, created_by, created_at;
  `;
    const values = [titulo, descripcion, id_etiqueta, prioridad, created_by, id];
    const { rows } = await pool.query(query, values);
    return rows[0];
}

export const expireNovedad =  async () => {
    const query = `
    UPDATE novedades
    SET deleted_at = NOW()
    WHERE created_at < NOW() - INTERVAL '7 days'
    AND deleted_at IS NULL;
    `;
    await pool.query(query);
    return;
}