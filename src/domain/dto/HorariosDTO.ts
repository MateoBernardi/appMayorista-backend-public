import { SolicitudDTO } from "./LicenciaDTO";

export interface HorariosDTO {
    id?: number;
    userContextId: number;
    turno: string;
    horario_in: Date | null;
    horario_out: Date | null;
    sede_id_in: number;
    sede_id_out: number;
    licencia: boolean;
    feriado: boolean | null;
    horarioCorrido?: boolean | null;
}

export interface HorarioUsuarioDTO {
    id: number;
    userContextId: number;
    nombre_empleado: string;
    apellido_empleado: string;
    fecha: Date;
    turno: string;
    esperado_in: Date | null;
    esperado_out: Date | null;
    licencia: boolean;
    feriado: boolean;
    acepted_at?: string | null;
    marcado_in_at?: Date | string | null;
    marcado_out_at?: Date | string | null;
    reportado_tardanza?: boolean;
    horario_corrido?: boolean;
};

export interface ScanDTO {
    userContextId: number;
    fecha: string; // "YYYY-MM-DD"
    turno: string;
    latitud: number;
    longitud: number;
    deviceId: string;
    token: string;
    // Lo que el cliente cree que está marcando. Opcional: versiones viejas de la app no lo envían.
    tipo?: 'IN' | 'OUT';
}

export interface CheckScanDTO {
    userContextId?: number;
    fecha: Date;
    turno: string;
    esperado_at: Date;
    geofence: boolean;
    deviceId: string;
    tipo_scan: 'IN' | 'OUT' | 'DONE';
}

type PlanificacionCheck = {
    planificacionId: number;
    turno: string;
    esperado_in: Date;
    esperado_out: Date | null;
    deviceId: string | null;
    deviceRowId: number | null;
    tipo_scan: 'IN' | 'OUT' | 'DONE';
    // true si la entrada se marcó hace menos del margen mínimo para poder marcar la salida
    dentroMargenSalida: boolean;
    geofence: boolean;
    codigoQr: string;
    qrMode: 'STATIC' | 'ROTATING';
    qrSecret: string | null;
};

export type CheckScanRaw = {
    planificacion: PlanificacionCheck;
    solicitudes: SolicitudDTO[];
};

export type ScanResultCode = 'ENTRADA_YA_MARCADA' | 'SALIDA_IGNORADA' | 'SALIDA_YA_MARCADA';

export type ScanResult = {
    success: boolean;
    message: string;
    // Casos informativos (no son errores del usuario): el front los muestra como aviso.
    code?: ScanResultCode;
}

export interface SedeDTO {
    id: number;
    nombre: string;
}

/** Respuesta de `GET /horarios/kiosk-secret`. `timestamp` (epoch ms) permite al
 * kiosco calcular el desfasaje de su reloj local contra el servidor. `step` (segundos)
 * es el período de rotación del código TOTP-like, para que el kiosco no lo hardcodee. */
export interface KioskSecretResponseDTO {
    qrSecret: string;
    qrMode: string;
    timestamp: number;
    step: number;
}

/** Minutos por usuario (resumen semanal, acreditación de francos). */
export interface ResumenHorasUsuarioDTO {
    userContextId: number;
    minutos: number;
}

/** Los campos en horas (2 decimales) se mantienen por compatibilidad; los exactos son los minutos. */
export interface HorasSemanalDTO {
    userContextId: number;
    nombre: string;
    apellido: string;
    horasObjetivo: number;
    horasObjetivoPendiente: number | null; // rige desde la próxima semana
    horasTrabajadas: number;
    minutosObjetivo: number;
    minutosObjetivoPendiente: number | null;
    minutosTrabajados: number;
}

export type EstadoTurnoProyeccion = 'realizado' | 'en_curso' | 'proyectado' | 'ausente' | 'licencia';

/** Un turno de la semana en la proyección: cuántos minutos aporta y por qué. */
export interface TurnoProyeccionDTO {
    fecha: string; // YYYY-MM-DD
    turno: string;
    estado: EstadoTurnoProyeccion;
    minutos: number;
    feriado: boolean;
}

/**
 * Proyección semanal de un empleado. `minutosRealizados`: lo que lleva (turnos terminados, según
 * marcas). `minutosProyectados`: realizados + turnos en curso y futuros al horario esperado.
 * `minutosObjetivo` ya descuenta las licencias (por horas, por días y los días sin turnos), sin bajar
 * de 0. Los minutos trabajados desde el sábado 13 hs no se cuentan: son horas extras.
 * `minutosFeriado`: lo que aportan a esos totales los turnos en feriado.
 */
export interface HorasSemanaProyeccionDTO {
    userContextId: number;
    nombre: string;
    apellido: string;
    minutosObjetivo: number;
    minutosObjetivoPendiente: number | null;
    minutosRealizados: number;
    minutosProyectados: number;
    minutosSaldoFrancos: number;
    minutosFeriado: number;
    turnos: TurnoProyeccionDTO[];
}


/** Saldo de vacaciones de un empleado, en días. */
export interface SaldoVacacionesDTO {
    userContextId: number;
    nombre: string;
    apellido: string;
    rolNombre: string;
    diasOtorgados: number;
    diasConsumidos: number;
    diasDisponibles: number;
}
