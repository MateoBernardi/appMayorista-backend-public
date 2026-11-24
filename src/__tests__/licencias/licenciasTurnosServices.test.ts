/**
 * Servicios de licencias sobre turnos con el repo mockeado: orquestación de lecturas/escrituras.
 * Capa: Dominio
 */
jest.mock('../../adapters/db/licenciasTurnosRepo');

import type { PoolClient } from 'pg';
import * as repo from '../../adapters/db/licenciasTurnosRepo';
import { aplicarLicencia, revertirLicencia, aplicarLicenciasATurnos } from '../../domain/services/licenciasTurnosServices';
import type { SolicitudLicencia, TurnoLicencia } from '../../domain/services/licenciasTurnosReglas';

const m = repo as jest.Mocked<typeof repo>;
const client = {} as PoolClient;

const turno = (id: number, hin: string, hout: string | null, extra: Partial<TurnoLicencia> = {}): TurnoLicencia => ({
    id, turno: 'Mañana', esperado_in: `2026-10-19 ${hin}:00`, esperado_out: hout ? `2026-10-19 ${hout}:00` : null,
    licencia: false, minutos_licencia: 0, generica: false, minutos_objetivo: 2880, ...extra,
});
const franco = (inicio: string, fin: string, minutos: number, tipo = 2): SolicitudLicencia => ({
    id: 10, usuario_id: 7, tipo_licencia_id: tipo, fecha_inicio: `2026-10-19 ${inicio}:00`, fecha_fin: `2026-10-19 ${fin}:00`, cantidad_minutos: minutos,
});
const dias: SolicitudLicencia = {
    id: 11, usuario_id: 7, tipo_licencia_id: 1, fecha_inicio: '2026-10-19 00:00:00', fecha_fin: '2026-10-20 00:00:00', cantidad_minutos: null,
};

beforeEach(() => jest.resetAllMocks());

describe('aplicarLicencia', () => {
    it('devuelve 0 si la solicitud no está aprobada', async () => {
        m.getSolicitudAprobada.mockResolvedValue(null);
        expect(await aplicarLicencia(client, 10)).toBe(0);
        expect(m.getTurnosUsuario).not.toHaveBeenCalled();
    });

    it('por horas: actualiza cada turno, consume el franco y devuelve los minutos', async () => {
        m.getSolicitudAprobada.mockResolvedValue(franco('06:00', '10:00', 240));
        m.getTurnosUsuario.mockResolvedValue([turno(1, '08:00', '12:00')]);
        const total = await aplicarLicencia(client, 10, [1]);
        expect(total).toBe(120);
        expect(m.getTurnosUsuario).toHaveBeenCalledWith(client, 7, expect.objectContaining({ ids: [1], soloSinLicencia: true, bloquear: true }));
        expect(m.actualizarTurnoLicencia).toHaveBeenCalledWith(client, {
            id: 1, esperado_in: '2026-10-19 10:00:00', esperado_out: '2026-10-19 12:00:00', licencia: false, minutos_licencia: 120,
        });
        expect(m.consumirFranco).toHaveBeenCalledWith(client, 7, 120, 10);
    });

    it('no consume franco si no es tipo 2 o es sábado desde las 13', async () => {
        m.getSolicitudAprobada.mockResolvedValue(franco('07:00', '13:00', 360, 4));
        m.getTurnosUsuario.mockResolvedValue([turno(1, '08:00', '12:00')]);
        expect(await aplicarLicencia(client, 10)).toBe(240);
        expect(m.consumirFranco).not.toHaveBeenCalled();

        const sab = { ...franco('15:00', '17:00', 120), fecha_inicio: '2026-10-24 15:00:00', fecha_fin: '2026-10-24 17:00:00' };
        m.getSolicitudAprobada.mockResolvedValue(sab);
        m.getTurnosUsuario.mockResolvedValue([{ ...turno(2, '13:00', '17:00'), esperado_in: '2026-10-24 13:00:00', esperado_out: '2026-10-24 17:00:00' }]);
        expect(await aplicarLicencia(client, 10)).toBe(120);
        expect(m.consumirFranco).not.toHaveBeenCalled();
    });

    it('sin solape no escribe ni consume', async () => {
        m.getSolicitudAprobada.mockResolvedValue(franco('13:00', '14:00', 60));
        m.getTurnosUsuario.mockResolvedValue([turno(1, '08:00', '12:00')]);
        expect(await aplicarLicencia(client, 10)).toBe(0);
        expect(m.actualizarTurnoLicencia).not.toHaveBeenCalled();
        expect(m.consumirFranco).not.toHaveBeenCalled();
    });

    it('por días: marca, reparte la jornada y devuelve 0', async () => {
        m.getSolicitudAprobada.mockResolvedValue(dias);
        m.getTurnosUsuario.mockResolvedValue([turno(1, '08:00', '12:00'), turno(2, '16:00', '20:00')]);
        expect(await aplicarLicencia(client, 11)).toBe(0);
        expect(m.marcarTurnosConLicencia).toHaveBeenCalledWith(client, [1, 2]);
        expect(m.setMinutosLicencia).toHaveBeenCalledWith(client, [
            { id: 1, minutos_licencia: 240 }, { id: 2, minutos_licencia: 240 },
        ]);
        expect(m.consumirFranco).not.toHaveBeenCalled();
    });

    it('por días sin turnos para marcar no reparte', async () => {
        m.getSolicitudAprobada.mockResolvedValue(dias);
        m.getTurnosUsuario.mockResolvedValue([turno(1, '08:00', '12:00', { licencia: true })]);
        await aplicarLicencia(client, 11);
        expect(m.setMinutosLicencia).not.toHaveBeenCalled();
    });
});

describe('revertirLicencia', () => {
    it('devuelve 0 si la solicitud no existe', async () => {
        m.getSolicitudPorId.mockResolvedValue(null);
        expect(await revertirLicencia(client, 10)).toBe(0);
    });

    it('por días: limpia los turnos y devuelve la cantidad', async () => {
        m.getSolicitudPorId.mockResolvedValue(dias);
        m.getTurnosUsuario.mockResolvedValue([
            turno(1, '08:00', '12:00', { licencia: true, minutos_licencia: 240 }),
            turno(2, '16:00', '20:00', { licencia: true, minutos_licencia: 240, generica: true }),
        ]);
        expect(await revertirLicencia(client, 11)).toBe(1);
        expect(m.limpiarLicenciaTurnos).toHaveBeenCalledWith(client, [1]);
    });

    it('por horas única: restaura el horario recortado', async () => {
        m.getSolicitudPorId.mockResolvedValue(franco('06:00', '10:00', 240));
        m.getTurnosUsuario.mockResolvedValue([turno(1, '10:00', '12:00', { minutos_licencia: 120 })]);
        m.getOtrasSolicitudesHoras.mockResolvedValue([]);
        m.getPlantillaActiva.mockResolvedValue([]);
        expect(await revertirLicencia(client, 10)).toBe(1);
        expect(m.actualizarTurnoLicencia).toHaveBeenCalledWith(client, {
            id: 1, esperado_in: '2026-10-19 08:00:00', esperado_out: '2026-10-19 12:00:00', licencia: false, minutos_licencia: 0,
        });
    });

    it('por horas compartida: restituye desde la plantilla', async () => {
        m.getSolicitudPorId.mockResolvedValue(franco('06:00', '09:00', 180));
        m.getTurnosUsuario.mockResolvedValue([turno(1, '09:00', '11:00', { minutos_licencia: 120 })]);
        m.getOtrasSolicitudesHoras.mockResolvedValue([{ id: 12, fecha_inicio: '2026-10-19 11:00:00', fecha_fin: '2026-10-19 14:00:00' }]);
        m.getPlantillaActiva.mockResolvedValue([{ turno: 'Mañana', dia_semana: 1, hora_in: '08:00:00', hora_out: '12:00:00' }]);
        await revertirLicencia(client, 10);
        expect(m.actualizarTurnoLicencia).toHaveBeenCalledWith(client, {
            id: 1, esperado_in: '2026-10-19 08:00:00', esperado_out: '2026-10-19 11:00:00', licencia: false, minutos_licencia: 60,
        });
    });

    it('por horas sin turnos con minutos no consulta nada más', async () => {
        m.getSolicitudPorId.mockResolvedValue(franco('06:00', '09:00', 180));
        m.getTurnosUsuario.mockResolvedValue([]);
        expect(await revertirLicencia(client, 10)).toBe(0);
        expect(m.getOtrasSolicitudesHoras).not.toHaveBeenCalled();
    });
});

describe('aplicarLicenciasATurnos', () => {
    it('no hace nada con una lista vacía', async () => {
        await aplicarLicenciasATurnos(client, []);
        expect(m.getTurnosPorIds).not.toHaveBeenCalled();
    });

    it('aplica cada solicitud que solapa, en orden de id, restringida a los turnos dados', async () => {
        const t = { ...turno(5, '08:00', '12:00'), user_context_id: 7 };
        m.getTurnosPorIds.mockResolvedValue([t]);
        const s9 = { ...franco('11:00', '14:00', 180), id: 9 };
        const s3 = { ...dias, id: 3 };
        const lejos = { ...franco('15:00', '16:00', 60), id: 4 };
        m.getSolicitudesAprobadasDeUsuarios.mockResolvedValue([s9, lejos, s3]);
        m.getSolicitudAprobada.mockImplementation(async (_c, id) => (id === 9 ? s9 : id === 3 ? s3 : null));
        m.getTurnosUsuario.mockResolvedValue([t]);

        await aplicarLicenciasATurnos(client, [5]);

        expect(m.getSolicitudAprobada.mock.calls.map(c => c[1])).toEqual([3, 9]);
        expect(m.marcarTurnosConLicencia).toHaveBeenCalledWith(client, [5]);
        expect(m.actualizarTurnoLicencia).toHaveBeenCalledTimes(1); // la solicitud 9 (por horas) recorta el final
        expect(m.getTurnosUsuario).toHaveBeenLastCalledWith(client, 7, expect.objectContaining({ ids: [5] }));
    });
});
