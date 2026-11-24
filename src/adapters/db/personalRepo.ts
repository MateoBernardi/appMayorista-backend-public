import { pool } from './pgClient';

export interface PersonalDTO {
    id_empleado: number;
    nombre: string;
    apellido: string;
    cuit: string;
    direccion: string;
    fecha_ingreso: Date;
    activo: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at?: Date;
}

/**
 * Obtiene un empleado por ID
 */
export const getPersonalById = async (id: number): Promise<PersonalDTO | null> => {
    const result = await pool.query(
        `SELECT * FROM personal WHERE id_empleado = $1 AND deleted_at IS NULL`,
        [id]
    );
    return result.rows[0] || null;
};

/**
 * Obtiene un empleado por CUIT
 */
export const getPersonalByCuit = async (cuit: string): Promise<PersonalDTO | null> => {
    const result = await pool.query(
        `SELECT * FROM personal WHERE cuit = $1 AND deleted_at IS NULL`,
        [cuit]
    );
    return result.rows[0] || null;
};

/**
 * Obtiene todos los empleados activos
 */
export const getAllPersonalActivo = async (): Promise<PersonalDTO[]> => {
    const result = await pool.query(
        `SELECT * FROM personal WHERE activo = true AND deleted_at IS NULL ORDER BY apellido, nombre`
    );
    return result.rows;
};

/**
 * Crea un nuevo empleado
 */
export const createPersonal = async (data: {
    nombre: string;
    apellido: string;
    cuit: string;
    direccion: string;
    fecha_ingreso?: Date;
}): Promise<PersonalDTO> => {
    const { nombre, apellido, cuit, direccion, fecha_ingreso } = data;
    
    const result = await pool.query(
        `INSERT INTO personal (nombre, apellido, cuit, direccion, fecha_ingreso, activo)
         VALUES ($1, $2, $3, $4, $5, true)
         RETURNING *`,
        [nombre, apellido, cuit, direccion, fecha_ingreso || new Date()]
    );
    
    return result.rows[0];
};

/**
 * Actualiza un empleado
 */
export const updatePersonal = async (id: number, data: Partial<PersonalDTO>): Promise<PersonalDTO | null> => {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 1;

    if (data.nombre !== undefined) {
        fields.push(`nombre = $${paramCount++}`);
        values.push(data.nombre);
    }
    
    if (data.apellido !== undefined) {
        fields.push(`apellido = $${paramCount++}`);
        values.push(data.apellido);
    }
    
    if (data.direccion !== undefined) {
        fields.push(`direccion = $${paramCount++}`);
        values.push(data.direccion);
    }
    
    if (data.activo !== undefined) {
        fields.push(`activo = $${paramCount++}`);
        values.push(data.activo);
    }

    if (fields.length === 0) {
        throw new Error('No hay campos para actualizar');
    }

    values.push(id);
    
    const result = await pool.query(
        `UPDATE personal 
         SET ${fields.join(', ')}, updated_at = NOW()
         WHERE id_empleado = $${paramCount} AND deleted_at IS NULL
         RETURNING *`,
        values
    );
    
    return result.rows[0] || null;
};

/**
 * Desactiva un empleado (soft delete)
 */
export const deactivatePersonal = async (id: number): Promise<boolean> => {
    const result = await pool.query(
        `UPDATE personal SET activo = false, updated_at = NOW(), deleted_at = NOW() 
         WHERE id_empleado = $1 AND deleted_at IS NULL`,
        [id]
    );
    
    return result.rowCount !== null && result.rowCount > 0;
};

/**
 * Elimina un empleado (soft delete)
 */
export const deletePersonal = async (id: number): Promise<boolean> => {
    const result = await pool.query(
        `UPDATE personal SET deleted_at = NOW() WHERE id_empleado = $1 AND deleted_at IS NULL`,
        [id]
    );
    
    return result.rowCount !== null && result.rowCount > 0;
};
