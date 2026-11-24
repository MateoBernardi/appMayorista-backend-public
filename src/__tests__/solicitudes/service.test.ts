/**
 * Tests de dominio: solicitudesServices — createSolicitudService
 * Capa: Domain Service
 * Plataforma: Mayorista
 *
 * Cubre la regla: `descripcion` sólo es obligatoria si la solicitud
 * no tiene fechas ni archivos adjuntos.
 */

jest.mock('../../adapters/db/solicitudesRepo');
jest.mock('../../domain/validations/datesValidations');

import { createSolicitudService } from '../../domain/services/solicitudesServices';
import { SolicitudDTO } from '../../domain/dto/SolicitudDTO';
import * as solicitudesRepo from '../../adapters/db/solicitudesRepo';
import * as datesValidations from '../../domain/validations/datesValidations';

const repo = jest.mocked(solicitudesRepo);
const dates = jest.mocked(datesValidations);

const baseSolicitud: SolicitudDTO = {
  titulo: 'Reunión de equipo',
  descripcion: '',
  created_by: 1,
  fecha_inicio: null,
  fecha_fin: null,
  tipo_actividad: 'SOLICITUD',
  invitados: [1, 2],
  crear_de_todos_modos: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  dates.validarDisponibilidadParticipantes.mockResolvedValue([]);
  repo.createSolicitud.mockResolvedValue(99);
});

describe('createSolicitudService — validación de campos requeridos', () => {
  it('rechaza si falta el título', async () => {
    await expect(
      createSolicitudService({ ...baseSolicitud, titulo: '' })
    ).rejects.toMatchObject({ statusCode: 400, message: 'Por favor, completá todos los campos requeridos.' });
  });

  it('rechaza si no hay descripción, ni fechas, ni archivos', async () => {
    await expect(
      createSolicitudService({ ...baseSolicitud, descripcion: '' })
    ).rejects.toMatchObject({ statusCode: 400, message: 'Por favor, completá todos los campos requeridos.' });
  });

  it('acepta sin descripción si hay fechas', async () => {
    const result = await createSolicitudService({
      ...baseSolicitud,
      descripcion: '',
      fecha_inicio: new Date('2027-01-01T10:00:00'),
      fecha_fin: new Date('2027-01-01T12:00:00'),
    });

    expect(result.created).toBe(true);
  });

  it('acepta sin descripción si hay archivos adjuntos', async () => {
    const result = await createSolicitudService({
      ...baseSolicitud,
      descripcion: '',
      archivosIds: [10],
    });

    expect(result.created).toBe(true);
  });

  it('acepta con descripción aunque no haya fechas ni archivos (comportamiento actual, sin cambios)', async () => {
    const result = await createSolicitudService({
      ...baseSolicitud,
      descripcion: 'Necesito coordinar un encuentro.',
    });

    expect(result.created).toBe(true);
  });
});
