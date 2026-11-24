import { pool } from '../pgClient';
import { NovedadWebCreateInput, NovedadWebDTO, NovedadWebUpdateInput } from '../../../domain/dto/NovedadWebDTO';

export const getNovedadesWeb = async (): Promise<NovedadWebDTO[]> => {
  const { rows } = await pool.query(
    `SELECT * FROM novedades_web WHERE deleted_at IS NULL ORDER BY publicada_en DESC`
  );
  return rows;
};

export const getNovedadesWebPublicadas = async (): Promise<NovedadWebDTO[]> => {
  const { rows } = await pool.query(
    `SELECT * FROM novedades_web WHERE deleted_at IS NULL AND estado = 'Publicada' ORDER BY publicada_en DESC`
  );
  return rows;
};

export const getNovedadWebById = async (id: number): Promise<NovedadWebDTO | undefined> => {
  const { rows } = await pool.query(
    `SELECT * FROM novedades_web WHERE id = $1 AND deleted_at IS NULL`,
    [id]
  );
  return rows[0];
};

export const createNovedadWeb = async (data: NovedadWebCreateInput): Promise<NovedadWebDTO> => {
  const { rows } = await pool.query(
    `INSERT INTO novedades_web (titulo, preview, cuerpo, imagen, publicada_en, estado, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, now()), $6, $7)
     RETURNING *`,
    [
      data.titulo,
      data.preview,
      data.cuerpo,
      data.imagen ?? null,
      data.publicada_en ?? null,
      data.estado ?? 'Borrador',
      data.created_by,
    ]
  );
  return rows[0];
};

export const updateNovedadWeb = async (id: number, data: NovedadWebUpdateInput): Promise<NovedadWebDTO | undefined> => {
  const setClause: string[] = [];
  const values: unknown[] = [];

  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined) {
      values.push(value);
      setClause.push(`${key} = $${values.length}`);
    }
  });

  if (setClause.length === 0) {
    throw new Error('No hay campos para actualizar');
  }

  values.push(id);
  const query = `
    UPDATE novedades_web
    SET ${setClause.join(', ')}
    WHERE id = $${values.length} AND deleted_at IS NULL
    RETURNING *
  `;
  const { rows } = await pool.query(query, values);
  return rows[0];
};

export const deleteNovedadWeb = async (id: number): Promise<NovedadWebDTO | undefined> => {
  const { rows } = await pool.query(
    `UPDATE novedades_web
     SET deleted_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING *`,
    [id]
  );
  return rows[0];
};

export const sweepNovedadesWebProgramadas = async (): Promise<number[]> => {
  const { rows } = await pool.query(
    `UPDATE novedades_web
     SET estado = 'Publicada'
     WHERE estado = 'Programada' AND publicada_en <= NOW() AND deleted_at IS NULL
     RETURNING id`
  );
  return rows.map((r) => r.id);
};
