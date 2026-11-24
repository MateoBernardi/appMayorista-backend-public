import { pool } from "./pgClient";
import { RolDTO } from "../../domain/dto/RolDTO";
import { UsuarioDTO } from "../../domain/dto/UsuarioDTO";

export const getIdRolPublico = async (): Promise<number> => {
    const result = await pool.query(
        `SELECT id_rol 
         FROM roles 
         WHERE nombre = $1`,
        ['publico']
    );

    if (result.rows.length === 0) {
        throw new Error('Rol no encontrado');
    }
    
    return result.rows[0].id_rol || null;
};

export const getRolById = async (rolId: number): Promise<RolDTO | null> => {
    const result = await pool.query(
        `SELECT id_rol as id, nombre 
         FROM roles 
         WHERE id_rol = $1`,
        [rolId]
    );
    
    if (result.rows.length === 0) {
        return null;
    }
    
    return {
        id: result.rows[0].id,
        nombre: result.rows[0].nombre
    };
};

export const getIdRolByNombre = async (nombre: string): Promise<number | null> => {
    const result = await pool.query(
        `SELECT id_rol 
         FROM roles 
         WHERE nombre = $1`,
        [nombre]
    );

    if (result.rows.length === 0) {
        return null;
    }
    
    return result.rows[0].id_rol;
};

export const getIdRolReadonly = async (): Promise<number> => {
    const result = await pool.query(
        `SELECT id_rol 
         FROM roles 
         WHERE nombre = $1`,
        ['readonly']
    );

    if (result.rows.length === 0) {
        throw new Error('Rol no encontrado');
    }
    
    return result.rows[0].id_rol;
};