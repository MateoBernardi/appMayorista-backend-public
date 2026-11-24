jest.mock('../../adapters/db/kanbanRepo');
jest.mock('../../adapters/db/solicitudesRepo');

import * as kanbanRepo from '../../adapters/db/kanbanRepo';
import {
  getAllObjetivos,
  createObjetivo,
  updateObjetivo,
  editObjetivoService,
  handleArchivosObjetivo,
  handleInvitadosObjetivo,
  deleteObjetivo,
} from '../../domain/services/kanbanServices';

const mockKanbanRepo = jest.mocked(kanbanRepo);

const objetivoBase = {
  id: 1,
  titulo: 'Objetivo 1',
  estado: 'PENDIENTE',
  rank_position: '0|hzzzzz:',
} as any;

describe('KanbanServices', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKanbanRepo.getObjetivoById.mockResolvedValue(objetivoBase);
    mockKanbanRepo.getMaxRank.mockResolvedValue(null);
    mockKanbanRepo.getMinRank.mockResolvedValue(null);
    mockKanbanRepo.createObjetivo.mockResolvedValue(objetivoBase);
    mockKanbanRepo.updateObjetivo.mockResolvedValue(objetivoBase);
  });

  describe('getAllObjetivos', () => {
    it('should delegate to getObjetivos and return results', async () => {
      const obs = [{ id: 1 }] as any;
      mockKanbanRepo.getObjetivos.mockResolvedValue(obs);
      const result = await getAllObjetivos(5);
      expect(mockKanbanRepo.getObjetivos).toHaveBeenCalledWith(5);
      expect(result).toBe(obs);
    });
  });

  describe('createObjetivo', () => {
    const data = { titulo: 'Ob1', estado: 'BACKLOG' } as any;

    it('should use middle rank when no maxRank exists', async () => {
      mockKanbanRepo.getMaxRank.mockResolvedValue(null);
      await createObjetivo(data, 1);
      expect(mockKanbanRepo.createObjetivo).toHaveBeenCalledWith(
        data,
        expect.any(String),
        1
      );
    });

    it('should generate next rank when maxRank exists', async () => {
      mockKanbanRepo.getMaxRank.mockResolvedValue('0|hzzzzz:');
      await createObjetivo(data, 1);
      const [, rank] = mockKanbanRepo.createObjetivo.mock.calls[0] as any;
      expect(rank).toBeTruthy();
    });

    it('should use prev rank (front of list) for PRIORIDAD estado', async () => {
      const priorityData = { titulo: 'Priority', estado: 'PRIORIDAD' } as any;
      mockKanbanRepo.getMinRank.mockResolvedValue('0|i00000:');
      await createObjetivo(priorityData, 1);
      expect(mockKanbanRepo.getMinRank).toHaveBeenCalled();
      expect(mockKanbanRepo.getMaxRank).not.toHaveBeenCalled();
    });
  });

  describe('updateObjetivo', () => {
    it('should throw when objetivo is not found', async () => {
      mockKanbanRepo.getObjetivoById.mockResolvedValue(null);
      await expect(updateObjetivo(99, { titulo: 'x' }, 1)).rejects.toThrow('Objetivo no encontrado');
      expect(mockKanbanRepo.updateObjetivo).not.toHaveBeenCalled();
    });

    it('should add bitacora entry when estado changes', async () => {
      mockKanbanRepo.addBitacora.mockResolvedValue(undefined as any);
      await updateObjetivo(1, { estado: 'EN_PROGRESO' }, 7);
      expect(mockKanbanRepo.addBitacora).toHaveBeenCalledWith(
        expect.objectContaining({
          objetivo_id: 1,
          usuario_id: 7,
          estado_anterior: 'PENDIENTE',
          estado_nuevo: 'EN_PROGRESO',
        })
      );
    });

    it('should add bitacora entry when observacion is provided', async () => {
      mockKanbanRepo.addBitacora.mockResolvedValue(undefined as any);
      await updateObjetivo(1, { observacion: 'nota' }, 7);
      expect(mockKanbanRepo.addBitacora).toHaveBeenCalledWith(
        expect.objectContaining({ observacion: 'nota' })
      );
    });

    it('should NOT add bitacora when estado is unchanged and no observacion', async () => {
      await updateObjetivo(1, { titulo: 'new title' }, 7);
      expect(mockKanbanRepo.addBitacora).not.toHaveBeenCalled();
    });

    it('should compute new rank when moving to PRIORIDAD from another estado', async () => {
      mockKanbanRepo.getMinRank.mockResolvedValue('0|i00000:');
      mockKanbanRepo.addBitacora.mockResolvedValue(undefined as any);
      await updateObjetivo(1, { estado: 'PRIORIDAD' }, 7);
      const [, updateData] = mockKanbanRepo.updateObjetivo.mock.calls[0] as any;
      expect(updateData.rank_position).toBeTruthy();
    });

    it('should NOT recompute rank when estado stays PRIORIDAD', async () => {
      const priorityObjetivo = { ...objetivoBase, estado: 'PRIORIDAD' } as any;
      mockKanbanRepo.getObjetivoById.mockResolvedValue(priorityObjetivo);
      mockKanbanRepo.addBitacora.mockResolvedValue(undefined as any);
      await updateObjetivo(1, { estado: 'PRIORIDAD' }, 7);
      expect(mockKanbanRepo.getMinRank).not.toHaveBeenCalled();
    });

    it('should return the updated objetivo', async () => {
      const updated = { id: 1, titulo: 'new' } as any;
      mockKanbanRepo.updateObjetivo.mockResolvedValue(updated);
      const result = await updateObjetivo(1, { titulo: 'new' }, 7);
      expect(result).toBe(updated);
    });
  });

  describe('editObjetivoService', () => {
    it('should edit titulo when field is "titulo"', async () => {
      mockKanbanRepo.editTituloObjetivo.mockResolvedValue({ id: 1 } as any);
      const result = await editObjetivoService(1, 'titulo', 'Nuevo título', 7);
      expect(mockKanbanRepo.editTituloObjetivo).toHaveBeenCalledWith(1, 'Nuevo título', 7);
      expect(result).toEqual({ id: 1 });
    });

    it('should edit descripcion when field is "descripcion"', async () => {
      mockKanbanRepo.editDescripcionObjetivo.mockResolvedValue({ id: 1 } as any);
      const result = await editObjetivoService(1, 'descripcion', 'nueva desc', 7);
      expect(mockKanbanRepo.editDescripcionObjetivo).toHaveBeenCalledWith(1, 'nueva desc', 7);
      expect(result).toEqual({ id: 1 });
    });
  });

  describe('handleArchivosObjetivo', () => {
    it('should add archivos when action is "add"', async () => {
      mockKanbanRepo.addArchivoToObjetivo.mockResolvedValue(undefined as any);
      mockKanbanRepo.getObjetivoById.mockResolvedValue(objetivoBase);
      await handleArchivosObjetivo(1, [10, 20], 'add');
      expect(mockKanbanRepo.addArchivoToObjetivo).toHaveBeenCalledWith(1, [10, 20]);
    });

    it('should remove archivos when action is "remove"', async () => {
      mockKanbanRepo.removeArchivoFromObjetivo.mockResolvedValue(undefined as any);
      mockKanbanRepo.getObjetivoById.mockResolvedValue(objetivoBase);
      await handleArchivosObjetivo(1, [10], 'remove');
      expect(mockKanbanRepo.removeArchivoFromObjetivo).toHaveBeenCalledWith(1, [10]);
    });

    it('should return the updated objetivo after modification', async () => {
      const updated = { id: 1, archivos: [] } as any;
      mockKanbanRepo.addArchivoToObjetivo.mockResolvedValue(undefined as any);
      mockKanbanRepo.getObjetivoById.mockResolvedValue(updated);
      const result = await handleArchivosObjetivo(1, [5], 'add');
      expect(result).toBe(updated);
    });
  });

  describe('handleInvitadosObjetivo', () => {
    const invitadosAdd = [
      { user_id: 10, rol: 'ASSIGNEE' },
      { user_id: 20, rol: 'VISUALIZER' },
    ];

    it('should add invitados and write bitacora for new ASSIGNEE', async () => {
      mockKanbanRepo.getInvitadosByObjetivoId.mockResolvedValue([]);
      mockKanbanRepo.addInvitadosToObjetivo.mockResolvedValue(undefined as any);
      mockKanbanRepo.addAsignadosToBitacora.mockResolvedValue(undefined as any);
      mockKanbanRepo.getObjetivoById.mockResolvedValue(objetivoBase);

      await handleInvitadosObjetivo(7, 1, invitadosAdd, 'add');

      expect(mockKanbanRepo.addAsignadosToBitacora).toHaveBeenCalledWith(
        1,
        [10],
        7,
        'ASSIGN'
      );
    });

    it('should write DISCHARGE bitacora when ASSIGNEE is demoted to VISUALIZER', async () => {
      mockKanbanRepo.getInvitadosByObjetivoId.mockResolvedValue([
        { user_id: 20, rol: 'ASSIGNEE' },
      ] as any);
      mockKanbanRepo.addInvitadosToObjetivo.mockResolvedValue(undefined as any);
      mockKanbanRepo.addAsignadosToBitacora.mockResolvedValue(undefined as any);
      mockKanbanRepo.getObjetivoById.mockResolvedValue(objetivoBase);

      await handleInvitadosObjetivo(7, 1, [{ user_id: 20, rol: 'VISUALIZER' }], 'add');

      expect(mockKanbanRepo.addAsignadosToBitacora).toHaveBeenCalledWith(
        1,
        [20],
        7,
        'DISCHARGE'
      );
    });

    it('should remove invitados when action is "remove"', async () => {
      mockKanbanRepo.removeInvitadosFromObjetivo.mockResolvedValue(undefined as any);
      mockKanbanRepo.getObjetivoById.mockResolvedValue(objetivoBase);

      await handleInvitadosObjetivo(7, 1, [{ user_id: 10, rol: 'ASSIGNEE' }], 'remove');

      expect(mockKanbanRepo.removeInvitadosFromObjetivo).toHaveBeenCalledWith(
        1,
        [{ user_id: 10, rol: 'ASSIGNEE' }]
      );
    });

    it('should return the updated objetivo', async () => {
      const updated = { id: 1 } as any;
      mockKanbanRepo.getInvitadosByObjetivoId.mockResolvedValue([]);
      mockKanbanRepo.addInvitadosToObjetivo.mockResolvedValue(undefined as any);
      mockKanbanRepo.getObjetivoById.mockResolvedValue(updated);

      const result = await handleInvitadosObjetivo(7, 1, [], 'add');
      expect(result).toBe(updated);
    });
  });

  describe('deleteObjetivo', () => {
    it('should delegate to kanbanRepo.deleteObjetivo', async () => {
      mockKanbanRepo.deleteObjetivo.mockResolvedValue(undefined as any);
      await deleteObjetivo(1, 7);
      expect(mockKanbanRepo.deleteObjetivo).toHaveBeenCalledWith(1, 7);
    });
  });
});
