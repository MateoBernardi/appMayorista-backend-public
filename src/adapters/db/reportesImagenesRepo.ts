import { pool } from "./pgClient";
import { ReporteImagenDTO } from "../../domain/dto/ReporteImagenDTO";

export const getNextOrden = async (reporte_id: number): Promise<number> => {
    const result = await pool.query(
        `SELECT COALESCE(MAX(orden), 0) + 1 as next_orden
         FROM reporte_imagen
         WHERE reporte_id = $1 AND deleted_at IS NULL`,
        [reporte_id]
    );
    return result.rows[0].next_orden;
};

export const linkImageToReporte = async (data: ReporteImagenDTO) => {
    const result = await pool.query(
        `INSERT INTO reporte_imagen (reporte_id, image_id, orden)
         VALUES ($1, $2, $3) RETURNING *`,
        [data.reporte_id, data.image_id, data.orden]
    );
    return result.rows[0];
};

export const unlinkImageFromReporte = async (reporte_id: number, image_id: number, orden: number) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const result = await client.query(
            `DELETE FROM reporte_imagen 
             WHERE reporte_id = $1 AND image_id = $2 AND deleted_at IS NULL
             RETURNING *`,
            [reporte_id, image_id]
        );

        // Decrementar el orden de las imágenes restantes
        await client.query(
            `UPDATE reporte_imagen
             SET orden = orden - 1
             WHERE reporte_id = $1 AND orden > $2 AND deleted_at IS NULL`,
            [reporte_id, orden]
        );

        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

export const getImagesByReporteId = async (reporte_id: number) => {
    const query = `
        SELECT ri.*, i.url, i.section, i.description AS imagen_descripcion
        FROM reporte_imagen ri
        INNER JOIN images i ON ri.image_id = i.id
        WHERE ri.reporte_id = $1 AND ri.deleted_at IS NULL
        ORDER BY ri.orden ASC;
    `;
    const { rows } = await pool.query(query, [reporte_id]);
    return rows;
};

export const updateImageOrderForReporte = async (reporte_id: number, image_id: number, newOrder: number) => {
    const result = await pool.query(
        `UPDATE reporte_imagen 
         SET orden = $3, updated_at = NOW() 
         WHERE reporte_id = $1 AND image_id = $2 AND deleted_at IS NULL
         RETURNING *`,
        [reporte_id, image_id, newOrder]
    );
    return result.rows[0];
};

export const swapImageOrders = async (reporte_id: number, image1_id: number, image2_id: number) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { rows: orderRows } = await client.query(
            `SELECT image_id, orden
             FROM reporte_imagen
             WHERE reporte_id = $1 AND image_id IN ($2, $3) AND deleted_at IS NULL`,
            [reporte_id, image1_id, image2_id]
        );

        if (orderRows.length !== 2) {
            throw new Error('Imágenes no encontradas');
        }

        const order1 = Number(orderRows.find(row => row.image_id === image1_id)?.orden);
        const order2 = Number(orderRows.find(row => row.image_id === image2_id)?.orden);

        const TEMP_ORDER = -99999;
        await client.query(
            `UPDATE reporte_imagen SET orden = $1 WHERE reporte_id = $2 AND image_id = $3 AND deleted_at IS NULL`,
            [TEMP_ORDER, reporte_id, image1_id]
        );
        await client.query(
            `UPDATE reporte_imagen SET orden = $1 WHERE reporte_id = $2 AND image_id = $3 AND deleted_at IS NULL`,
            [order1, reporte_id, image2_id]
        );
        await client.query(
            `UPDATE reporte_imagen SET orden = $1 WHERE reporte_id = $2 AND image_id = $3 AND deleted_at IS NULL`,
            [order2, reporte_id, image1_id]
        );

        await client.query('COMMIT');
        return { image1_id, order1, image2_id, order2 };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};
