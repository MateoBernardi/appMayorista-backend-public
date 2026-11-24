import { __licenciasTestUtils } from '../../domain/services/licenciasServices';

describe('calculateResiduoNuevo()', () => {
    // En esta funcion se trabaja en decimas.
    // Caso solicitado: persona con 21 dias de base.
    const residuoBase = 0;

    const casos = [
        {
            tomadoDias: 0.5,
            esperadoDiasDescontadosDecimas: 20,
            esperadoNuevoResiduo: 5,
        },
        {
            tomadoDias: 1,
            esperadoDiasDescontadosDecimas: 25,
            esperadoNuevoResiduo: 10,
        },
        {
            tomadoDias: 2,
            esperadoDiasDescontadosDecimas: 35,
            esperadoNuevoResiduo: 20,
        },
        {
            tomadoDias: 21,
            esperadoDiasDescontadosDecimas: 210,
            esperadoNuevoResiduo: 0,
        },
        {
            tomadoDias: 7.5,
            esperadoDiasDescontadosDecimas: 90,
            esperadoNuevoResiduo: 5,
        },
        {
            tomadoDias: 7,
            esperadoDiasDescontadosDecimas: 70,
            esperadoNuevoResiduo: 0,
        },
        {
            tomadoDias: 6,
            esperadoDiasDescontadosDecimas: 90,
            esperadoNuevoResiduo: 5,
        },
        {
            tomadoDias: 0.5,
            esperadoDiasDescontadosDecimas: 20,
            esperadoNuevoResiduo: 5,
        },
    ];

    it.each(casos)(
        'residuo=21, toma $tomadoDias dias',
        ({ tomadoDias, esperadoDiasDescontadosDecimas, esperadoNuevoResiduo }) => {
            const daysDecimas = tomadoDias * 10;

            const result = __licenciasTestUtils.calculateResiduoNuevo(residuoBase, daysDecimas);

            expect(result).toEqual({
                dias_descontados: esperadoDiasDescontadosDecimas,
                nuevo_residuo: esperadoNuevoResiduo,
            });
        }
    );
});
