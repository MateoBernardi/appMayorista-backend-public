/**
 * Tests de dominio: horariosServices — receiveScan (coordinación de `tipo` y margen de salida)
 * Capa: Domain Service
 * Plataforma: Mayorista
 */

jest.mock('../../adapters/db/horariosRepo');
jest.mock('../../adapters/db/licenciasRepo');
jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../domain/services/reportesServices');
jest.mock('../../domain/services/solicitudesServices');
jest.mock('../../domain/services/devicesService');

import { receiveScan } from '../../domain/services/horariosServices';
import * as horariosRepo from '../../adapters/db/horariosRepo';
import { ScanDTO } from '../../domain/dto/HorariosDTO';

const mockRepo = jest.mocked(horariosRepo);

const TOKEN = 'qr-estatico';

const makeScan = (overrides: Partial<ScanDTO> = {}): ScanDTO => ({
    userContextId: 37,
    fecha: '2026-10-29',
    turno: 'Tarde',
    latitud: -33.496421,
    longitud: -64.316111,
    deviceId: 'device-1',
    token: TOKEN,
    ...overrides,
});

const mockPlanificacion = (overrides: Partial<{ tipo_scan: 'IN' | 'OUT' | 'DONE'; dentroMargenSalida: boolean; geofence: boolean }> = {}) => {
    mockRepo.getDataToCheckScan.mockResolvedValue({
        planificacion: {
            planificacionId: 1520,
            turno: 'Tarde',
            esperado_in: new Date(2026, 9, 29, 16, 25),
            esperado_out: new Date(2026, 9, 29, 20, 30),
            deviceId: 'device-1',
            deviceRowId: 24,
            tipo_scan: 'IN',
            dentroMargenSalida: false,
            geofence: true,
            codigoQr: TOKEN,
            qrMode: 'STATIC',
            qrSecret: null,
            ...overrides,
        },
        solicitudes: [],
    });
};

describe('receiveScan', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockRepo.registerScan.mockResolvedValue({ registrado: true, reporte: null });
    });

    it('registra la entrada cuando tipo coincide con el estado', async () => {
        mockPlanificacion({ tipo_scan: 'IN' });

        const result = await receiveScan(makeScan({ tipo: 'IN' }));

        expect(result).toEqual({ success: true, message: 'Escaneo registrado correctamente.' });
        expect(mockRepo.registerScan).toHaveBeenCalledWith(expect.anything(), 'IN', 1520, 24);
    });

    it('sin tipo (apps viejas) mantiene el comportamiento actual', async () => {
        mockPlanificacion({ tipo_scan: 'IN' });

        const result = await receiveScan(makeScan());

        expect(result.success).toBe(true);
        expect(mockRepo.registerScan).toHaveBeenCalledTimes(1);
    });

    it('tipo=IN con la entrada ya marcada: no registra y avisa ENTRADA_YA_MARCADA', async () => {
        mockPlanificacion({ tipo_scan: 'OUT', dentroMargenSalida: true });

        const result = await receiveScan(makeScan({ tipo: 'IN' }));

        expect(result.success).toBe(false);
        expect(result.code).toBe('ENTRADA_YA_MARCADA');
        expect(mockRepo.registerScan).not.toHaveBeenCalled();
    });

    it('tipo=IN con la entrada ya marcada fuera del margen: igual avisa ENTRADA_YA_MARCADA', async () => {
        mockPlanificacion({ tipo_scan: 'OUT', dentroMargenSalida: false });

        const result = await receiveScan(makeScan({ tipo: 'IN' }));

        expect(result.code).toBe('ENTRADA_YA_MARCADA');
        expect(mockRepo.registerScan).not.toHaveBeenCalled();
    });

    it('tipo=OUT sin entrada marcada: rechaza sin code', async () => {
        mockPlanificacion({ tipo_scan: 'IN' });

        const result = await receiveScan(makeScan({ tipo: 'OUT' }));

        expect(result.success).toBe(false);
        expect(result.code).toBeUndefined();
        expect(mockRepo.registerScan).not.toHaveBeenCalled();
    });

    it('salida dentro del margen de 15 min: se ignora (SALIDA_IGNORADA)', async () => {
        mockPlanificacion({ tipo_scan: 'OUT', dentroMargenSalida: true });

        const result = await receiveScan(makeScan({ tipo: 'OUT' }));

        expect(result.success).toBe(false);
        expect(result.code).toBe('SALIDA_IGNORADA');
        expect(mockRepo.registerScan).not.toHaveBeenCalled();
    });

    it('salida dentro del margen sin tipo (app vieja): también se ignora', async () => {
        mockPlanificacion({ tipo_scan: 'OUT', dentroMargenSalida: true });

        const result = await receiveScan(makeScan());

        expect(result.code).toBe('SALIDA_IGNORADA');
        expect(mockRepo.registerScan).not.toHaveBeenCalled();
    });

    it('salida fuera del margen: se registra', async () => {
        mockPlanificacion({ tipo_scan: 'OUT', dentroMargenSalida: false });

        const result = await receiveScan(makeScan({ tipo: 'OUT' }));

        expect(result.success).toBe(true);
        expect(mockRepo.registerScan).toHaveBeenCalledWith(expect.anything(), 'OUT', 1520, 24);
    });

    it('turno completo (DONE): rechaza', async () => {
        mockPlanificacion({ tipo_scan: 'DONE' });

        const result = await receiveScan(makeScan({ tipo: 'OUT' }));

        expect(result).toEqual({ success: false, message: 'Ya registraste entrada y salida para este turno.' });
        expect(mockRepo.registerScan).not.toHaveBeenCalled();
    });

    describe('carrera entre la validación y la escritura', () => {
        it('si otro escaneo marcó la entrada antes de escribir, NO responde éxito', async () => {
            mockPlanificacion({ tipo_scan: 'IN' });
            mockRepo.registerScan.mockResolvedValue({ registrado: false });

            const result = await receiveScan(makeScan({ tipo: 'IN' }));

            expect(result.success).toBe(false);
            expect(result.code).toBe('ENTRADA_YA_MARCADA');
        });

        it('si otro escaneo marcó la salida antes de escribir, NO responde éxito', async () => {
            mockPlanificacion({ tipo_scan: 'OUT', dentroMargenSalida: false });
            mockRepo.registerScan.mockResolvedValue({ registrado: false });

            const result = await receiveScan(makeScan({ tipo: 'OUT' }));

            expect(result.success).toBe(false);
            expect(result.code).toBe('SALIDA_YA_MARCADA');
        });
    });

    describe('validaciones antes de escribir (sin falsos positivos)', () => {
        it('QR inválido: rechaza y no escribe', async () => {
            mockPlanificacion({ tipo_scan: 'IN' });

            const result = await receiveScan(makeScan({ tipo: 'IN', token: 'otro-qr' }));

            expect(result).toEqual({ success: false, message: 'Token QR inválido.' });
            expect(mockRepo.registerScan).not.toHaveBeenCalled();
        });

        it('fuera del geofence: rechaza y no escribe aunque el QR sea válido', async () => {
            mockPlanificacion({ tipo_scan: 'IN', geofence: false });

            const result = await receiveScan(makeScan({ tipo: 'IN' }));

            expect(result).toEqual({ success: false, message: 'Escaneo fuera del área permitida.' });
            expect(mockRepo.registerScan).not.toHaveBeenCalled();
        });

        it('QR rotativo sin secreto configurado en la sede: rechaza', async () => {
            mockRepo.getDataToCheckScan.mockResolvedValue({
                planificacion: {
                    planificacionId: 1520, turno: 'Tarde',
                    esperado_in: new Date(2026, 9, 29, 16, 25), esperado_out: new Date(2026, 9, 29, 20, 30),
                    deviceId: 'device-1', deviceRowId: 24, tipo_scan: 'IN', dentroMargenSalida: false,
                    geofence: true, codigoQr: TOKEN, qrMode: 'ROTATING', qrSecret: null,
                },
                solicitudes: [],
            });

            const result = await receiveScan(makeScan({ tipo: 'IN' }));

            expect(result.success).toBe(false);
            expect(mockRepo.registerScan).not.toHaveBeenCalled();
        });
    });
});
