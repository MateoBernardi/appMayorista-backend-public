/**
 * Reglas puras de licencias sobre turnos. Port de database/tests/licencias_turnos.test.sql y de la parte de
 * licencias de database/tests/dias_vacios_licencia.test.sql (aplicar_licencia / revertir_licencia).
 * Capa: Dominio
 */
import {
    SolicitudLicencia, TurnoLicencia, TurnoDeUsuario, TurnoPlantilla, OtraSolicitudHoras,
    aplicarPorHoras, debeConsumirFranco, repartirJornadaPorDia, revertirPorHoras,
    solicitudesQueSolapan, turnosAMarcarPorDias, turnosARevertirPorDias,
} from '../../domain/services/licenciasTurnosReglas';

// 2026-10-19 es lunes
const dia = (n: number) => `2026-10-${19 + n}`;
const ts = (n: number, hhmm: string) => `${dia(n)} ${hhmm}:00`;

let seq = 0;
const turno = (n: number, nombre: string, hin: string | null, hout: string | null, extra: Partial<TurnoLicencia> = {}): TurnoLicencia => ({
    id: ++seq,
    turno: nombre,
    esperado_in: hin ? ts(n, hin) : null,
    esperado_out: hout ? ts(n, hout) : null,
    licencia: false,
    minutos_licencia: 0,
    generica: false,
    minutos_objetivo: 2880,
    ...extra,
});

const horas = (id: number, tipo: number, inicio: string, fin: string, minutos: number): SolicitudLicencia =>
    ({ id, usuario_id: 7, tipo_licencia_id: tipo, fecha_inicio: inicio, fecha_fin: fin, cantidad_minutos: minutos });
const porDias = (id: number, inicio: string, fin: string): SolicitudLicencia =>
    ({ id, usuario_id: 7, tipo_licencia_id: 1, fecha_inicio: inicio, fecha_fin: fin, cantidad_minutos: null });

/** Simula el service sobre un arreglo en memoria: devuelve los turnos nuevos y el consumo de franco. */
const aplicar = (sol: SolicitudLicencia, turnos: TurnoLicencia[], ids?: number[]) => {
    if (sol.cantidad_minutos == null) {
        const marcados = turnosAMarcarPorDias(sol, turnos, ids);
        const marcadosT = turnos.map(t => (marcados.includes(t.id) ? { ...t, licencia: true } : t));
        const jornada = marcadosT[0]?.minutos_objetivo != null && marcadosT[0].minutos_objetivo < 2400 ? 240 : 480;
        const reparto = marcados.length ? repartirJornadaPorDia(marcadosT, marcados, jornada) : [];
        return {
            turnos: marcadosT.map(t => {
                const r = reparto.find(x => x.id === t.id);
                return r ? { ...t, minutos_licencia: r.minutos_licencia } : t;
            }),
            total: 0,
            consume: false,
        };
    }
    const { cambios, total } = aplicarPorHoras(sol, turnos, ids);
    return {
        turnos: turnos.map(t => {
            const c = cambios.find(x => x.id === t.id);
            return c ? { ...t, ...c } : t;
        }),
        total,
        consume: debeConsumirFranco(sol, total),
    };
};

const porId = (turnos: TurnoLicencia[], id: number) => turnos.find(t => t.id === id)!;

describe('licencias por horas (aplicar)', () => {
    let lunM: TurnoLicencia, lunT: TurnoLicencia, mar: TurnoLicencia, mie: TurnoLicencia, jue: TurnoLicencia,
        vie: TurnoLicencia, sab: TurnoLicencia;
    let turnos: TurnoLicencia[];
    beforeEach(() => {
        seq = 0;
        lunM = turno(0, 'Mañana', '08:00', '12:00');
        lunT = turno(0, 'Tarde', '16:00', '20:00');
        mar = turno(1, 'Mañana', '08:00', '12:00');
        mie = turno(2, 'Mañana', '08:00', '12:00');
        jue = turno(3, 'Mañana', '08:00', '12:00');
        vie = turno(4, 'Mañana', '08:00', '12:00');
        sab = turno(5, 'Tarde', '13:00', '17:00');
        turnos = [lunM, lunT, mar, mie, jue, vie, sab];
    });

    it('franco 06-10: recorta el inicio (120 min) y consume saldo', () => {
        const r = aplicar(horas(1, 2, ts(0, '06:00'), ts(0, '10:00'), 240), turnos);
        const t = porId(r.turnos, lunM.id);
        expect(t).toMatchObject({ esperado_in: ts(0, '10:00'), esperado_out: ts(0, '12:00'), minutos_licencia: 120, licencia: false });
        expect(porId(r.turnos, lunT.id)).toMatchObject({ minutos_licencia: 0, esperado_in: ts(0, '16:00') });
        expect(r.total).toBe(120);
        expect(r.consume).toBe(true);
    });

    it('franco 11:15-12:00: recorta el final (45 min)', () => {
        const r = aplicar(horas(2, 2, ts(1, '11:15'), ts(1, '12:00'), 45), turnos);
        expect(porId(r.turnos, mar.id)).toMatchObject({ esperado_in: ts(1, '08:00'), esperado_out: ts(1, '11:15'), minutos_licencia: 45, licencia: false });
        expect(r.total).toBe(45);
    });

    it('licencia en el medio (09-10): horario intacto, 60 min', () => {
        const r = aplicar(horas(3, 2, ts(2, '09:00'), ts(2, '10:00'), 60), turnos);
        expect(porId(r.turnos, mie.id)).toMatchObject({ esperado_in: ts(2, '08:00'), esperado_out: ts(2, '12:00'), minutos_licencia: 60, licencia: false });
        expect(r.total).toBe(60);
    });

    it('permiso especial 07-13 cubre el turno entero: licencia, 240 min, no consume franco', () => {
        const r = aplicar(horas(4, 4, ts(3, '07:00'), ts(3, '13:00'), 360), turnos);
        expect(porId(r.turnos, jue.id)).toMatchObject({ licencia: true, minutos_licencia: 240, esperado_in: ts(3, '08:00'), esperado_out: ts(3, '12:00') });
        expect(r.consume).toBe(false);
    });

    it('franco sábado 15-17 (mismo día, desde las 13): recorta pero no consume saldo', () => {
        const sol = horas(5, 2, ts(5, '15:00'), ts(5, '17:00'), 120);
        const r = aplicar(sol, turnos);
        expect(porId(r.turnos, sab.id)).toMatchObject({ esperado_out: ts(5, '15:00'), minutos_licencia: 120 });
        expect(r.total).toBe(120);
        expect(debeConsumirFranco(sol, 120)).toBe(false);
    });

    it('franco sábado antes de las 13 sí consume; sábado que cruza de día también', () => {
        expect(debeConsumirFranco(horas(1, 2, ts(5, '09:00'), ts(5, '12:00'), 180), 180)).toBe(true);
        expect(debeConsumirFranco(horas(1, 2, ts(5, '14:00'), ts(6, '09:00'), 180), 180)).toBe(true);
        expect(debeConsumirFranco(horas(1, 2, ts(5, '13:00'), ts(5, '17:00'), 240), 240)).toBe(false);
        expect(debeConsumirFranco(horas(1, 2, ts(1, '09:00'), ts(1, '10:00'), 60), 0)).toBe(false);
        expect(debeConsumirFranco(horas(1, 1, ts(1, '09:00'), ts(1, '10:00'), 60), 60)).toBe(false);
    });

    it('consumo total de los francos por horas: 120 + 45 + 60 = 225 en 3 movimientos (el sábado tarde no)', () => {
        const sols = [
            horas(1, 2, ts(0, '06:00'), ts(0, '10:00'), 240),
            horas(2, 2, ts(1, '11:15'), ts(1, '12:00'), 45),
            horas(3, 2, ts(2, '09:00'), ts(2, '10:00'), 60),
            horas(5, 2, ts(5, '15:00'), ts(5, '17:00'), 120),
        ];
        let actual = turnos;
        let consumo = 0;
        let movimientos = 0;
        for (const s of sols) {
            const r = aplicar(s, actual);
            actual = r.turnos;
            if (r.consume) { consumo += r.total; movimientos++; }
        }
        expect(consumo).toBe(225);
        expect(movimientos).toBe(3);
    });

    it('licencia que no solapa estrictamente (toca el borde) no hace nada', () => {
        const r = aplicar(horas(1, 2, ts(0, '06:00'), ts(0, '08:00'), 120), turnos);
        expect(r.total).toBe(0);
        expect(porId(r.turnos, lunM.id).minutos_licencia).toBe(0);
    });

    it('filtra por ids de turno y saltea los que ya tienen licencia', () => {
        const conLic = { ...lunM, licencia: true };
        const r = aplicarPorHoras(horas(1, 2, ts(0, '07:00'), ts(0, '21:00'), 800), [conLic, lunT], [conLic.id, lunT.id]);
        expect(r.cambios.map(c => c.id)).toEqual([lunT.id]);
        const r2 = aplicarPorHoras(horas(1, 2, ts(0, '07:00'), ts(0, '21:00'), 800), [lunM, lunT], [lunT.id]);
        expect(r2.cambios.map(c => c.id)).toEqual([lunT.id]);
        expect(r2.total).toBe(240);
    });

    it('un turno de horario corrido (sin salida) usa la jornada como fin y no inventa esperado_out', () => {
        const corrido = turno(0, 'Mañana', '08:00', null);
        const r = aplicarPorHoras(horas(1, 2, ts(0, '10:00'), ts(0, '11:00'), 60), [corrido]);
        expect(r.cambios[0]).toMatchObject({ minutos_licencia: 60, esperado_out: null, esperado_in: ts(0, '08:00'), licencia: false });
        // cubre todo el corrido de 8 h
        const r2 = aplicarPorHoras(horas(1, 2, ts(0, '07:00'), ts(0, '16:00'), 540), [corrido]);
        expect(r2.cambios[0]).toMatchObject({ licencia: true, minutos_licencia: 480 });
    });

    it('licencia que cubre el inicio pero no el fin: esperado_in pasa al fin de la licencia', () => {
        const r = aplicarPorHoras(horas(1, 2, ts(0, '08:00'), ts(0, '10:30'), 150), [lunM]);
        expect(r.cambios[0]).toMatchObject({ esperado_in: ts(0, '10:30'), esperado_out: ts(0, '12:00'), minutos_licencia: 150, licencia: false });
    });

    it('turnos sucesivos se evalúan con los datos leídos al principio', () => {
        const a = turno(0, 'Mañana', '08:00', '12:00');
        const b = turno(0, 'Tarde', '12:00', '16:00');
        const r = aplicarPorHoras(horas(1, 2, ts(0, '10:00'), ts(0, '14:00'), 240), [b, a]);
        // ordenado por esperado_in: a primero
        expect(r.cambios.map(c => c.id)).toEqual([a.id, b.id]);
        expect(r.cambios[0]).toMatchObject({ esperado_out: ts(0, '10:00'), minutos_licencia: 120 });
        expect(r.cambios[1]).toMatchObject({ esperado_in: ts(0, '14:00'), minutos_licencia: 120 });
        expect(r.total).toBe(240);
    });

    it('sin fechas la solicitud no toca nada', () => {
        const sol = { ...horas(1, 2, ts(0, '08:00'), ts(0, '10:00'), 120), fecha_inicio: null };
        expect(aplicarPorHoras(sol, turnos)).toEqual({ cambios: [], total: 0 });
    });
});

describe('licencias por días (aplicar)', () => {
    beforeEach(() => { seq = 0; });

    it('vacaciones del viernes: marca el turno y descuenta la jornada completa (480)', () => {
        const vie = turno(4, 'Mañana', '08:00', '12:00');
        const sab = turno(5, 'Tarde', '13:00', '17:00');
        const r = aplicar(porDias(1, ts(4, '00:00'), ts(5, '00:00')), [vie, sab]);
        expect(porId(r.turnos, vie.id)).toMatchObject({ licencia: true, minutos_licencia: 480 });
        expect(porId(r.turnos, sab.id)).toMatchObject({ licencia: false, minutos_licencia: 0 });
        expect(r.total).toBe(0);
    });

    it('reparte la jornada entre los turnos del día: 480 / 2 = 240 cada uno', () => {
        const m = turno(0, 'Mañana', '08:00', '12:00');
        const t = turno(0, 'Tarde', '16:00', '20:00');
        const r = aplicar(porDias(1, ts(0, '00:00'), ts(1, '00:00')), [t, m]);
        expect(porId(r.turnos, m.id).minutos_licencia).toBe(240);
        expect(porId(r.turnos, t.id).minutos_licencia).toBe(240);
    });

    it('el resto de la división va al primer turno (orden esperado_in, id)', () => {
        const ts7 = Array.from({ length: 7 }, (_, i) => turno(0, 'Mañana', `0${i + 1}:00`, `0${i + 1}:30`));
        const marcados = ts7.map(t => t.id);
        const r = repartirJornadaPorDia(ts7.map(t => ({ ...t, licencia: true })), marcados, 480);
        expect(r.find(x => x.id === ts7[0].id)!.minutos_licencia).toBe(68 + 4);
        expect(r.filter(x => x.id !== ts7[0].id).every(x => x.minutos_licencia === 68)).toBe(true);
        expect(r.reduce((s, x) => s + x.minutos_licencia, 0)).toBe(480);
    });

    it('jornada de 240 con objetivo menor a 40 h', () => {
        const m = turno(0, 'Mañana', '08:00', '12:00', { minutos_objetivo: 1200 });
        const t = turno(0, 'Tarde', '16:00', '20:00', { minutos_objetivo: 1200 });
        const r = aplicar(porDias(1, ts(0, '00:00'), ts(1, '00:00')), [m, t]);
        expect(porId(r.turnos, m.id).minutos_licencia).toBe(120);
    });

    it('no reparte si algún turno del día queda sin licencia o ya tenía minutos (licencia por horas previa)', () => {
        const m = turno(0, 'Mañana', '08:00', '12:00');
        const t = turno(0, 'Tarde', '16:00', '20:00');
        // vacaciones solo cubren la mañana (fin 14:00): la tarde sigue sin licencia
        const r = aplicar(porDias(1, ts(0, '00:00'), ts(0, '14:00')), [m, t]);
        expect(porId(r.turnos, m.id)).toMatchObject({ licencia: true, minutos_licencia: 0 });
        // con minutos previos en la tarde (licencia por horas ya aplicada que la marcó)
        const m2 = turno(1, 'Mañana', '08:00', '12:00');
        const t2 = turno(1, 'Tarde', '16:00', '20:00', { licencia: true, minutos_licencia: 240 });
        const r2 = aplicar(porDias(2, ts(1, '00:00'), ts(2, '00:00')), [m2, t2]);
        expect(porId(r2.turnos, m2.id)).toMatchObject({ licencia: true, minutos_licencia: 0 });
        expect(porId(r2.turnos, t2.id).minutos_licencia).toBe(240);
    });

    it('las genéricas no cuentan en el reparto ni se marcan por la rama de reversión', () => {
        const real = turno(0, 'Mañana', '08:00', '12:00');
        const g1 = turno(0, 'Tarde', '16:00', '20:00', { generica: true, licencia: true, minutos_licencia: 240 });
        const r = repartirJornadaPorDia([{ ...real, licencia: true }, g1], [real.id], 480);
        expect(r).toEqual([{ id: real.id, minutos_licencia: 480 }]);
        const sol = porDias(1, ts(0, '00:00'), ts(1, '00:00'));
        expect(turnosARevertirPorDias(sol, [{ ...real, licencia: true }, g1])).toEqual([real.id]);
    });

    it('filtra por ids, saltea los que ya tienen licencia y respeta el rango completo del turno', () => {
        const a = turno(0, 'Mañana', '08:00', '12:00');
        const b = turno(0, 'Tarde', '16:00', '20:00');
        const sol = porDias(1, ts(0, '00:00'), ts(1, '00:00'));
        expect(turnosAMarcarPorDias(sol, [a, b], [b.id])).toEqual([b.id]);
        expect(turnosAMarcarPorDias(sol, [{ ...a, licencia: true }, b])).toEqual([b.id]);
        // inicio a mitad del turno: no entra (esperado_in < inicio)
        expect(turnosAMarcarPorDias(porDias(2, ts(0, '09:00'), ts(1, '00:00')), [a])).toEqual([]);
        // turno corrido: fin = in + jornada
        const c = turno(0, 'Mañana', '08:00', null);
        expect(turnosAMarcarPorDias(porDias(3, ts(0, '08:00'), ts(0, '15:00')), [c])).toEqual([]);
        expect(turnosAMarcarPorDias(porDias(3, ts(0, '08:00'), ts(0, '16:00')), [c])).toEqual([c.id]);
    });

    it('vacaciones de 7 días: seis días de 480 y revertir los deja en 0 sin tocar genéricos', () => {
        const reales = [0, 1, 2, 3, 4, 5].map(n => turno(n, 'Mañana', '08:00', '12:00'));
        const gen = turno(6, 'Mañana', '08:00', '12:00', { generica: true, licencia: true, minutos_licencia: 240 });
        const sol = porDias(1, ts(0, '00:00'), ts(7, '00:00'));
        const r = aplicar(sol, [...reales, gen]);
        expect(r.turnos.filter(t => !t.generica).reduce((s, t) => s + t.minutos_licencia, 0)).toBe(6 * 480);
        const ids = turnosARevertirPorDias(sol, r.turnos);
        expect(ids.sort()).toEqual(reales.map(t => t.id).sort());
        expect(ids).not.toContain(gen.id);
    });
});

describe('reversión por horas', () => {
    const plantilla: TurnoPlantilla[] = [{ turno: 'Mañana', dia_semana: 1, hora_in: '08:00:00', hora_out: '12:00:00' }];

    beforeEach(() => { seq = 0; });

    it('única (inicio): restaura esperado_in con minutos_licencia y deja 0', () => {
        const base = turno(0, 'Mañana', '08:00', '12:00');
        const sol = horas(1, 2, ts(0, '06:00'), ts(0, '10:00'), 240);
        const aplicada = aplicar(sol, [base]).turnos[0]!;
        const r = revertirPorHoras(sol, [aplicada], [], plantilla);
        expect(r.revertidos).toBe(1);
        expect(r.cambios[0]).toEqual({ id: base.id, esperado_in: ts(0, '08:00'), esperado_out: ts(0, '12:00'), licencia: false, minutos_licencia: 0 });
    });

    it('única (final): restaura esperado_out', () => {
        const base = turno(1, 'Mañana', '08:00', '12:00');
        const sol = horas(2, 2, ts(1, '11:15'), ts(1, '12:00'), 45);
        const aplicada = aplicar(sol, [base]).turnos[0]!;
        const r = revertirPorHoras(sol, [aplicada], [], []);
        expect(r.cambios[0]).toMatchObject({ esperado_in: ts(1, '08:00'), esperado_out: ts(1, '12:00'), minutos_licencia: 0, licencia: false });
    });

    it('única (entero): licencia pasa a false y minutos a 0, horario intacto', () => {
        const base = turno(3, 'Mañana', '08:00', '12:00');
        const sol = horas(4, 4, ts(3, '07:00'), ts(3, '13:00'), 360);
        const aplicada = aplicar(sol, [base]).turnos[0]!;
        const r = revertirPorHoras(sol, [aplicada], [], []);
        expect(r.cambios[0]).toMatchObject({ licencia: false, minutos_licencia: 0, esperado_in: ts(3, '08:00'), esperado_out: ts(3, '12:00') });
    });

    it('única (medio): sin recorte no mueve horarios', () => {
        const base = turno(2, 'Mañana', '08:00', '12:00');
        const sol = horas(3, 2, ts(2, '09:00'), ts(2, '10:00'), 60);
        const aplicada = aplicar(sol, [base]).turnos[0]!;
        const r = revertirPorHoras(sol, [aplicada], [], []);
        expect(r.cambios[0]).toMatchObject({ esperado_in: ts(2, '08:00'), esperado_out: ts(2, '12:00'), minutos_licencia: 0 });
    });

    it('compartida: otra solicitud solapa; restituye desde la plantilla activa y resta solo su solape', () => {
        const base = turno(0, 'Mañana', '08:00', '12:00');
        const a = horas(1, 2, ts(0, '06:00'), ts(0, '09:00'), 180);
        const b = horas(2, 2, ts(0, '11:00'), ts(0, '14:00'), 180);
        let turnos = aplicar(a, [base]).turnos;
        turnos = aplicar(b, turnos).turnos;
        expect(turnos[0]).toMatchObject({ esperado_in: ts(0, '09:00'), esperado_out: ts(0, '11:00'), minutos_licencia: 120 });

        const otras: OtraSolicitudHoras[] = [{ id: 2, fecha_inicio: b.fecha_inicio, fecha_fin: b.fecha_fin }];
        const r = revertirPorHoras(a, turnos, otras, plantilla);
        expect(r.cambios[0]).toEqual({ id: base.id, esperado_in: ts(0, '08:00'), esperado_out: ts(0, '11:00'), licencia: false, minutos_licencia: 60 });
    });

    it('compartida sin plantilla activa: conserva el horario actual', () => {
        const base = turno(0, 'Mañana', '08:00', '12:00');
        const a = horas(1, 2, ts(0, '06:00'), ts(0, '09:00'), 180);
        const b = horas(2, 2, ts(0, '11:00'), ts(0, '14:00'), 180);
        const turnos = aplicar(b, aplicar(a, [base]).turnos).turnos;
        const r = revertirPorHoras(a, turnos, [{ id: 2, fecha_inicio: b.fecha_inicio, fecha_fin: b.fecha_fin }], []);
        expect(r.cambios[0]).toMatchObject({ esperado_in: ts(0, '09:00'), esperado_out: ts(0, '11:00') });
        expect(r.cambios[0]!.minutos_licencia).toBe(120);
    });

    it('GREATEST(0, ...) en la compartida: nunca queda negativo', () => {
        const t = turno(0, 'Mañana', '09:00', '12:00', { minutos_licencia: 30 });
        const a = horas(1, 2, ts(0, '06:00'), ts(0, '09:00'), 180);
        const r = revertirPorHoras(a, [{ ...t, minutos_licencia: 30 }], [{ id: 2, fecha_inicio: ts(0, '11:00'), fecha_fin: ts(0, '14:00') }], plantilla);
        // plan_in = 08:00 -> solape 06:00-09:00 vs 08:00 = 60 > 30
        expect(r.cambios[0]!.minutos_licencia).toBe(0);
    });

    it('otra solicitud que no solapa (borde exclusivo) no hace compartido; el solape de la otra es inclusivo', () => {
        const base = turno(0, 'Mañana', '08:00', '12:00', { minutos_licencia: 120, esperado_in: ts(0, '10:00') });
        const a = horas(1, 2, ts(0, '06:00'), ts(0, '10:00'), 240);
        const lejos: OtraSolicitudHoras[] = [{ id: 2, fecha_inicio: ts(0, '13:00'), fecha_fin: ts(0, '14:00') }];
        const unica = revertirPorHoras(a, [base], lejos, plantilla);
        expect(unica.cambios[0]).toMatchObject({ esperado_in: ts(0, '08:00'), minutos_licencia: 0 });
        // la otra empieza justo a la salida del turno (<= fin): inclusive => compartida
        const borde: OtraSolicitudHoras[] = [{ id: 2, fecha_inicio: ts(0, '12:00'), fecha_fin: ts(0, '13:00') }];
        const compartida = revertirPorHoras(a, [base], borde, plantilla);
        expect(compartida.cambios[0]).toMatchObject({ esperado_in: ts(0, '08:00'), minutos_licencia: 0 });
    });

    it('ignora genéricas, turnos sin minutos y fuera de rango', () => {
        const gen = turno(0, 'Mañana', '08:00', '12:00', { generica: true, minutos_licencia: 240, licencia: true });
        const sin = turno(0, 'Tarde', '16:00', '20:00');
        const lejos = turno(3, 'Mañana', '08:00', '12:00', { minutos_licencia: 60 });
        const sol = horas(1, 2, ts(0, '06:00'), ts(0, '10:00'), 240);
        expect(revertirPorHoras(sol, [gen, sin, lejos], [], plantilla)).toEqual({ cambios: [], revertidos: 0 });
    });
});

describe('solicitudesQueSolapan (aplicar_licencias_a_turnos)', () => {
    beforeEach(() => { seq = 0; });

    it('devuelve ids distintos ordenados, solo del mismo usuario y con solape estricto', () => {
        const t: TurnoDeUsuario = { ...turno(0, 'Mañana', '08:00', '12:00'), user_context_id: 8 };
        const sols: SolicitudLicencia[] = [
            { ...horas(9, 2, ts(0, '11:00'), ts(0, '14:00'), 180), usuario_id: 8 },
            { ...porDias(3, ts(0, '00:00'), ts(1, '00:00')), usuario_id: 8 },
            { ...horas(5, 2, ts(0, '12:00'), ts(0, '13:00'), 60), usuario_id: 8 },   // toca el borde
            { ...horas(6, 2, ts(0, '06:00'), ts(0, '08:00'), 120), usuario_id: 8 },  // toca el borde
            { ...horas(7, 2, ts(0, '09:00'), ts(0, '10:00'), 60), usuario_id: 7 },    // otro usuario
        ];
        expect(solicitudesQueSolapan([t], [...sols, sols[0]!])).toEqual([3, 9]);
    });

    it('usa el fin calculado con la jornada si el turno no tiene salida', () => {
        const t: TurnoDeUsuario = { ...turno(0, 'Mañana', '08:00', null), user_context_id: 7 };
        expect(solicitudesQueSolapan([t], [horas(1, 2, ts(0, '15:00'), ts(0, '17:00'), 120)])).toEqual([1]);
        expect(solicitudesQueSolapan([t], [horas(1, 2, ts(0, '16:00'), ts(0, '17:00'), 60)])).toEqual([]);
    });
});
