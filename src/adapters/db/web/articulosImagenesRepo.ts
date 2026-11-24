import { pool } from "../pgClient";
import { ArticuloImagenDTO } from "../../../domain/dto/ArticuloImagenDTO";

export const linkImageToArticulo = async (data: ArticuloImagenDTO) => {
    const result = await pool.query(
        `INSERT INTO articulo_imagen (articulo_id, image_id, orden)
         VALUES ($1, $2, $3) RETURNING *`,
        [data.articulo_id, data.image_id, data.orden]
    );
    return result.rows[0];
}

export const unlinkImageFromArticulo = async (articulo_id: number, image_id: number, orden: number) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Hard delete
        const result = await client.query(
            `DELETE FROM articulo_imagen 
             WHERE articulo_id = $1 AND image_id = $2 AND deleted_at IS NULL
             RETURNING *`,
            [articulo_id, image_id]
        );

        // Decrementar el orden de las imágenes restantes
        await client.query(
            `UPDATE articulo_imagen
             SET orden = orden - 1
             WHERE articulo_id = $1 AND orden > $2 AND deleted_at IS NULL`,
            [articulo_id, orden]
        );

        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export const getImagesByArticuloId = async (articulo_id: number) => {
    const query = `
        SELECT ai.*, i.url, i.section, i.description AS imagen_descripcion, i.cf_image_id, i.media_type, i.width, i.height, a.descripcion AS articulo_descripcion
        FROM articulo_imagen ai
        INNER JOIN images i ON ai.image_id = i.id
        INNER JOIN articulos a ON ai.articulo_id = a.codigo_articulo
        WHERE ai.articulo_id = $1 AND ai.deleted_at IS NULL
        ORDER BY ai.orden ASC;
    `;
    const { rows } = await pool.query(query, [articulo_id]);
    return rows;
}

export const getArticulosByImageId = async (image_id: number) => {
    const query = `
        SELECT *
        FROM articulo_imagen
        WHERE image_id = $1 AND deleted_at IS NULL;
    `;
    const { rows } = await pool.query(query, [image_id]);
    return rows;
}

export const updateImageOrderForArticulo = async (articulo_id: number, image_id: number, newOrder: number) => {
    const result = await pool.query(
        `UPDATE articulo_imagen 
         SET orden = $3, updated_at = NOW() 
         WHERE articulo_id = $1 AND image_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [articulo_id, image_id, newOrder]
    );
    return result.rows[0];
};

export const swapImageOrders = async (articulo_id: number, image1_id: number, image2_id: number) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Obtener los órdenes actuales
        const getOrdersQuery = `
            SELECT image_id, orden
            FROM articulo_imagen
            WHERE articulo_id = $1 AND image_id IN ($2, $3) AND deleted_at IS NULL;
        `;
        const { rows: orderRows } = await client.query(getOrdersQuery, [articulo_id, image1_id, image2_id]);
        if (orderRows.length !== 2) {
            throw new Error('Imágenes no encontradas');
        }

        const order1 = Number(orderRows.find(row => row.image_id === image1_id)?.orden);
        const order2 = Number(orderRows.find(row => row.image_id === image2_id)?.orden);

        // Paso 1: asignar un valor temporal
        const TEMP_ORDER = -99999;
        await client.query(
            `UPDATE articulo_imagen
             SET orden = $1
             WHERE articulo_id = $2 AND image_id = $3 AND deleted_at IS NULL`,
            [TEMP_ORDER, articulo_id, image1_id]
        );

        // Paso 2: asignar el orden de image1 a image2
        await client.query(
            `UPDATE articulo_imagen
             SET orden = $1
             WHERE articulo_id = $2 AND image_id = $3 AND deleted_at IS NULL`,
            [order1, articulo_id, image2_id]
        );

        // Paso 3: asignar el orden de image2 a image1
        await client.query(
            `UPDATE articulo_imagen
             SET orden = $1
             WHERE articulo_id = $2 AND image_id = $3 AND deleted_at IS NULL`,
            [order2, articulo_id, image1_id]
        );

        await client.query('COMMIT');
        return { image1_id, order1, image2_id, order2 };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}