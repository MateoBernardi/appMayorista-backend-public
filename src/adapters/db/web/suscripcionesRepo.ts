import { pool } from '../pgClient';
import { SuscripcionDTO } from '../../../domain/dto/SuscripcionDTO';

export const createSuscripcion = async (suscripcion: SuscripcionDTO) => {
    const result = await pool.query(
        `INSERT INTO suscripciones (nombre, telefono, email, localidad)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [suscripcion.nombre, suscripcion.telefono, suscripcion.email, suscripcion.localidad]
    );
    return result.rows[0];
};

export const getAllSuscripciones = async () => {
    const result = await pool.query('SELECT * FROM suscripciones WHERE deleted_at IS NULL ORDER BY id DESC;');
    return result.rows;
}

export const getSuscripcionById = async (id: number) => {
    const result = await pool.query('SELECT * FROM suscripciones WHERE id = $1 AND deleted_at IS NULL;', [id]);
    return result.rows[0];
}

export const getSuscripcionByEmail = async (email: string) => {
    const result = await pool.query('SELECT * FROM suscripciones WHERE email = $1 AND deleted_at IS NULL;', [email]);
    return result.rows[0];
}

export const deleteSuscripcion = async (id: number) => {
    const result = await pool.query('UPDATE suscripciones SET deleted_at = NOW() WHERE id = $1 RETURNING *;', [id]);
    return result.rows[0];
};
