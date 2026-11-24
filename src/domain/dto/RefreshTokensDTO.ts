export interface RefreshTokenDTO {
    id: number;
    id_usuario: number;
    token: string;
    created_at: Date;
    expires_at: Date;
    revoked: boolean;
    deleted_at?: Date;
}

// Para operaciones que solo necesitan datos básicos
export interface RefreshTokenBasicDTO {
    token: string;
    id_usuario: number;
    expires_at: Date;
}