import { TokenPurpose } from '../../types/tokenPurpose';

export interface VerificationTokensDTO {
    id: number;
    user_id: number;
    contact: string;
    token: string;
    method: 'email' | 'sms';
    created_at: Date;
    expires_at: Date;
    failed_attempts: number;
    created_by?: number | null;      // FK a usuario_entidad (quien solicita el token)
    purpose?: TokenPurpose | null;   // Propósito del token
    entidad_id?: number | null;      // Entidad destino de la validación
    entidad_tipo_id?: number | null; // Tipo de la entidad destino (define el entorno)
}