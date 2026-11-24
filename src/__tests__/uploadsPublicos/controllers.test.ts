jest.mock('../../domain/services/uploadsPublicosServices', () => ({
  ...jest.requireActual('../../domain/services/uploadsPublicosServices'),
  prepararSubidaCv: jest.fn(),
  confirmarCvPublico: jest.fn(),
}));

import * as service from '../../domain/services/uploadsPublicosServices';
import { BadRequestError, InternalServerError } from '../../adapters/errors/AppError';
import { createCvPublicoController, createCvUploadUrlController } from '../../controllers/web/uploadsPublicosController';
import { createMockReqRes } from '../helpers/testHelpers';

const mockService = jest.mocked(service);

const solicitud = { nombre: 'cv.pdf', contentType: 'application/pdf', size: 20 };

describe('uploadsPublicos controllers - createCvUploadUrlController', () => {
  beforeEach(() => jest.resetAllMocks());

  it('responde 201 con la URL firmada y el token', async () => {
    mockService.prepararSubidaCv.mockResolvedValue({ uploadUrl: 'https://r2/firmada', token: 'tok' });
    const { req, res, next } = createMockReqRes({ body: { ...solicitud, website: '' } });
    await createCvUploadUrlController(req, res, next);

    expect(mockService.prepararSubidaCv).toHaveBeenCalledWith(solicitud);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ uploadUrl: 'https://r2/firmada', token: 'tok' });
    expect(next).not.toHaveBeenCalled();
  });

  it('ignora id_carpeta y otros campos que mande el cliente', async () => {
    mockService.prepararSubidaCv.mockResolvedValue({ uploadUrl: 'u', token: 't' });
    const { req, res, next } = createMockReqRes({
      body: { ...solicitud, id_carpeta: '999', allowed_roles: ['ventas'], created_by: '1', key: 'cvs-web/otro.pdf' },
    });
    await createCvUploadUrlController(req, res, next);

    expect(mockService.prepararSubidaCv.mock.calls[0]).toEqual([solicitud]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('honeypot con contenido → 201 falso y no se firma nada', async () => {
    const { req, res, next } = createMockReqRes({ body: { ...solicitud, website: 'http://spam.example' } });
    await createCvUploadUrlController(req, res, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(mockService.prepararSubidaCv).not.toHaveBeenCalled();
  });

  it('propaga el 400 del service (formato o tamaño inválido)', async () => {
    mockService.prepararSubidaCv.mockRejectedValue(new BadRequestError('El archivo debe ser un PDF, DOC o DOCX.'));
    const { req, res, next } = createMockReqRes({ body: solicitud });
    await createCvUploadUrlController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('error inesperado (p. ej. R2) → 500 con mensaje genérico', async () => {
    mockService.prepararSubidaCv.mockRejectedValue(new Error('R2 caído'));
    const { req, res, next } = createMockReqRes({ body: solicitud });
    await createCvUploadUrlController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    expect(next.mock.calls[0][0].message).not.toContain('R2');
  });
});

describe('uploadsPublicos controllers - createCvPublicoController', () => {
  beforeEach(() => jest.resetAllMocks());

  it('con token válido responde 201 { ok: true } sin ids', async () => {
    mockService.confirmarCvPublico.mockResolvedValue(undefined);
    const { req, res, next } = createMockReqRes({ body: { token: 'tok', id_carpeta: '999' } });
    await createCvPublicoController(req, res, next);

    // El service solo recibe el token: no hay forma de pasarle carpeta/roles/dueño.
    expect(mockService.confirmarCvPublico.mock.calls[0]).toEqual(['tok']);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('propaga el 400 del service (token inválido o contenido no válido)', async () => {
    mockService.confirmarCvPublico.mockRejectedValue(new BadRequestError('La subida expiró o no es válida.'));
    const { req, res, next } = createMockReqRes({ body: {} });
    await createCvPublicoController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('carpeta inexistente → 500', async () => {
    mockService.confirmarCvPublico.mockRejectedValue(new InternalServerError('No pudimos recibir tu CV.'));
    const { req, res, next } = createMockReqRes({ body: { token: 'tok' } });
    await createCvPublicoController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
  });

  it('error inesperado (p. ej. R2) → 500 con mensaje genérico', async () => {
    mockService.confirmarCvPublico.mockRejectedValue(new Error('R2 caído'));
    const { req, res, next } = createMockReqRes({ body: { token: 'tok' } });
    await createCvPublicoController(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 500 }));
    expect(next.mock.calls[0][0].message).not.toContain('R2');
  });
});
