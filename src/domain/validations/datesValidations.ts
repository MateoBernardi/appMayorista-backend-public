import { getUsuarioEntidadByContextId } from "../../adapters/db/usuariosRepo";
import * as actividadesRepo from "../../adapters/db/actividadesRepo";
import * as licenciasRepo from "../../adapters/db/licenciasRepo";

export interface RangoOcupado {
    usuario: string;
    tipo: 'solicitud' | 'actividad' | 'licencia';
    desde: Date;
    hasta: Date;
}

// Función de validación de disponibilidad de fechas
// Retorna avisos (warnings) y los rangos ocupados de cada compromiso solapado
export const validarDisponibilidadFechas = async (
    userId: number,
    fechaInicio: Date,
    fechaFin: Date,
    actividadIdExcluir?: number,
): Promise<RangoOcupado[]> => {
    const rangosOcupados: RangoOcupado[] = [];
    
    const usuario = await getUsuarioEntidadByContextId(userId);
    const nombreCompleto = usuario ? `${usuario.nombre} ${usuario.apellido}` : `Usuario`;

    // Verificar si el usuario tiene actividades que se solapen con las fechas
    const actividadesExistentes = await actividadesRepo.getActividadesByUser(userId);
    if (
        actividadesExistentes &&
        Array.isArray(actividadesExistentes.actividades) &&
        actividadesExistentes.actividades.length > 0
    ) {
        for (const actividad of actividadesExistentes.actividades) {
            // Excluir la actividad que se está modificando
            if (actividadIdExcluir && actividad.actividad_id === actividadIdExcluir) {
                continue;
            }
            const actividadInicio = new Date(actividad.fecha_inicio);
            const actividadFin = new Date(actividad.fecha_fin!);
            // Verificar si hay solapamiento de fechas
            if (fechaInicio <= actividadFin && fechaFin >= actividadInicio) {
                rangosOcupados.push({
                    usuario: nombreCompleto,
                    tipo: 'actividad',
                    desde: actividadInicio,
                    hasta: actividadFin,
                });
            }
        }
    }

    // Verificar si el usuario tiene licencias APROBADAS que se solapen con las fechas
    const licenciasAprobadas = await licenciasRepo.findApprovedSolicitudesByDateRange(
        userId,
        fechaInicio,
        fechaFin,
    );

    if (licenciasAprobadas.length > 0) {
        for (const licencia of licenciasAprobadas) {
            const licenciaInicio = new Date(licencia.fecha_inicio);
            const licenciaFin = new Date(licencia.fecha_fin);

            rangosOcupados.push({
                usuario: nombreCompleto,
                tipo: 'licencia',
                desde: licenciaInicio,
                hasta: licenciaFin,
            });
        }
    }

    return rangosOcupados;
};

export const validarDisponibilidadParticipantes = async (
    userIds: number[],
    fechaInicio: Date,
    fechaFin: Date,
    actividadIdExcluir?: number,
): Promise<RangoOcupado[]> => {
    const usuariosUnicos = [...new Set(userIds)];
    const disponibilidad = await Promise.all(
        usuariosUnicos.map((userId) =>
            validarDisponibilidadFechas(userId, fechaInicio, fechaFin, actividadIdExcluir),
        ),
    );
    return disponibilidad.flatMap((rangos) => rangos);
};