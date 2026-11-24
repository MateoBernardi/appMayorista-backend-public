import { pool } from '../pgClient';

export const getBySection = async (section: string) => {
  const query = `
    -- Selecciona imágenes por sección, excluyendo eliminadas,
    -- incluye las relaciones con articuloImagenes también no eliminadas y ordenadas
    SELECT 
      i.*,
      ai.articulo_id,
      ai.orden
    FROM images i
    LEFT JOIN articulo_imagen ai
      ON ai.image_id = i.id AND ai.deleted_at IS NULL
    WHERE i.section = $1
      AND i.deleted_at IS NULL
    ORDER BY i.id DESC, ai.orden ASC;
  `;
  const { rows } = await pool.query(query, [section]);
  return rows;
}

export const getSections = async () => {
    const query = `
        SELECT DISTINCT section
        FROM images
    `;
    const { rows } = await pool.query(query);
    return rows;
}

export const getImagesWithRelationsBySection = async (section: string) => {
  const query = `
    -- Selecciona imágenes por sección, excluyendo eliminadas,
    -- solo incluye imágenes con relación activa a artículos,
    -- y devuelve la descripción del artículo asociado
    SELECT 
      i.*,
      ai.articulo_id,
      ai.orden,
      a.descripcion AS articulo_descripcion
    FROM images i
    INNER JOIN articulo_imagen ai
      ON ai.image_id = i.id AND ai.deleted_at IS NULL
    INNER JOIN articulos a
      ON a.codigo_articulo = ai.articulo_id
    WHERE i.section = $1
      AND i.deleted_at IS NULL
    ORDER BY i.id DESC, ai.orden ASC;
  `;
  const { rows } = await pool.query(query, [section]);
  return rows;
}

export const deleteById = async (id: number) => {
  const query = `
    UPDATE images
    SET deleted_at = NOW()
    WHERE id = $1
  `;
  await pool.query(query, [id]);
}

export const createImage = async (imageData: {
  url: string;
  section: string;
  description: string;
  cf_image_id: string | null;
  media_type?: 'image' | 'video';
  width?: number | null;
  height?: number | null;
}) => {
  const query = `
    INSERT INTO images (section, url, description, cf_image_id, storage_provider, media_type, width, height, created_at, updated_at)
    VALUES ($1, $2, $3, $4, 'cloudflare_r2_images', $5, $6, $7, NOW(), NOW())
    RETURNING *
  `;
  const { rows } = await pool.query(query, [
    imageData.section,
    imageData.url,
    imageData.description,
    imageData.cf_image_id,
    imageData.media_type ?? 'image',
    imageData.width ?? null,
    imageData.height ?? null
  ]);
  return rows[0];
}

export const getImageById = async (id: number) => {
  const query = `
    SELECT * FROM images
    WHERE id = $1 AND deleted_at IS NULL
  `;
  const { rows } = await pool.query(query, [id]);
  return rows[0];
}

export const updateImage = async (id: number, updateData: {
  url?: string;
  section?: string;
  description?: string;
  cf_image_id?: string;
  storage_provider?: string;
  media_type?: 'image' | 'video';
}) => {
  const setClause = [];
  const values = [];
  let paramCount = 1;

  Object.entries(updateData).forEach(([key, value]) => {
    if (value !== undefined) {
      setClause.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (setClause.length === 0) {
    throw new Error('No hay campos para actualizar');
  }

  setClause.push(`updated_at = NOW()`);
  values.push(id);

  const query = `
    UPDATE images
    SET ${setClause.join(', ')}
    WHERE id = $${paramCount}
    RETURNING *
  `;

  const { rows } = await pool.query(query, values);
  return rows[0];
}

// ───────────── Borradores de slots de imagen ─────────────

// Secciones/relaciones que identifican imágenes de producto/reporte (no son contenido web)
const PRODUCT_SECTIONS = ['articulo_imagen', 'articulos', 'products', 'productos', 'reportes'];

// Product images live in open-ended category sections, so the gallery whitelists content sections.
const CONTENT_SECTIONS = ['hero', 'services', 'header', 'footer', 'home-highlight', 'insumos-rubros', 'insumos-hero', 'novedades', 'cooperativa', 'providers', 'galeria'];

const NOT_PRODUCT_SQL = `
  i.section <> ALL($1::text[])
  AND NOT EXISTS (SELECT 1 FROM articulo_imagen ai WHERE ai.image_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM reporte_imagen ri WHERE ri.image_id = i.id)
`;

export interface ImageSlotDraft {
  id: number;
  section: string;
  description: string;
  image_id: number | null;
  action: 'set' | 'clear';
  updated_by: number | null;
  updated_at: string;
  image_url: string | null;
  cf_image_id: string | null;
  media_type: string | null;
}

export const listDrafts = async (): Promise<ImageSlotDraft[]> => {
  const { rows } = await pool.query(`
    SELECT d.id, d.section, d.description, d.image_id, d.action, d.updated_by, d.updated_at,
           i.url AS image_url, i.cf_image_id, i.media_type
    FROM image_slot_drafts d
    LEFT JOIN images i ON i.id = d.image_id
    ORDER BY d.section, d.description
  `);
  return rows;
};

export const upsertDraft = async (data: {
  section: string;
  description: string;
  image_id: number | null;
  updated_by: number | null;
}) => {
  const action = data.image_id === null ? 'clear' : 'set';
  const { rows } = await pool.query(
    `INSERT INTO image_slot_drafts (section, description, image_id, action, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (section, description)
     DO UPDATE SET image_id = EXCLUDED.image_id, action = EXCLUDED.action,
                   updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING *`,
    [data.section, data.description, data.image_id, action, data.updated_by]
  );
  return rows[0];
};

export const deleteAllDrafts = async () => {
  const { rowCount } = await pool.query('DELETE FROM image_slot_drafts');
  return rowCount ?? 0;
};

export const deleteDraftById = async (id: number) => {
  const { rowCount } = await pool.query('DELETE FROM image_slot_drafts WHERE id = $1', [id]);
  return rowCount ?? 0;
};

/** Aplica todos los borradores en una única transacción y los elimina. */
export const publishDrafts = async (): Promise<{ published: number }> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: drafts } = await client.query(
      'SELECT * FROM image_slot_drafts ORDER BY id FOR UPDATE'
    );
    for (const d of drafts) {
      // Se resuelve la fuente antes de dar de baja la fila viva (puede ser la misma)
      let source: any = null;
      if (d.action === 'set') {
        const res = await client.query(
          'SELECT url, description, cf_image_id, media_type, storage_provider, width, height FROM images WHERE id = $1 AND deleted_at IS NULL',
          [d.image_id]
        );
        source = res.rows[0];
        if (!source) {
          throw new Error(`La imagen ${d.image_id} del borrador ${d.section}/${d.description} ya no existe`);
        }
      }
      const whole = d.description === '*';
      if (whole) {
        await client.query(
          `UPDATE images SET deleted_at = NOW(), updated_at = NOW()
           WHERE section = $1 AND deleted_at IS NULL`,
          [d.section]
        );
      } else {
        await client.query(
          `UPDATE images SET deleted_at = NOW(), updated_at = NOW()
           WHERE section = $1 AND description = $2 AND deleted_at IS NULL`,
          [d.section, d.description]
        );
      }
      if (source) {
        const description = whole ? (source.description?.trim() ? source.description : 'principal') : d.description;
        await client.query(
          `INSERT INTO images (section, url, description, cf_image_id, storage_provider, media_type, width, height, created_at, updated_at)
           VALUES ($1, $2, $3, $4, COALESCE($5, 'cloudflare_r2_images'), COALESCE($6, 'image'), $7, $8, NOW(), NOW())`,
          [d.section, source.url, description, source.cf_image_id, source.storage_provider, source.media_type, source.width, source.height]
        );
      }
    }
    await client.query('DELETE FROM image_slot_drafts');
    await client.query('COMMIT');
    return { published: drafts.length };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Imágenes de biblioteca referenciadas por borradores 'set' de una sección. */
export const getSetDraftImagesBySection = async (section: string) => {
  const { rows } = await pool.query(
    `SELECT i.*, d.section AS slot_section, d.description AS slot_description
     FROM image_slot_drafts d
     INNER JOIN images i ON i.id = d.image_id AND i.deleted_at IS NULL
     WHERE d.section = $1 AND d.action = 'set'`,
    [section]
  );
  return rows;
};

export const getDraftsBySection = async (section: string) => {
  const { rows } = await pool.query(
    'SELECT * FROM image_slot_drafts WHERE section = $1',
    [section]
  );
  return rows as Array<{ section: string; description: string; action: 'set' | 'clear'; image_id: number | null }>;
};

/** Galería: imágenes de contenido (sin productos/reportes), deduplicadas por url. */
export const getGalleryRows = async () => {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (i.url)
       i.id, i.url, i.section, i.description, i.cf_image_id, i.media_type, i.width, i.height, i.created_at,
       COALESCE((
         SELECT json_agg(DISTINCT jsonb_build_object('section', s.section, 'description', s.description, 'draft', false))
         FROM images s
         WHERE s.url = i.url AND s.deleted_at IS NULL AND s.section <> 'galeria'
       ), '[]'::json) AS published_slots,
       COALESCE((
         SELECT json_agg(DISTINCT jsonb_build_object('section', d.section, 'description', d.description, 'draft', true))
         FROM image_slot_drafts d
         INNER JOIN images di ON di.id = d.image_id
         WHERE d.action = 'set' AND di.url = i.url
       ), '[]'::json) AS draft_slots
     FROM images i
     WHERE i.deleted_at IS NULL AND i.section = ANY($1::text[])
     ORDER BY i.url, (i.section = 'galeria') DESC, i.id DESC`,
    [CONTENT_SECTIONS]
  );
  return rows;
};

export interface SlotUsage { section: string; description: string; draft: boolean }

/** Slots (publicados o en borrador) que usan la imagen (por url). Vacío si es imagen de producto. */
export const getImageSlotUsage = async (id: number): Promise<SlotUsage[]> => {
  const { rows } = await pool.query(
    `SELECT s.section, s.description, false AS draft
     FROM images t
     INNER JOIN images s ON s.url = t.url AND s.deleted_at IS NULL AND s.section <> 'galeria' AND s.id <> t.id
     INNER JOIN images i ON i.id = s.id
     WHERE t.id = $2 AND ${NOT_PRODUCT_SQL}
       AND t.section <> ALL($1::text[])
     UNION
     SELECT t.section, t.description, false
     FROM images t
     WHERE t.id = $2 AND t.deleted_at IS NULL AND t.section <> 'galeria'
       AND t.section <> ALL($1::text[])
       AND NOT EXISTS (SELECT 1 FROM articulo_imagen ai WHERE ai.image_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM reporte_imagen ri WHERE ri.image_id = t.id)
     UNION
     SELECT d.section, d.description, true
     FROM image_slot_drafts d
     INNER JOIN images di ON di.id = d.image_id
     INNER JOIN images t ON t.url = di.url
     WHERE t.id = $2 AND d.action = 'set'`,
    [PRODUCT_SECTIONS, id]
  );
  return rows;
};
