/**
 * DTO para representar una cuenta disponible para asociar
 * Contiene información de una entidad (cliente o personal) que puede ser asociada a un usuario.
 * Uso interno del servidor: nunca se devuelve al cliente ni se acepta desde él.
 */
export interface CuentaDisponibleDTO {
    /** ID de la entidad (id_cliente o id_empleado) */
    id: string | number;
    
    /** Nombre de la entidad o persona */
    nombre: string;
    
    /** Apellido de la persona (solo para tabla personal) */
    apellido?: string;
    
    /** Dirección de la entidad */
    direccion?: string;
    
    /** Localidad (solo para tabla clientes) */
    localidad?: string;
    
    /** CUIT de la entidad */
    cuit: string;
    
    /** Email registrado de la entidad (clientes.email / personal.correo); '' si no tiene */
    contact: string;
    
    /** Origen de la cuenta: 'cliente' o 'personal' */
    tabla_origen: 'cliente' | 'personal';
    
    /** Entorno: 'web', 'mayorista' o 'interno' */
    entorno: 'web' | 'mayorista' | 'interno';
    
    /** Nombre del tipo de entidad (ej: "Cliente Web", "Empleado", etc) */
    tipo_entidad: string;
    
    /** ID del tipo de entidad (necesario para la asociación) */
    id_entidad_tipo: number;
}
