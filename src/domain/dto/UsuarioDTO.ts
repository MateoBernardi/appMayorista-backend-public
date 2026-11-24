export interface UsuarioDTO {
    id: number;
    username: string;
    email: string;
    nombre: string;
    apellido: string;
    created_at?: Date;
    updated_at?: Date;
    deleted_at?: Date;
}

// DTO para operaciones que requieren password
export interface UsuarioWithPasswordDTO extends UsuarioDTO {
    password: string;
}

// DTO para crear usuario
export interface CreateUsuarioDTO {
    username: string;
    email: string;
    password: string;
    nombre: string;
    apellido: string;
}

// DTO para contexto completo de usuario (desde vista v_usuario_entidad_completo)
export interface UsuarioEntidadDTO {
    user_context_id: number;
    id_usuario: number;
    id_entidad_tipo: number;
    id_entidad: number;
    id_rol: number;
    fecha_asociacion: Date;
    // Datos del usuario
    username: string;
    email: string;
    nombre: string;
    apellido: string;
    usuario_created_at: Date;
    usuario_updated_at: Date;
    // Datos del contexto
    entidad_tipo_nombre: string;
    entorno: 'web' | 'mayorista' | 'interno';
    rol_nombre: string;
}

// DTO para respuestas de login/auth
export interface LoginResponseDTO {
    user: UsuarioDTO;
    accessToken: string;
    refreshToken: string;
    csrfToken?: string;
}
