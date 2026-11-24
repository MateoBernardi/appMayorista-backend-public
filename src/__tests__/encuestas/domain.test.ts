jest.mock('../../adapters/db/encuestasRepo');

import * as encuestasRepo from '../../adapters/db/encuestasRepo';
import {
  obtenerEncuestasPorCategoria,
  crearEncuestaCompletaService,
  crearRespuestasService,
  obtenerRespuestasEncuesta,
  obtenerRespuestasPorPregunta,
  verificarSiUsuarioRespondioEncuesta,
  eliminarEncuesta,
} from '../../domain/services/encuestasServices';

const mockRepo = jest.mocked(encuestasRepo);

const baseEncuesta = {
  titulo: 'Encuesta test',
  categoria: 'interna' as const,
  es_anonima: false,
  fecha_fin: new Date('2027-01-01'),
};

const basePreguntas = [
  { titulo: 'P1', tipo_pregunta: 'texto' as const, orden: 1, es_obligatoria: true },
];

describe('EncuestasServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRepo.usuarioRespondioEncuesta.mockResolvedValue(false);
  });

  describe('obtenerEncuestasPorCategoria', () => {
    it('should delegate to getEncuestasPorCategoria', async () => {
      const encuestas = [{ id: 1 }] as any;
      mockRepo.getEncuestasPorCategoria.mockResolvedValue(encuestas);
      const result = await obtenerEncuestasPorCategoria('interna', 10);
      expect(mockRepo.getEncuestasPorCategoria).toHaveBeenCalledWith('interna', 10);
      expect(result).toBe(encuestas);
    });
  });

  describe('crearEncuestaCompletaService', () => {
    it('should throw when titulo is empty', async () => {
      await expect(
        crearEncuestaCompletaService({ ...baseEncuesta, titulo: '' }, basePreguntas)
      ).rejects.toThrow('título de la encuesta es requerido');
    });

    it('should throw when titulo is only whitespace', async () => {
      await expect(
        crearEncuestaCompletaService({ ...baseEncuesta, titulo: '   ' }, basePreguntas)
      ).rejects.toThrow('título de la encuesta es requerido');
    });

    it('should throw when preguntas array is empty', async () => {
      await expect(
        crearEncuestaCompletaService(baseEncuesta, [])
      ).rejects.toThrow('al menos una pregunta');
    });

    it('should throw when preguntas have duplicate order numbers', async () => {
      const preguntas = [
        { ...basePreguntas[0], orden: 1 },
        { titulo: 'P2', tipo_pregunta: 'texto' as const, orden: 1, es_obligatoria: false },
      ];
      await expect(
        crearEncuestaCompletaService(baseEncuesta, preguntas)
      ).rejects.toThrow('orden únicos');
    });

    it('should throw when multiple_choice pregunta has fewer than 2 opciones', async () => {
      const preguntas = [
        {
          titulo: 'MC',
          tipo_pregunta: 'multiple_choice' as const,
          orden: 1,
          opciones: ['sola'],
        },
      ];
      await expect(
        crearEncuestaCompletaService(baseEncuesta, preguntas)
      ).rejects.toThrow('al menos 2 opciones');
    });

    it('should throw when multiple_choice pregunta has no opciones', async () => {
      const preguntas = [
        { titulo: 'MC', tipo_pregunta: 'multiple_choice' as const, orden: 1 },
      ];
      await expect(
        crearEncuestaCompletaService(baseEncuesta, preguntas)
      ).rejects.toThrow('al menos 2 opciones');
    });

    it('should assign createdBy to encuesta and delegate to repo', async () => {
      const created = { id: 1, ...baseEncuesta } as any;
      mockRepo.crearEncuestaCompleta.mockResolvedValue(created);
      const result = await crearEncuestaCompletaService({ ...baseEncuesta }, basePreguntas, 42);
      expect(mockRepo.crearEncuestaCompleta).toHaveBeenCalledWith(
        expect.objectContaining({ created_by: 42 }),
        basePreguntas,
        []
      );
      expect(result).toBe(created);
    });

    it('should not set created_by on encuesta when createdBy is not provided', async () => {
      const created = { id: 2 } as any;
      mockRepo.crearEncuestaCompleta.mockResolvedValue(created);
      const freshEncuesta = { titulo: 'Encuesta test', categoria: 'interna' as const, es_anonima: false, fecha_fin: new Date('2027-01-01') };
      await crearEncuestaCompletaService(freshEncuesta, basePreguntas);
      expect(mockRepo.crearEncuestaCompleta).toHaveBeenCalledWith(
        expect.not.objectContaining({ created_by: expect.anything() }),
        basePreguntas,
        []
      );
    });
  });

  describe('crearRespuestasService', () => {
    const respuestas = [{ pregunta_id: 5, respuesta_texto: 'ok' }] as any;

    it('should throw when respuestas array is empty', async () => {
      await expect(crearRespuestasService([], 1)).rejects.toThrow('al menos una respuesta');
    });

    it('should throw when respuestas is undefined', async () => {
      await expect(crearRespuestasService(undefined as any, 1)).rejects.toThrow('al menos una respuesta');
    });

    it('should throw when first respuesta has no pregunta_id', async () => {
      await expect(
        crearRespuestasService([{ opcion_id: 1 }] as any, 1)
      ).rejects.toThrow('pregunta válida');
    });

    it('should throw when respuesta has no response type', async () => {
      mockRepo.getRespuestasPorPregunta.mockResolvedValue([]);
      await expect(
        crearRespuestasService([{ pregunta_id: 5 }] as any, 1)
      ).rejects.toThrow('tipo de respuesta');
    });

    it('should throw when user already answered the encuesta', async () => {
      mockRepo.getRespuestasPorPregunta.mockResolvedValue([{ id: 1 }] as any);
      mockRepo.usuarioRespondioEncuesta.mockResolvedValue(true);
      await expect(crearRespuestasService(respuestas, 1)).rejects.toThrow('Ya has respondido esta encuesta');
    });

    it('should create respuestas when user has not answered yet', async () => {
      const created = [{ id: 10 }] as any;
      mockRepo.getRespuestasPorPregunta.mockResolvedValue([]);
      mockRepo.crearRespuestas.mockResolvedValue(created);
      const result = await crearRespuestasService(respuestas, 1);
      expect(mockRepo.crearRespuestas).toHaveBeenCalledWith(1, respuestas);
      expect(result).toBe(created);
    });
  });

  describe('obtenerRespuestasEncuesta', () => {
    it('should return encuestas from repo', async () => {
      const encuestas = [{ id: 1 }] as any;
      mockRepo.getRespuestasEncuesta.mockResolvedValue({ encuestas, hasMore: false });
      const result = await obtenerRespuestasEncuesta(1, 5);
      expect(result).toEqual({ encuestas, hasMore: false });
      expect(mockRepo.getRespuestasEncuesta).toHaveBeenCalledWith(1, 5);
    });
  });

  describe('obtenerRespuestasPorPregunta', () => {
    it('should delegate to getRespuestasPorPregunta', async () => {
      const respuestas = [{ id: 1 }] as any;
      mockRepo.getRespuestasPorPregunta.mockResolvedValue(respuestas);
      const result = await obtenerRespuestasPorPregunta(7);
      expect(mockRepo.getRespuestasPorPregunta).toHaveBeenCalledWith(7);
      expect(result).toBe(respuestas);
    });
  });

  describe('verificarSiUsuarioRespondioEncuesta', () => {
    it('should delegate to usuarioRespondioEncuesta', async () => {
      mockRepo.usuarioRespondioEncuesta.mockResolvedValue(true);
      const result = await verificarSiUsuarioRespondioEncuesta(1, 2);
      expect(mockRepo.usuarioRespondioEncuesta).toHaveBeenCalledWith(1, 2);
      expect(result).toBe(true);
    });
  });

  describe('eliminarEncuesta', () => {
    it('should throw when encuesta is not found', async () => {
      mockRepo.getEncuestaById.mockResolvedValue(null as any);
      await expect(eliminarEncuesta(99, 10)).rejects.toThrow('Encuesta no encontrada');
      expect(mockRepo.softDeleteEncuesta).not.toHaveBeenCalled();
    });

    it('should throw when user is not the creator', async () => {
      mockRepo.getEncuestaById.mockResolvedValue({ id: 1, created_by: 5 } as any);
      await expect(eliminarEncuesta(1, 99)).rejects.toThrow('Solo el creador');
      expect(mockRepo.softDeleteEncuesta).not.toHaveBeenCalled();
    });

    it('should soft-delete when user is the creator', async () => {
      mockRepo.getEncuestaById.mockResolvedValue({ id: 1, created_by: 10 } as any);
      mockRepo.softDeleteEncuesta.mockResolvedValue(undefined as any);
      await eliminarEncuesta(1, 10);
      expect(mockRepo.softDeleteEncuesta).toHaveBeenCalledWith(1, 10);
    });
  });
});
