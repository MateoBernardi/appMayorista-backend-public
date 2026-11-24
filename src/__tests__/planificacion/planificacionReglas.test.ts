/**
 * Tests de las reglas puras de planificación (src/domain/services/planificacionReglas.ts).
 * Portan los casos de database/tests/snapshot_planificacion.test.sql, dias_vacios_licencia.test.sql
 * (días vacíos y diff) y generar_semana_corrido.test.sql, más reglas de 2 h, domingo, MARCADO, LICENCIA.
 * Capa: Dominio
 */
import {
    FilaDiff,
    ObjetivoSnapshot,
    ObjetivoUsuario,
    SnapshotTurno,
    SolicitudAprobada,
    TurnoDiario,
    UsuarioInfo,
    armarRespuestaPreview,
    calcularDiff,
    diasCubiertosPorPlantilla,
    faltantesProximaSemana,
    faltantesSemanaActual,
    minutosObjetivoDesdeHoras,
    turnosDiasVacios,
    turnosSemana,
    validarPayload,
    ventana,
} from '../../domain/services/planificacionReglas';

// 2026-11-04 es miércoles: ventana 04..07 (lunes 02). 2026-11-08 es domingo.
const AHORA = '2026-11-04 10:00:00';
const HOY = '2026-11-04';
const MANANA = '2026-11-05';

const st = (userContextId: number, diaSemana: number, turno: 'Mañana' | 'Tarde', horaIn: string, horaOut: string, sedeId = 1): SnapshotTurno =>
    ({ userContextId, diaSemana, turno, horaIn, horaOut, sedeId });

let nextId = 1;
const td = (userContextId: number, turno: TurnoDiario['turno'], esperadoIn: string, esperadoOut: string | null, extra: Partial<TurnoDiario> = {}): TurnoDiario => ({
    id: nextId++, userContextId, turno, esperadoIn, esperadoOut, sedeIdIn: 1, sedeIdOut: 1,
    licencia: false, minutosLicencia: 0, horarioCorrido: false, marcadoInAt: null, marcadoOutAt: null,
    generica: false, feriado: false, ...extra,
});

const sol = (usuarioId: number, fechaInicio: string, fechaFin: string, cantidadMinutos: number | null = null): SolicitudAprobada =>
    ({ usuarioId, fechaInicio, fechaFin, cantidadMinutos });

const usuarios: UsuarioInfo[] = [
    { userContextId: 7, nombre: 'Ana', apellido: 'Zapata', rolNombre: 'empleado-super' },
    { userContextId: 8, nombre: 'Beto', apellido: 'Alvarez', rolNombre: 'empleado-super' },
    { userContextId: 14, nombre: 'Carla', apellido: 'Molina', rolNombre: 'empleado-super' },
    { userContextId: 15, nombre: 'Dora', apellido: 'Benitez', rolNombre: 'empleado-limpieza' },
];

const diff = (snapshotTurnos: SnapshotTurno[], turnosViejos: TurnoDiario[], solicitudes: SolicitudAprobada[] = [], ahora = AHORA) =>
    calcularDiff({ snapshotTurnos, turnosViejos, solicitudes, ahora });

const unico = (filas: FilaDiff[]): FilaDiff => {
    expect(filas).toHaveLength(1);
    return filas[0]!;
};

describe('ventana', () => {
    it.each([
        ['2026-11-04 10:00:00', { desde: '2026-11-04', hasta: '2026-11-07', lunes: '2026-11-02' }], // miércoles
        ['2026-11-02 00:00:00', { desde: '2026-11-02', hasta: '2026-11-07', lunes: '2026-11-02' }], // lunes
        ['2026-11-07 23:59:59', { desde: '2026-11-07', hasta: '2026-11-07', lunes: '2026-11-02' }], // sábado
        ['2026-11-08 10:00:00', { desde: '2026-11-09', hasta: '2026-11-14', lunes: '2026-11-09' }], // domingo → semana siguiente
    ])('%s', (ahora, esperado) => expect(ventana(ahora)).toEqual(esperado));
});

describe('minutosObjetivoDesdeHoras', () => {
    it.each([[48, 2880], [52.5, 3150], [0, 0], [0.1, 6], [24.0083, 1440]])('%p h → %p min', (h, m) =>
        expect(minutosObjetivoDesdeHoras(h)).toBe(m));
});

describe('validarPayload', () => {
    const ctx = { usuariosExistentes: [7, 8, 14], sedesActivas: [1, 2], turnosSnapshotActivo: 0 };
    const t = (extra: Record<string, unknown> = {}) => ({
        user_context_id: 7, dia_semana: 1, turno: 'Mañana', hora_in: '08:00', hora_out: '12:00', sede_id: 1, ...extra,
    });

    it('payload válido sin errores', () => {
        expect(validarPayload({ turnos: [t(), t({ turno: 'Tarde', hora_in: '16:00', hora_out: '20:00' })], objetivos: [{ user_context_id: 7, horas: 48 }] }, ctx)).toEqual([]);
    });

    it.each([null, undefined, {}, { turnos: [] }, { turnos: 'x' as never }])('planilla sin turnos: %p', (p) => {
        expect(validarPayload(p as never, ctx)).toEqual(['La planilla no tiene turnos.']);
    });

    it('errores múltiples con los mensajes exactos y en el orden del SQL', () => {
        const errores = validarPayload({
            turnos: [{ user_context_id: 999999, dia_semana: 7, turno: 'Noche', hora_in: '10:00', hora_out: '09:00', sede_id: 99 }],
        }, ctx);
        expect(errores).toEqual([
            'Usuario 999999 inexistente o dado de baja.',
            'Usuario 999999: turno inválido "Noche" (se esperaba Mañana o Tarde).',
            'Usuario 999999: día de semana inválido (7).',
            'Usuario 999999, día 7: horario inválido (10:00 - 09:00).',
            'Usuario 999999: sede 99 inexistente o inactiva.',
        ]);
    });

    it('turno, día, horas y sede nulos', () => {
        const errores = validarPayload({ turnos: [{ user_context_id: 7, dia_semana: null, turno: null, hora_in: null, hora_out: '8:00', sede_id: null }] }, ctx);
        expect(errores).toEqual([
            'Usuario 7: turno inválido "" (se esperaba Mañana o Tarde).',
            'Usuario 7: día de semana inválido ().',
            'Usuario 7, día : horario inválido ( - 8:00).',
            'Usuario 7: sede  inexistente o inactiva.',
        ]);
    });

    it('formato de hora y salida <= entrada', () => {
        expect(validarPayload({ turnos: [t({ hora_in: '24:00' })] }, ctx)).toEqual(['Usuario 7, día 1: horario inválido (24:00 - 12:00).']);
        expect(validarPayload({ turnos: [t({ hora_out: '08:00' })] }, ctx)).toEqual(['Usuario 7, día 1: horario inválido (08:00 - 08:00).']);
    });

    it('usuarios e inexistentes y sedes repetidas se informan una sola vez', () => {
        const errores = validarPayload({ turnos: [t({ user_context_id: 5, sede_id: 9 }), t({ user_context_id: 5, sede_id: 9, dia_semana: 2 })] }, ctx);
        expect(errores).toEqual(['Usuario 5 inexistente o dado de baja.', 'Usuario 5: sede 9 inexistente o inactiva.']);
    });

    it('turno duplicado y solapamiento Mañana/Tarde', () => {
        expect(validarPayload({ turnos: [t(), t({ hora_in: '09:00' })] }, ctx)).toEqual(['Usuario 7, día 1: turno Mañana duplicado.']);
        expect(validarPayload({ turnos: [t(), t({ turno: 'Tarde', hora_in: '11:59', hora_out: '18:00' })] }, ctx))
            .toEqual(['Usuario 7, día 1: los turnos Mañana y Tarde se solapan.']);
        // Tarde que empieza justo cuando termina la Mañana no se solapa
        expect(validarPayload({ turnos: [t(), t({ turno: 'Tarde', hora_in: '12:00', hora_out: '18:00' })] }, ctx)).toEqual([]);
    });

    it('objetivos: rango 0..168 h y usuario existente', () => {
        const objetivos = [
            { user_context_id: 7, horas: 0 }, { user_context_id: 7, horas: 168 }, // válidos
            { user_context_id: 7, horas: -1 }, { user_context_id: 8, horas: 168.5 },
            { user_context_id: 999, horas: 40 }, { user_context_id: 7, horas: null }, { user_context_id: null, horas: 8 },
        ];
        expect(validarPayload({ turnos: [t()], objetivos }, ctx)).toEqual([
            'Objetivo del usuario 7 inválido (-1 horas).',
            'Objetivo del usuario 8 inválido (168.5 horas).',
            'Objetivo del usuario 999 inválido (40 horas).',
            'Objetivo del usuario 7 inválido ( horas).',
            'Objetivo del usuario  inválido (8 horas).',
        ]);
    });

    it('guarda anti-borrado: menos de la mitad de los turnos vigentes', () => {
        const un = { turnos: [t()] };
        expect(validarPayload(un, { ...ctx, turnosSnapshotActivo: 3 })).toEqual([
            'La planilla tiene 1 turnos y la vigente 3: parece que se borró contenido. Revisá la planilla.',
        ]);
        expect(validarPayload(un, { ...ctx, turnosSnapshotActivo: 2 })).toEqual([]); // 1*2 < 2 es falso
        expect(validarPayload(un, { ...ctx, turnosSnapshotActivo: 0 })).toEqual([]);
    });
});

describe('calcularDiff: escenario de snapshot_planificacion.test.sql', () => {
    nextId = 1;
    const escenario = () => {
        const viejos = [
            td(7, 'Mañana', `${HOY} 00:01:00`, `${HOY} 05:00:00`),
            td(7, 'Tarde', `${MANANA} 16:00:00`, `${MANANA} 20:00:00`),
            td(14, 'Mañana', `${MANANA} 09:00:00`, `${MANANA} 13:00:00`, { feriado: true }),
            td(14, 'Tarde', `${MANANA} 16:00:00`, `${MANANA} 20:00:00`),
            td(14, 'Rotativo', `${MANANA} 20:00:00`, `${MANANA} 22:00:00`),
        ];
        const snapshot = [
            st(7, 3, 'Mañana', '06:00', '10:00'),
            st(7, 4, 'Mañana', '07:00', '12:00'),
            st(7, 4, 'Tarde', '16:00', '21:00', 2),
            st(8, 4, 'Mañana', '08:00', '12:00'),
            st(14, 4, 'Mañana', '09:00', '13:00'),
            st(15, 3, 'Mañana', '00:05', '00:30', 3),
        ];
        const solicitudes = [sol(8, `${MANANA} 00:00:00`, `${MANANA} 00:00:00`.replace('05', '06'))];
        return { viejos, snapshot, solicitudes };
    };

    it('1 alta, 1 modificación, 1 baja, 1 sin cambio, 2 omitidos 2h, 1 omitido licencia', () => {
        const { viejos, snapshot, solicitudes } = escenario();
        const filas = diff(snapshot, viejos, solicitudes);
        const por = (a: string) => filas.filter((f) => f.accion === a);
        expect(por('alta').map((f) => [f.userContextId, f.turno])).toEqual([[7, 'Mañana']]);
        expect(por('modificacion').map((f) => [f.userContextId, f.turno])).toEqual([[7, 'Tarde']]);
        expect(por('baja').map((f) => [f.userContextId, f.turno])).toEqual([[14, 'Tarde']]);
        expect(por('sin_cambio').map((f) => f.userContextId)).toEqual([14]);
        expect(por('omitido').map((f) => [f.userContextId, f.motivo]).sort()).toEqual([[15, '2H'], [7, '2H'], [8, 'LICENCIA']].sort());
        // El Rotativo de U14 nunca aparece
        expect(filas.some((f) => (f.turno as string) === 'Rotativo')).toBe(false);
        expect(filas).toHaveLength(7);
    });

    it('la modificación trae viejo y nuevo; la baja no tiene nuevo; el alta no tiene viejo', () => {
        const { viejos, snapshot } = escenario();
        const filas = diff(snapshot, viejos);
        const mod = filas.find((f) => f.accion === 'modificacion')!;
        expect(mod).toMatchObject({ oldIn: `${MANANA} 16:00:00`, oldOut: `${MANANA} 20:00:00`, newIn: `${MANANA} 16:00:00`, newOut: `${MANANA} 21:00:00`, newSede: 2, oldSedeIn: 1 });
        const baja = filas.find((f) => f.accion === 'baja')!;
        expect(baja).toMatchObject({ newIn: null, newOut: null, newSede: null, fecha: MANANA });
        const alta = filas.find((f) => f.accion === 'alta')!;
        expect(alta).toMatchObject({ oldId: null, oldIn: null, newIn: `${MANANA} 07:00:00`, newOut: `${MANANA} 12:00:00` });
    });

    it('faltantes de la semana en curso y de la próxima', () => {
        const { viejos, snapshot, solicitudes } = escenario();
        const filas = diff(snapshot, viejos, solicitudes);
        const vigentes: ObjetivoUsuario[] = [{ userContextId: 7, minutosObjetivo: 2400 }, { userContextId: 14, minutosObjetivo: 2400 }];
        const delSnapshot: ObjetivoSnapshot[] = [
            { userContextId: 7, minutosObjetivo: 2880 }, { userContextId: 8, minutosObjetivo: 1440 }, { userContextId: 14, minutosObjetivo: 2400 },
        ];
        const actual = faltantesSemanaActual({
            snapshotTurnos: snapshot, turnosSemana: viejos, diff: filas, usuarios,
            objetivosVigentes: vigentes, objetivosSnapshot: delSnapshot, ahora: AHORA,
        });
        // U7: 4h59 (omitido) + 5h (alta) + 5h (modificación) = 14.98 h contra 40 h vigentes
        // U8: nada contra 24 h de la planilla; U14: 4 h + Rotativo 2 h (la baja no suma) contra 40 h; U15 sin objetivo
        expect(actual).toEqual([
            { user_context_id: 8, nombre: 'Beto', apellido: 'Alvarez', horas: 0, objetivo: 24 },
            { user_context_id: 14, nombre: 'Carla', apellido: 'Molina', horas: 6, objetivo: 40 },
            { user_context_id: 7, nombre: 'Ana', apellido: 'Zapata', horas: 14.98, objetivo: 40 },
        ]);
        const proxima = faltantesProximaSemana({ snapshotTurnos: snapshot, usuarios, objetivosVigentes: vigentes, objetivosSnapshot: delSnapshot });
        expect(proxima).toEqual([
            { user_context_id: 8, nombre: 'Beto', apellido: 'Alvarez', horas: 4, objetivo: 24 },
            { user_context_id: 14, nombre: 'Carla', apellido: 'Molina', horas: 4, objetivo: 40 },
            { user_context_id: 7, nombre: 'Ana', apellido: 'Zapata', horas: 14, objetivo: 48 },
        ]);
    });
});

describe('calcularDiff: reglas', () => {
    const snap = [st(7, 3, 'Mañana', '14:00', '18:00')];

    describe('regla de 2 h', () => {
        it('viejo que empieza antes del corte (ahora + 2 h) → omitido 2H aunque el nuevo sea lejano', () => {
            const f = unico(diff(snap, [td(7, 'Mañana', `${HOY} 11:59:00`, `${HOY} 15:00:00`)]));
            expect(f).toMatchObject({ accion: 'omitido', motivo: '2H' });
        });
        it('viejo que empieza justo en el corte (12:00) ya se puede modificar', () => {
            const f = unico(diff(snap, [td(7, 'Mañana', `${HOY} 12:00:00`, `${HOY} 15:00:00`)]));
            expect(f.accion).toBe('modificacion');
        });
        it('viejo ya pasado (ayer dentro de la ventana no existe; hoy a la mañana) → 2H', () => {
            const f = unico(diff(snap, [td(7, 'Mañana', `${HOY} 06:00:00`, `${HOY} 10:00:00`)]));
            expect(f).toMatchObject({ accion: 'omitido', motivo: '2H' });
        });
        it('turno nuevo sin viejo usa su propio inicio', () => {
            expect(unico(diff([st(7, 3, 'Mañana', '11:59', '15:00')], []))).toMatchObject({ accion: 'omitido', motivo: '2H' });
            expect(unico(diff([st(7, 3, 'Mañana', '12:00', '15:00')], []))).toMatchObject({ accion: 'alta', motivo: null });
        });
        it('la regla usa el viejo: nuevo lejano pero viejo cercano → 2H; baja de un viejo cercano → 2H', () => {
            const f = unico(diff([st(7, 3, 'Mañana', '18:00', '20:00')], [td(7, 'Mañana', `${HOY} 11:00:00`, `${HOY} 13:00:00`)]));
            expect(f).toMatchObject({ accion: 'omitido', motivo: '2H' });
        });
        it('un viejo cercano sin nuevo (baja) también se omite', () => {
            const filas = diff([st(7, 4, 'Mañana', '08:00', '12:00')], [td(7, 'Mañana', `${HOY} 11:00:00`, `${HOY} 13:00:00`)]);
            expect(filas.find((f) => f.fecha === HOY)).toMatchObject({ accion: 'omitido', motivo: '2H', newIn: null });
        });
    });

    it('domingo: la ventana es la semana siguiente y las altas del lunes no caen en 2 h', () => {
        const domingo = '2026-11-08 10:00:00';
        const filas = diff([st(7, 1, 'Mañana', '07:00', '11:00'), st(7, 6, 'Tarde', '16:00', '20:00')], [], [], domingo);
        expect(filas.map((f) => [f.fecha, f.turno, f.accion])).toEqual([
            ['2026-11-09', 'Mañana', 'alta'],
            ['2026-11-14', 'Tarde', 'alta'],
        ]);
    });

    it('domingo a las 23:00: un viejo del lunes a las 00:30 todavía se puede modificar', () => {
        const f = unico(diff([st(7, 1, 'Mañana', '08:00', '12:00')], [td(7, 'Mañana', '2026-11-09 00:30:00', '2026-11-09 04:00:00')], [], '2026-11-08 20:00:00'));
        expect(f.accion).toBe('modificacion');
    });

    it('MARCADO: viejo lejano con marcado de entrada o de salida', () => {
        for (const extra of [{ marcadoInAt: `${MANANA} 08:01:00` }, { marcadoOutAt: `${MANANA} 12:01:00` }]) {
            const f = unico(diff([st(7, 4, 'Mañana', '09:00', '13:00')], [td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, extra)]));
            expect(f).toMatchObject({ accion: 'omitido', motivo: 'MARCADO' });
        }
    });

    it('un viejo idéntico con marcado sigue siendo sin_cambio', () => {
        const f = unico(diff([st(7, 4, 'Mañana', '08:00', '12:00')], [td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { marcadoInAt: `${MANANA} 08:01:00` })]));
        expect(f).toMatchObject({ accion: 'sin_cambio', motivo: null });
    });

    it('2H tiene prioridad sobre MARCADO y MARCADO sobre LICENCIA', () => {
        expect(unico(diff(snap, [td(7, 'Mañana', `${HOY} 11:00:00`, `${HOY} 15:00:00`, { marcadoInAt: `${HOY} 11:00:00`, licencia: true })])).motivo).toBe('2H');
        expect(unico(diff([st(7, 4, 'Mañana', '09:00', '13:00')], [td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { marcadoInAt: `${MANANA} 08:01:00`, licencia: true })])).motivo).toBe('MARCADO');
    });

    describe('LICENCIA', () => {
        const snapM = [st(7, 4, 'Mañana', '09:00', '13:00')];
        const viejoM = (extra: Partial<TurnoDiario>) => td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, extra);

        it('fila con licencia = true', () => {
            expect(unico(diff(snapM, [viejoM({ licencia: true })]))).toMatchObject({ accion: 'omitido', motivo: 'LICENCIA' });
        });
        it('fila con minutos_licencia > 0 aunque licencia = false', () => {
            expect(unico(diff(snapM, [viejoM({ minutosLicencia: 60 })]))).toMatchObject({ accion: 'omitido', motivo: 'LICENCIA' });
        });
        it('una baja con licencia en el viejo también se omite', () => {
            const f = unico(diff([st(7, 5, 'Mañana', '09:00', '13:00')], [viejoM({ licencia: true })]).filter((x) => x.fecha === MANANA));
            expect(f).toMatchObject({ accion: 'omitido', motivo: 'LICENCIA' });
        });
        it('solicitud APROBADA por días que solapa el nuevo omite el alta', () => {
            const f = unico(diff(snapM, [], [sol(7, `${MANANA} 00:00:00`, '2026-11-06 00:00:00')]));
            expect(f).toMatchObject({ accion: 'omitido', motivo: 'LICENCIA', oldId: null });
        });
        it('solicitud por días que solapa omite también la modificación', () => {
            const f = unico(diff(snapM, [viejoM({})], [sol(7, `${MANANA} 12:30:00`, `${MANANA} 20:00:00`)]));
            expect(f).toMatchObject({ accion: 'omitido', motivo: 'LICENCIA' });
        });
        it('solape estricto: la solicitud que termina cuando empieza el turno (o empieza cuando termina) no omite', () => {
            expect(unico(diff(snapM, [], [sol(7, `${MANANA} 00:00:00`, `${MANANA} 09:00:00`)])).accion).toBe('alta');
            expect(unico(diff(snapM, [], [sol(7, `${MANANA} 13:00:00`, `${MANANA} 23:00:00`)])).accion).toBe('alta');
        });
        it('solicitud por horas (cantidadMinutos != null) NO omite', () => {
            expect(unico(diff(snapM, [], [sol(7, `${MANANA} 00:00:00`, '2026-11-06 00:00:00', 120)])).accion).toBe('alta');
        });
        it('solicitud de otro usuario no omite', () => {
            expect(unico(diff(snapM, [], [sol(8, `${MANANA} 00:00:00`, '2026-11-06 00:00:00')])).accion).toBe('alta');
        });
        it('una baja sin licencia en el viejo ignora las solicitudes (no hay nuevo)', () => {
            const filas = diff([st(7, 5, 'Mañana', '09:00', '13:00')], [viejoM({})], [sol(7, `${MANANA} 00:00:00`, `${MANANA} 23:00:00`)]);
            expect(filas.find((f) => f.fecha === MANANA)).toMatchObject({ accion: 'baja', motivo: null });
        });
    });

    it('turnos genéricos del viejo se ignoran (no son baja ni licencia a respetar)', () => {
        const genericos = [
            td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { generica: true, licencia: true, minutosLicencia: 240 }),
            td(7, 'Tarde', `${MANANA} 16:00:00`, `${MANANA} 20:00:00`, { generica: true, licencia: true, minutosLicencia: 240 }),
        ];
        expect(diff([st(7, 5, 'Mañana', '09:00', '13:00')], genericos)).toEqual([
            expect.objectContaining({ fecha: '2026-11-06', accion: 'alta' }),
        ]);
        // y el reemplazo del genérico por un turno real del mismo día es un alta, no una modificación/omitido
        const f = unico(diff([st(7, 4, 'Mañana', '09:00', '13:00')], genericos));
        expect(f).toMatchObject({ accion: 'alta', motivo: null, oldId: null });
    });

    it('horario corrido con los mismos horarios no es sin_cambio (se reemplaza)', () => {
        const f = unico(diff([st(7, 4, 'Mañana', '08:00', '12:00')], [td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { horarioCorrido: true })]));
        expect(f.accion).toBe('modificacion');
    });

    it('viejo sin salida (corrido, out null) nunca es sin_cambio', () => {
        const f = unico(diff([st(7, 4, 'Mañana', '08:00', '12:00')], [td(7, 'Mañana', `${MANANA} 08:00:00`, null)]));
        expect(f.accion).toBe('modificacion');
    });

    it('cambio de sede de entrada o de salida es modificación', () => {
        const base = [st(7, 4, 'Mañana', '08:00', '12:00', 1)];
        expect(unico(diff(base, [td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { sedeIdOut: 2 })])).accion).toBe('modificacion');
        expect(unico(diff(base, [td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { sedeIdIn: null })])).accion).toBe('modificacion');
    });

    it('solo se consideran usuarios del snapshot, turnos Mañana/Tarde y fechas de la ventana', () => {
        const filas = diff([st(7, 4, 'Mañana', '08:00', '12:00')], [
            td(8, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`),     // usuario fuera del snapshot
            td(7, 'Rotativo', `${MANANA} 20:00:00`, `${MANANA} 22:00:00`),   // Rotativo
            td(7, 'Tarde', '2026-11-03 16:00:00', '2026-11-03 20:00:00'),    // martes ya pasado (fuera de la ventana)
            td(7, 'Tarde', '2026-11-09 16:00:00', '2026-11-09 20:00:00'),    // semana siguiente
        ]);
        expect(filas.map((f) => [f.userContextId, f.accion])).toEqual([[7, 'alta']]);
    });

    it('el snapshot solo genera filas para los días de la ventana (lunes/martes ya pasaron un miércoles)', () => {
        const filas = diff([st(7, 1, 'Mañana', '08:00', '12:00'), st(7, 2, 'Mañana', '08:00', '12:00'), st(7, 6, 'Mañana', '08:00', '12:00')], []);
        expect(filas.map((f) => f.fecha)).toEqual(['2026-11-07']);
    });
});

describe('faltantes', () => {
    const snapshot = [st(7, 4, 'Mañana', '08:00', '12:30')];
    const info = usuarios;

    it('actual: usa el objetivo vigente y, si no hay, el de la planilla; corrido (out null) suma 0', () => {
        const viejos = [td(7, 'Mañana', `${MANANA} 08:00:00`, null, { horarioCorrido: true })];
        const filas = diff(snapshot, viejos);
        const r = faltantesSemanaActual({
            snapshotTurnos: snapshot, turnosSemana: viejos, diff: filas, usuarios: info,
            objetivosVigentes: [], objetivosSnapshot: [{ userContextId: 7, minutosObjetivo: 600 }], ahora: AHORA,
        });
        // el corrido se modifica (excluido del base) y suma el nuevo de 4.5 h
        expect(r).toEqual([{ user_context_id: 7, nombre: 'Ana', apellido: 'Zapata', horas: 4.5, objetivo: 10 }]);

        const r2 = faltantesSemanaActual({
            snapshotTurnos: snapshot, turnosSemana: [td(7, 'Mañana', `${HOY} 06:00:00`, null, { horarioCorrido: true })], diff: [], usuarios: info,
            objetivosVigentes: [{ userContextId: 7, minutosObjetivo: 60 }], objetivosSnapshot: [{ userContextId: 7, minutosObjetivo: 6000 }], ahora: AHORA,
        });
        expect(r2).toEqual([{ user_context_id: 7, nombre: 'Ana', apellido: 'Zapata', horas: 0, objetivo: 1 }]);
    });

    it('actual: solo faltantes (exceso e igual no se informan); sin objetivo o usuario inexistente se omiten', () => {
        const viejos = [td(7, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:30:00`)];
        const base = { snapshotTurnos: snapshot, turnosSemana: viejos, diff: diff(snapshot, viejos), usuarios: info, ahora: AHORA };
        expect(faltantesSemanaActual({ ...base, objetivosVigentes: [{ userContextId: 7, minutosObjetivo: 270 }], objetivosSnapshot: [] })).toEqual([]);
        expect(faltantesSemanaActual({ ...base, objetivosVigentes: [{ userContextId: 7, minutosObjetivo: 100 }], objetivosSnapshot: [] })).toEqual([]);
        expect(faltantesSemanaActual({ ...base, objetivosVigentes: [], objetivosSnapshot: [] })).toEqual([]);
        expect(faltantesSemanaActual({ ...base, usuarios: [], objetivosVigentes: [{ userContextId: 7, minutosObjetivo: 9999 }], objetivosSnapshot: [] })).toEqual([]);
    });

    it('actual: cuenta filas de toda la semana lun-sáb (también las anteriores a hoy) y no las de otra semana', () => {
        const viejos = [
            td(7, 'Mañana', '2026-11-02 08:00:00', '2026-11-02 12:00:00'),
            td(7, 'Mañana', '2026-11-09 08:00:00', '2026-11-09 12:00:00'),
        ];
        const r = faltantesSemanaActual({
            snapshotTurnos: [st(7, 1, 'Mañana', '08:00', '12:00')], turnosSemana: viejos, diff: [], usuarios: info,
            objetivosVigentes: [{ userContextId: 7, minutosObjetivo: 600 }], objetivosSnapshot: [], ahora: AHORA,
        });
        expect(r[0]!.horas).toBe(4);
    });

    it('próxima: objetivo de la planilla > pendiente > vigente; redondeo a 2 decimales', () => {
        const s = [st(7, 1, 'Mañana', '08:00', '08:20'), st(14, 1, 'Mañana', '08:00', '09:00'), st(8, 1, 'Mañana', '08:00', '09:00')];
        const r = faltantesProximaSemana({
            snapshotTurnos: s, usuarios: info,
            objetivosVigentes: [
                { userContextId: 7, minutosObjetivo: 600, minutosObjetivoPendiente: 400 },
                { userContextId: 14, minutosObjetivo: 600, minutosObjetivoPendiente: 30 },
                { userContextId: 8, minutosObjetivo: 600, minutosObjetivoPendiente: null },
            ],
            objetivosSnapshot: [{ userContextId: 7, minutosObjetivo: 500 }],
        });
        expect(r).toEqual([
            { user_context_id: 8, nombre: 'Beto', apellido: 'Alvarez', horas: 1, objetivo: 10 },
            // U14: pendiente 30 min (0.5 h) < 1 h: no es faltante
            { user_context_id: 7, nombre: 'Ana', apellido: 'Zapata', horas: 0.33, objetivo: 8.33 },
        ]);
    });
});

describe('armarRespuestaPreview', () => {
    const snapshot = [
        st(7, 4, 'Mañana', '07:00', '12:00'), st(7, 4, 'Tarde', '16:00', '21:00', 2),
        st(8, 4, 'Mañana', '09:00', '13:00'), st(14, 4, 'Mañana', '09:00', '13:00'),
    ];
    const viejos = [
        td(7, 'Tarde', `${MANANA} 16:00:00`, `${MANANA} 20:00:00`, { horarioCorrido: true }),
        td(14, 'Mañana', `${MANANA} 09:00:00`, `${MANANA} 13:00:00`),
        td(14, 'Tarde', `${MANANA} 16:00:00`, `${MANANA} 20:00:00`),
        td(8, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { licencia: true }),
    ];

    it('JSON idéntico al de snapshot_armar_diff_json', () => {
        const filas = diff(snapshot, viejos);
        const r = armarRespuestaPreview({
            diff: filas, faltantesActual: [], faltantesProxima: [{ user_context_id: 7, nombre: 'Ana', apellido: 'Zapata', horas: 10, objetivo: 48 }],
            usuarios, usuariosSnapshotNuevo: new Set([7, 8, 14]), usuariosSnapshotActivo: [7, 15, 14, 999],
        });
        expect(r).toEqual({
            resumen: { altas: 1, modificaciones: 1, bajas: 1, sinCambios: 1, omitidos2h: 0, omitidosLicencia: 1 },
            detalle: [
                // orden: apellido (Alvarez, Molina, Zapata), fecha, turno (Mañana < Tarde)
                {
                    userContextId: 8, nombre: 'Beto', apellido: 'Alvarez', fecha: MANANA, turno: 'Mañana', accion: 'omitido', motivo: 'LICENCIA',
                    antes: { in: '08:00', out: '12:00', sede: 1, horarioCorrido: false },
                    despues: { in: '09:00', out: '13:00', sede: 1 },
                },
                {
                    userContextId: 14, nombre: 'Carla', apellido: 'Molina', fecha: MANANA, turno: 'Tarde', accion: 'baja', motivo: null,
                    antes: { in: '16:00', out: '20:00', sede: 1, horarioCorrido: false },
                    despues: null,
                },
                {
                    userContextId: 7, nombre: 'Ana', apellido: 'Zapata', fecha: MANANA, turno: 'Mañana', accion: 'alta', motivo: null,
                    antes: null,
                    despues: { in: '07:00', out: '12:00', sede: 1 },
                },
                {
                    userContextId: 7, nombre: 'Ana', apellido: 'Zapata', fecha: MANANA, turno: 'Tarde', accion: 'modificacion', motivo: null,
                    antes: { in: '16:00', out: '20:00', sede: 1, horarioCorrido: true },
                    despues: { in: '16:00', out: '21:00', sede: 2 },
                },
            ],
            faltantes: {
                semanaActual: [],
                proximaSemana: [{ user_context_id: 7, nombre: 'Ana', apellido: 'Zapata', horas: 10, objetivo: 48 }],
            },
            // usuarios del snapshot activo que no están en el nuevo (15) con datos en v_interno_users; 999 no existe
            usuariosSinTurnos: [{ userContextId: 15, nombre: 'Dora', apellido: 'Benitez' }],
        });
    });

    it('sin cambios: detalle y faltantes vacíos, resumen en cero', () => {
        const r = armarRespuestaPreview({
            diff: [], faltantesActual: [], faltantesProxima: [], usuarios,
            usuariosSnapshotNuevo: [], usuariosSnapshotActivo: [],
        });
        expect(r).toEqual({
            resumen: { altas: 0, modificaciones: 0, bajas: 0, sinCambios: 0, omitidos2h: 0, omitidosLicencia: 0 },
            detalle: [], faltantes: { semanaActual: [], proximaSemana: [] }, usuariosSinTurnos: [],
        });
    });

    it('omitidos2h cuenta 2H y MARCADO; el resumen cuenta filas aunque el usuario no esté en v_interno_users', () => {
        const filas = diff(
            [st(7, 3, 'Mañana', '14:00', '18:00'), st(99, 4, 'Mañana', '09:00', '13:00')],
            [td(7, 'Mañana', `${HOY} 11:00:00`, `${HOY} 15:00:00`), td(99, 'Mañana', `${MANANA} 08:00:00`, `${MANANA} 12:00:00`, { marcadoOutAt: `${MANANA} 12:00:00` })],
        );
        const r = armarRespuestaPreview({ diff: filas, faltantesActual: [], faltantesProxima: [], usuarios, usuariosSnapshotNuevo: [7, 99], usuariosSnapshotActivo: [] });
        expect(r.resumen.omitidos2h).toBe(2);
        expect(r.detalle.map((d) => d.userContextId)).toEqual([7]); // el 99 no está en v_interno_users
    });

    it('antes con salida nula (corrido) se informa con out null', () => {
        const filas = diff([st(7, 4, 'Mañana', '08:00', '12:00')], [td(7, 'Mañana', `${MANANA} 08:00:00`, null, { horarioCorrido: true })]);
        const r = armarRespuestaPreview({ diff: filas, faltantesActual: [], faltantesProxima: [], usuarios, usuariosSnapshotNuevo: [7], usuariosSnapshotActivo: [7] });
        expect(r.detalle[0]!.antes).toEqual({ in: '08:00', out: null, sede: 1, horarioCorrido: true });
    });
});

describe('turnosDiasVacios (dias_vacios_licencia.test.sql)', () => {
    const d = '2026-12-28'; // lunes futuro, sin turnos
    const entrada = (extra: Partial<Parameters<typeof turnosDiasVacios>[0]> = {}) => ({
        usuarios: [
            { userContextId: 7, rolNombre: 'empleado-super', minutosObjetivo: 2880 },
            { userContextId: 8, rolNombre: 'empleado-super', minutosObjetivo: 1200 },
        ],
        desde: d, hasta: '2027-01-02', turnosExistentes: [], ...extra,
    });
    const lunesReal = { userContextId: 7, turno: 'Mañana' as const, esperadoIn: `${d} 08:00:00`, generica: false, feriado: false };

    it('usuario con turno el lunes: martes a sábado con dos sintéticos de 240 min (jornada 8 h), 8-12 y 16-20', () => {
        const r = turnosDiasVacios(entrada({ turnosExistentes: [lunesReal] })).filter((x) => x.userContextId === 7);
        expect(r).toHaveLength(10);
        expect(r.some((x) => x.esperadoIn.startsWith(d))).toBe(false); // el lunes con turno real no recibe genéricos
        const martes = r.filter((x) => x.esperadoIn.startsWith('2026-12-29'));
        expect(martes.map((x) => [x.turno, x.esperadoIn, x.esperadoOut])).toEqual([
            ['Mañana', '2026-12-29 08:00:00', '2026-12-29 12:00:00'],
            ['Tarde', '2026-12-29 16:00:00', '2026-12-29 20:00:00'],
        ]);
        expect(martes.reduce((s, x) => s + x.minutosLicencia, 0)).toBe(480);
        expect(martes.every((x) => x.licencia && x.generica)).toBe(true);
    });

    it('semana completa sin turnos, objetivo 20 h (jornada 4 h): 12 filas que suman 6 * 240', () => {
        const r = turnosDiasVacios(entrada()).filter((x) => x.userContextId === 8);
        expect(r).toHaveLength(12);
        expect(r.reduce((s, x) => s + x.minutosLicencia, 0)).toBe(6 * 240);
    });

    it('nunca marca el domingo', () => {
        const r = turnosDiasVacios(entrada({ hasta: '2027-01-03' }));
        expect(r.some((x) => x.esperadoIn.startsWith('2027-01-03'))).toBe(false);
    });

    it('idempotente: no repite los sintéticos que ya existen y completa solo el turno faltante', () => {
        const primera = turnosDiasVacios(entrada({ turnosExistentes: [lunesReal] }));
        const existentes = [lunesReal, ...primera.map((x) => ({ userContextId: x.userContextId, turno: x.turno, esperadoIn: x.esperadoIn, generica: true, feriado: x.feriado }))];
        expect(turnosDiasVacios(entrada({ turnosExistentes: existentes }))).toEqual([]);
        const sinTarde = existentes.filter((x) => !(x.userContextId === 8 && x.turno === 'Tarde' && x.esperadoIn.startsWith('2026-12-30')));
        expect(turnosDiasVacios(entrada({ turnosExistentes: sinTarde }))).toEqual([
            expect.objectContaining({ userContextId: 8, turno: 'Tarde', esperadoIn: '2026-12-30 16:00:00' }),
        ]);
    });

    it('hereda el feriado de cualquier turno del día (de cualquier usuario)', () => {
        const r = turnosDiasVacios(entrada({
            usuarios: [{ userContextId: 8, rolNombre: 'empleado-super', minutosObjetivo: 1200 }],
            turnosExistentes: [
                { userContextId: 7, turno: 'Tarde', esperadoIn: '2026-12-30 16:00:00', generica: true, feriado: true },
                { userContextId: 14, turno: 'Mañana', esperadoIn: '2026-12-31 08:00:00', generica: false, feriado: false },
            ],
        }));
        const feriado = (fecha: string) => r.filter((x) => x.esperadoIn.startsWith(fecha)).map((x) => x.feriado);
        expect(feriado('2026-12-30')).toEqual([true, true]);
        expect(feriado('2026-12-29')).toEqual([false, false]);
    });

    it('un turno real de otro usuario no impide los sintéticos; uno propio sí', () => {
        const r = turnosDiasVacios(entrada({
            usuarios: [{ userContextId: 8, rolNombre: 'empleado-super', minutosObjetivo: 1200 }],
            turnosExistentes: [{ userContextId: 7, turno: 'Mañana', esperadoIn: `${d} 08:00:00`, generica: false, feriado: false }],
        }));
        expect(r.some((x) => x.esperadoIn.startsWith(d))).toBe(true);
    });

    it('limpieza: 07-09 y 20-22; jornada sin objetivo = 480 → 240 por turno; impar se trunca', () => {
        const r = turnosDiasVacios(entrada({ usuarios: [{ userContextId: 15, rolNombre: 'empleado-limpieza', minutosObjetivo: null }], hasta: d }));
        expect(r.map((x) => [x.esperadoIn, x.esperadoOut, x.minutosLicencia])).toEqual([
            [`${d} 07:00:00`, `${d} 09:00:00`, 240],
            [`${d} 20:00:00`, `${d} 22:00:00`, 240],
        ]);
    });

    it('un turno real en un día vacío reemplaza a los sintéticos (martes con turno real no recibe genéricos)', () => {
        const r = turnosDiasVacios(entrada({
            usuarios: [{ userContextId: 7, rolNombre: 'empleado-super', minutosObjetivo: 2880 }],
            turnosExistentes: [
                { userContextId: 7, turno: 'Mañana', esperadoIn: '2026-12-29 09:00:00', generica: false, feriado: false },
                { userContextId: 7, turno: 'Mañana', esperadoIn: '2026-12-30 08:00:00', generica: true, feriado: false },
                { userContextId: 7, turno: 'Tarde', esperadoIn: '2026-12-30 16:00:00', generica: true, feriado: false },
            ],
        }));
        expect(r.some((x) => x.esperadoIn.startsWith('2026-12-29'))).toBe(false);
        expect(r.some((x) => x.esperadoIn.startsWith('2026-12-30'))).toBe(false);
        expect(r.some((x) => x.esperadoIn.startsWith('2026-12-31'))).toBe(true);
    });

    it('usa la ventana de snapshot_aplicar: usuario que no viene en la planilla recibe todos los días lun-sáb de la ventana', () => {
        const v = ventana(AHORA);
        const r = turnosDiasVacios(entrada({
            usuarios: [{ userContextId: 8, rolNombre: 'empleado-super', minutosObjetivo: 2880 }], desde: v.desde, hasta: v.hasta,
        }));
        expect(r).toHaveLength(2 * 4); // jueves... 4 a 7 de noviembre
        expect(r.reduce((s, x) => s + x.minutosLicencia, 0)).toBe(4 * 480);
    });
});

describe('turnosSemana / generar_semana (generar_semana_corrido.test.sql)', () => {
    const lunes = '2030-01-07';
    const plantilla = [
        st(7, 1, 'Mañana', '07:00', '11:00'), st(7, 1, 'Tarde', '16:00', '20:00'),
        st(7, 2, 'Mañana', '07:00', '11:00'), st(14, 3, 'Tarde', '15:00', '19:00', 2),
        st(99, 1, 'Mañana', '07:00', '11:00'),
    ];

    it('genera todos los turnos de usuarios existentes con fechas del lunes dado', () => {
        const r = turnosSemana(plantilla, lunes, [], [7, 14]);
        expect(r).toEqual([
            { userContextId: 7, turno: 'Mañana', esperadoIn: '2030-01-07 07:00:00', esperadoOut: '2030-01-07 11:00:00', sedeIdIn: 1, sedeIdOut: 1 },
            { userContextId: 7, turno: 'Tarde', esperadoIn: '2030-01-07 16:00:00', esperadoOut: '2030-01-07 20:00:00', sedeIdIn: 1, sedeIdOut: 1 },
            { userContextId: 7, turno: 'Mañana', esperadoIn: '2030-01-08 07:00:00', esperadoOut: '2030-01-08 11:00:00', sedeIdIn: 1, sedeIdOut: 1 },
            { userContextId: 14, turno: 'Tarde', esperadoIn: '2030-01-09 15:00:00', esperadoOut: '2030-01-09 19:00:00', sedeIdIn: 2, sedeIdOut: 2 },
        ]);
    });

    it('un día en horario corrido no recibe los demás turnos; el resto se genera completo', () => {
        const r = turnosSemana(plantilla, lunes, [{ userContextId: 7, fecha: '2030-01-07' }], new Set([7, 14]));
        expect(r.filter((x) => x.userContextId === 7 && x.esperadoIn.startsWith('2030-01-07'))).toEqual([]);
        expect(r).toHaveLength(2); // martes de U7 y miércoles de U14
        // el corrido de otro usuario u otro día no afecta
        expect(turnosSemana(plantilla, lunes, [{ userContextId: 14, fecha: '2030-01-07' }, { userContextId: 7, fecha: '2030-01-10' }], [7, 14])).toHaveLength(4);
    });

    it('sin usuarios existentes no genera nada', () => {
        expect(turnosSemana(plantilla, lunes, [], [])).toEqual([]);
    });

    it('diasCubiertosPorPlantilla: usuario + fecha sin repetir (los genéricos de esos días se reemplazan)', () => {
        expect(diasCubiertosPorPlantilla(plantilla, lunes)).toEqual([
            { userContextId: 7, fecha: '2030-01-07' },
            { userContextId: 7, fecha: '2030-01-08' },
            { userContextId: 14, fecha: '2030-01-09' },
            { userContextId: 99, fecha: '2030-01-07' },
        ]);
    });
});
