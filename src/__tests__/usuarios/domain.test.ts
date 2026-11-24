/**
 * Tests de dominio: usuariosServices
 * Capa: Domain Service
 * Plataforma: Transversal
 *
 * Fidelidad: cada test refleja el comportamiento exacto del código de producción.
 */

jest.mock('../../adapters/db/usuariosRepo');
jest.mock('../../adapters/db/rolesRepo');
jest.mock('../../adapters/db/personalRepo');
jest.mock('../../domain/validations/usuariosValidations');
jest.mock('../../domain/services/authServices');
jest.mock('argon2');

import * as usuariosRepo from '../../adapters/db/usuariosRepo';
import * as usuariosValidations from '../../domain/validations/usuariosValidations';
import * as authServices from '../../domain/services/authServices';
import * as personalRepo from '../../adapters/db/personalRepo';
import argon2 from 'argon2';
import {
  createNewUser,
  validateUserCredentials,
  updatePassword,
  getUserById,
  getUsers,
  updateUserData,
  updateUserRoleService,
  searchUsuariosByNombreApellido,
  searchUsuariosByRole,
  changePasswordService,
  bajaUsuarioService,
} from '../../domain/services/usuariosServices';

const mockRepo = jest.mocked(usuariosRepo);
const mockValidations = jest.mocked(usuariosValidations);
const mockArgon2 = jest.mocked(argon2);
const mockAuthServices = jest.mocked(authServices);
const mockPersonalRepo = jest.mocked(personalRepo);

describe('UsuariosServices', () => {
  beforeEach(() => jest.clearAllMocks());

  // ──────────── createNewUser ────────────

  describe('createNewUser', () => {
    it('debería crear usuario con password hasheado y pasar el hash a createUser', async () => {
      // prepareUserForCreation llama a validateNewUser pero NO usa su retorno (línea 29 del código fuente)
      mockValidations.validateNewUser.mockResolvedValue(undefined as any);
      mockArgon2.hash.mockResolvedValue('$argon2id$hashed' as any);
      mockRepo.createUser.mockResolvedValue({ id: 1, username: 'jdoe' } as any);

      const result = await createNewUser({
        username: 'jdoe', email: 'j@d.com', password: 'plaintext', nombre: 'John', apellido: 'Doe',
      });

      // Verificar que el hash se generó a partir del password original
      expect(mockArgon2.hash).toHaveBeenCalledWith('plaintext', expect.objectContaining({ type: argon2.argon2id }));
      // Verificar que createUser recibió el password hasheado, NO el plaintext
      expect(mockRepo.createUser).toHaveBeenCalledWith(expect.objectContaining({
        username: 'jdoe',
        email: 'j@d.com',
        password: '$argon2id$hashed',
        nombre: 'John',
        apellido: 'Doe',
      }));
      expect(result).toEqual({ id: 1, username: 'jdoe' });
    });

    it('debería lanzar error si faltan campos obligatorios', async () => {
      // prepareUserForCreation hace: if (!username || !email || !password || !nombre || !apellido)
      await expect(createNewUser({ username: '', email: '', password: '', nombre: '', apellido: '' }))
        .rejects.toThrow('Username, email, password, nombre y apellido son requeridos');
    });

    it('debería propagar error de validateNewUser', async () => {
      mockValidations.validateNewUser.mockRejectedValue(new Error('Username ya existe'));
      await expect(createNewUser({
        username: 'dupe', email: 'e@e.com', password: 'pass', nombre: 'A', apellido: 'B',
      })).rejects.toThrow('Username ya existe');
    });
  });

  // ──────────── validateUserCredentials ────────────

  describe('validateUserCredentials', () => {
    it('debería buscar por username si el identificador NO contiene @', async () => {
      mockRepo.findUserByUsername.mockResolvedValue(null);
      const result = await validateUserCredentials('unknown', 'pass');
      expect(mockRepo.findUserByUsername).toHaveBeenCalledWith('unknown');
      expect(mockRepo.findUserByEmail).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('debería buscar por email si el identificador contiene @', async () => {
      mockRepo.findUserByEmail.mockResolvedValue({ id: 1, password: 'hash' } as any);
      mockArgon2.verify.mockResolvedValue(true);
      await validateUserCredentials('test@example.com', 'pass');
      expect(mockRepo.findUserByEmail).toHaveBeenCalledWith('test@example.com');
      expect(mockRepo.findUserByUsername).not.toHaveBeenCalled();
    });

    it('debería retornar null si la contraseña no coincide (argon2.verify=false)', async () => {
      mockRepo.findUserByUsername.mockResolvedValue({ id: 1, password: '$argon2hash' } as any);
      mockArgon2.verify.mockResolvedValue(false);
      const result = await validateUserCredentials('jdoe', 'wrongpass');
      // Producción: argon2.verify(user.password, password)
      expect(mockArgon2.verify).toHaveBeenCalledWith('$argon2hash', 'wrongpass');
      expect(result).toBeNull();
    });

    /**
     * OWASP API03:2023 – El resultado no debe contener el campo password
     */
    it('debería retornar usuario sin password con credenciales válidas', async () => {
      mockRepo.findUserByUsername.mockResolvedValue({
        id: 1, username: 'jdoe', password: 'hash', email: 'j@d.com',
      } as any);
      mockArgon2.verify.mockResolvedValue(true);

      const result = await validateUserCredentials('jdoe', 'correctpass');

      // Producción: const { password: _, ...userWithoutPassword } = user;
      expect(result).not.toHaveProperty('password');
      expect(result).toEqual({ id: 1, username: 'jdoe', email: 'j@d.com' });
    });
  });

  // ──────────── getUserById ────────────

  describe('getUserById', () => {
    it('debería retornar el usuario si existe', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1, username: 'jdoe' } as any);
      const result = await getUserById(1);
      expect(mockRepo.findUserById).toHaveBeenCalledWith(1);
      expect(result).toEqual({ id: 1, username: 'jdoe' });
    });

    it('debería lanzar error si userId es falsy (0)', async () => {
      // Producción: if (!userId) throw
      await expect(getUserById(0)).rejects.toThrow('ID de usuario es requerido');
    });

    it('debería lanzar error si el usuario no existe', async () => {
      mockRepo.findUserById.mockResolvedValue(null);
      await expect(getUserById(999)).rejects.toThrow('Usuario no encontrado');
    });
  });

  // ──────────── updatePassword ────────────

  describe('updatePassword', () => {
    it('debería lanzar error si userId o newPassword son falsy', async () => {
      // Producción: if (!userId || !newPassword) throw
      await expect(updatePassword(0, 'old', 'newpass123')).rejects.toThrow('requeridos');
    });

    it('debería lanzar error si el usuario no existe', async () => {
      mockRepo.findUserById.mockResolvedValue(null);
      await expect(updatePassword(1, 'old', 'newpass123')).rejects.toThrow('Usuario no encontrado');
    });

    it('debería lanzar error si la contraseña antigua es incorrecta', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1, password: '$argon2hash' } as any);
      mockArgon2.verify.mockResolvedValue(false);
      await expect(updatePassword(1, 'wrongold', 'newpass123')).rejects.toThrow('Contraseña antigua incorrecta');
      // Producción: argon2.verify(existingUserWithPassword.password, oldPassword)
      expect(mockArgon2.verify).toHaveBeenCalledWith('$argon2hash', 'wrongold');
    });

    it('debería lanzar error si la nueva contraseña tiene menos de 8 caracteres', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1, password: 'hash' } as any);
      mockArgon2.verify.mockResolvedValue(true);
      await expect(updatePassword(1, 'correctold', 'short')).rejects.toThrow('al menos 8 caracteres');
    });

    it('debería hashear nueva contraseña y actualizar en BD', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1, password: 'oldhash' } as any);
      mockArgon2.verify.mockResolvedValue(true);
      mockArgon2.hash.mockResolvedValue('$argon2id$newhash' as any);
      mockRepo.updateUserPassword.mockResolvedValue(true);

      const result = await updatePassword(1, 'correctold', 'newpassword123');

      expect(mockArgon2.hash).toHaveBeenCalledWith('newpassword123', expect.objectContaining({ type: argon2.argon2id }));
      expect(mockRepo.updateUserPassword).toHaveBeenCalledWith(1, '$argon2id$newhash');
      expect(result).toBe(true);
    });
  });

  // ──────────── updateUserData ────────────

  describe('updateUserData', () => {
    it('debería lanzar error si userId es falsy', async () => {
      await expect(updateUserData(0, { username: 'new' })).rejects.toThrow('ID de usuario es requerido');
    });

    it('debería lanzar error si no se proporciona ningún campo', async () => {
      await expect(updateUserData(1, {})).rejects.toThrow('Al menos un campo debe ser proporcionado');
    });

    it('debería lanzar error si el usuario no existe', async () => {
      mockRepo.findUserById.mockResolvedValue(null);
      await expect(updateUserData(1, { username: 'new' })).rejects.toThrow('Usuario no encontrado');
    });

    it('debería lanzar error si el username ya existe en otro usuario', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1, username: 'old' } as any);
      mockRepo.findUserByUsername.mockResolvedValue({ id: 2, username: 'taken' } as any);
      await expect(updateUserData(1, { username: 'taken' })).rejects.toThrow('Ya existe un usuario con ese username');
    });

    it('NO debería verificar duplicado si el username es el mismo del usuario existente', async () => {
      // Producción: if (userData.username && userData.username !== existingUser.username)
      mockRepo.findUserById.mockResolvedValue({ id: 1, username: 'same', email: 'a@b.com' } as any);
      mockRepo.updateUser.mockResolvedValue({ id: 1, username: 'same' } as any);

      await updateUserData(1, { username: 'same' });
      expect(mockRepo.findUserByUsername).not.toHaveBeenCalled();
    });

    it('debería lanzar error si el email ya existe en otro usuario', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1, username: 'old', email: 'old@t.com' } as any);
      mockRepo.findUserByEmail.mockResolvedValue({ id: 2 } as any);
      await expect(updateUserData(1, { email: 'taken@t.com' })).rejects.toThrow('Ya existe un usuario con ese email');
    });

    it('debería actualizar exitosamente y retornar usuario actualizado', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1, username: 'old', email: 'old@t.com' } as any);
      mockRepo.findUserByUsername.mockResolvedValue(null);
      mockRepo.updateUser.mockResolvedValue({ id: 1, username: 'newname' } as any);

      const result = await updateUserData(1, { username: 'newname' });
      expect(mockRepo.updateUser).toHaveBeenCalledWith(1, { username: 'newname' });
      expect(result).toEqual({ id: 1, username: 'newname' });
    });
  });

  // ──────────── updateUserRoleService ────────────

  describe('updateUserRoleService', () => {
    it('debería lanzar error si userId o newRoleId son falsy', async () => {
      // Producción: if (!userId || !newRoleId)
      await expect(updateUserRoleService(0, 1)).rejects.toThrow('Usuario o rol desconocido');
      await expect(updateUserRoleService(1, 0)).rejects.toThrow('Usuario o rol desconocido');
    });

    it('debería lanzar error si el usuario no existe (usa getUsuarioEntidadByContextId)', async () => {
      // Producción usa getUsuarioEntidadByContextId, NO findUserById
      mockRepo.getUsuarioEntidadByContextId.mockResolvedValue(null);
      await expect(updateUserRoleService(99, 2)).rejects.toThrow('Usuario no encontrado');
      expect(mockRepo.getUsuarioEntidadByContextId).toHaveBeenCalledWith(99);
    });

    it('debería actualizar rol exitosamente', async () => {
      mockRepo.getUsuarioEntidadByContextId.mockResolvedValue({ id: 1 } as any);
      mockRepo.updateUserRole.mockResolvedValue(true);

      const result = await updateUserRoleService(5, 3);
      expect(mockRepo.updateUserRole).toHaveBeenCalledWith(5, 3);
      expect(result).toBe(true);
    });
  });

  // ──────────── searchUsuariosByNombreApellido ────────────

  describe('searchUsuariosByNombreApellido', () => {
    it('debería lanzar error con término vacío o solo espacios', async () => {
      // Producción: if (!searchTerm || searchTerm.trim().length === 0)
      await expect(searchUsuariosByNombreApellido('')).rejects.toThrow('requerido');
      await expect(searchUsuariosByNombreApellido('   ')).rejects.toThrow('requerido');
    });

    it('debería trimear el término de búsqueda antes de enviar al repo', async () => {
      mockRepo.getUsuarioEntidadByNombreApellido.mockResolvedValue([]);
      await searchUsuariosByNombreApellido('  john  ');
      expect(mockRepo.getUsuarioEntidadByNombreApellido).toHaveBeenCalledWith('john');
    });
  });

  // ──────────── searchUsuariosByRole ────────────

  describe('searchUsuariosByRole', () => {
    it('debería lanzar error con roleName vacío', async () => {
      await expect(searchUsuariosByRole('')).rejects.toThrow('El nombre del rol es requerido');
    });

    it('debería trimear el roleName y delegar a getUsuariosByRole', async () => {
      mockRepo.getUsuariosByRole.mockResolvedValue([{ id: 1 }] as any);
      const result = await searchUsuariosByRole('  admin  ');
      expect(mockRepo.getUsuariosByRole).toHaveBeenCalledWith('admin');
      expect(result).toEqual([{ id: 1 }]);
    });
  });

  // ──────────── changePasswordService ────────────

  describe('changePasswordService', () => {
    it('debería lanzar error si userId o newPassword son falsy', async () => {
      // Producción: if (!userId || !newPassword)
      await expect(changePasswordService(0, 'longpassword')).rejects.toThrow('requeridos');
      await expect(changePasswordService(1, '')).rejects.toThrow('requeridos');
    });

    it('debería lanzar error si la contraseña tiene menos de 8 caracteres', async () => {
      await expect(changePasswordService(1, 'short')).rejects.toThrow('al menos 8 caracteres');
    });

    it('debería lanzar error si el usuario no existe', async () => {
      mockRepo.findUserById.mockResolvedValue(null);
      await expect(changePasswordService(1, 'longpassword123')).rejects.toThrow('Usuario no encontrado');
    });

    it('debería hashear y actualizar contraseña exitosamente', async () => {
      mockRepo.findUserById.mockResolvedValue({ id: 1 } as any);
      mockArgon2.hash.mockResolvedValue('$newhash' as any);
      mockRepo.updateUserPassword.mockResolvedValue(true);

      const result = await changePasswordService(1, 'securepass123');
      expect(mockArgon2.hash).toHaveBeenCalledWith('securepass123', expect.objectContaining({ type: argon2.argon2id }));
      expect(mockRepo.updateUserPassword).toHaveBeenCalledWith(1, '$newhash');
      expect(result).toBe(true);
    });
  });

  // ──────────── bajaUsuarioService ────────────

  describe('bajaUsuarioService', () => {
    it('debería lanzar error si el contexto ejecutor no es gerencia', async () => {
      mockRepo.getUsuarioEntidadByContextId.mockResolvedValue({
        user_context_id: 10,
        rol_nombre: 'empleado',
      } as any);

      await expect(bajaUsuarioService(5, 10)).rejects.toThrow('No autorizado.');
      expect(mockRepo.bajaUsuarioAtomica).not.toHaveBeenCalled();
    });

    it('debería lanzar error si el usuario no existe', async () => {
      mockRepo.getUsuarioEntidadByContextId.mockResolvedValue({
        user_context_id: 10,
        id_usuario: 99,
        rol_nombre: 'gerencia',
      } as any);
      mockRepo.bajaUsuarioAtomica.mockRejectedValue(new Error('Usuario no encontrado'));
      await expect(bajaUsuarioService(999, 10)).rejects.toThrow('Usuario no encontrado');
    });

    it('debería impedir que gerencia se dé de baja a sí mismo', async () => {
      mockRepo.getUsuarioEntidadByContextId.mockResolvedValue({
        user_context_id: 10,
        id_usuario: 5,
        rol_nombre: 'gerencia',
      } as any);

      await expect(bajaUsuarioService(5, 10)).rejects.toThrow('Acción no válida.');
      expect(mockRepo.bajaUsuarioAtomica).not.toHaveBeenCalled();
    });

    it('debería ejecutar la baja atómica y devolver el resumen', async () => {
      mockRepo.getUsuarioEntidadByContextId.mockResolvedValue({
        user_context_id: 10,
        id_usuario: 77,
        rol_nombre: 'gerencia',
      } as any);
      mockRepo.bajaUsuarioAtomica.mockResolvedValue({
        username: 'target',
        personalDesactivado: true,
        usuarioDesactivado: true,
      });

      const result = await bajaUsuarioService(5, 10);

      expect(mockRepo.bajaUsuarioAtomica).toHaveBeenCalledWith(5);

      expect(result).toEqual({
        message: 'Usuario target dado de baja exitosamente',
        detalles: {
          tokenRevocados: true,
          personalDesactivado: true,
          usuarioDesactivado: true,
        },
      });
    });

    it('personalDesactivado debe ser false si no hay entidades interno/mayorista', async () => {
      mockRepo.getUsuarioEntidadByContextId.mockResolvedValue({
        user_context_id: 10,
        id_usuario: 88,
        rol_nombre: 'gerencia',
      } as any);
      mockRepo.bajaUsuarioAtomica.mockResolvedValue({
        username: 'webonly',
        personalDesactivado: false,
        usuarioDesactivado: true,
      });

      const result = await bajaUsuarioService(5, 10);

      expect(result.detalles.personalDesactivado).toBe(false);
    });
  });
});
