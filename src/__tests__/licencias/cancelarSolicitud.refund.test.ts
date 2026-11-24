/**
 * Reintegro de saldo al cancelar una solicitud aprobada (regla pura calcularReintegro).
 * Cantidades en décimas de día. Se devuelve lo que descontó la cancelada y se recalculan las
 * aprobadas después de ella desde el residuo previo, porque el cobro del fin de semana depende del orden.
 */
import { __licenciasTestUtils } from '../../domain/services/licenciasServices';

const { calcularReintegro, calculateResiduoNuevo } = __licenciasTestUtils;

const sol = (id: number, cantidad_dias: number, residuo_al_aprobar: number | null, dias_descontados: number | null) =>
    ({ id, cantidad_dias, residuo_al_aprobar, dias_descontados });

describe('calcularReintegro()', () => {
    it('única solicitud: devuelve lo descontado y restaura el residuo previo', () => {
        expect(calcularReintegro(sol(1, 140, 0, 140), [])).toEqual({
            diasADevolver: 140,
            nuevoResiduo: 0,
            posteriores: [],
        });
    });

    it('aprobada antes de guardar dias_descontados: lo recalcula desde residuo_al_aprobar', () => {
        // residuo 9 + 8 días → 80 descontados
        expect(calcularReintegro(sol(1, 80, 9, null), [])).toEqual({
            diasADevolver: 80,
            nuevoResiduo: 9,
            posteriores: [],
        });
    });

    it('residuo_al_aprobar null cuenta como 0', () => {
        // 3 días con residuo 0 → 30 + 15 de fin de semana
        expect(calcularReintegro(sol(1, 30, null, null), []).diasADevolver).toBe(45);
    });

    it('recalcula las posteriores: cancelar la del medio cambia el cobro de la siguiente', () => {
        // A: 3 días desde 0 → 45, residuo 30
        // B: 2 días desde 30 → 20, residuo 50   ← se cancela
        // C: 1 día desde 50 → cruza la semana y cobra fin de semana: 25, residuo 5
        // Sin B, C arranca en 30 → 10, residuo 40.
        const a = calculateResiduoNuevo(0, 30);
        const b = calculateResiduoNuevo(a.nuevo_residuo, 20);
        const c = calculateResiduoNuevo(b.nuevo_residuo, 10);
        expect([a.dias_descontados, b.dias_descontados, c.dias_descontados]).toEqual([45, 20, 25]);

        const reintegro = calcularReintegro(
            sol(2, 20, a.nuevo_residuo, b.dias_descontados),
            [sol(3, 10, b.nuevo_residuo, c.dias_descontados)],
        );

        // consumido antes: 45 + 20 + 25 = 90; después: 45 + 10 = 55 → devuelve 35
        expect(reintegro).toEqual({
            diasADevolver: 35,
            nuevoResiduo: 40,
            posteriores: [{ id: 3, residuo_al_aprobar: 30, dias_descontados: 10 }],
        });
    });

    it('cancelar la primera re-encadena todas las posteriores desde su residuo previo', () => {
        // A: 3 días desde 0 → 45 (r30) ← se cancela; B: 2 días desde 30 → 20 (r50)
        // Sin A, B arranca en 0 → 20 + 15 = 35 (r20)
        const reintegro = calcularReintegro(sol(1, 30, 0, 45), [sol(2, 20, 30, 20)]);
        expect(reintegro).toEqual({
            diasADevolver: 45 + 20 - 35,
            nuevoResiduo: 20,
            posteriores: [{ id: 2, residuo_al_aprobar: 0, dias_descontados: 35 }],
        });
    });

    it('cancelar todas en cualquier orden deja el consumido en 0', () => {
        const a = calculateResiduoNuevo(0, 50);
        const b = calculateResiduoNuevo(a.nuevo_residuo, 50);
        let consumido = a.dias_descontados + b.dias_descontados;

        // cancela B (la última) y luego A
        const r1 = calcularReintegro(sol(2, 50, a.nuevo_residuo, b.dias_descontados), []);
        consumido -= r1.diasADevolver;
        const r2 = calcularReintegro(sol(1, 50, 0, a.dias_descontados), []);
        consumido -= r2.diasADevolver;

        expect(consumido).toBe(0);
        expect(r2.nuevoResiduo).toBe(0);
    });
});
