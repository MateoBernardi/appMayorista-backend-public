process.env.UPLOAD_TOKEN_SECRET = 'test-upload-secret';

jest.mock('../../adapters/archivos/archivosApi');
jest.mock('../../adapters/db/archivosRepo');
jest.mock('../../adapters/db/carpetasRepo');

import jwt from 'jsonwebtoken';
import * as archivosApi from '../../adapters/archivos/archivosApi';
import * as archivosRepo from '../../adapters/db/archivosRepo';
import * as carpetasRepo from '../../adapters/db/carpetasRepo';
import { ArchivoUso } from '../../domain/dto/ArchivoDTO';
import {
  CARPETA_CVS_WEB,
  confirmarCvPublico,
  detectarTipoCv,
  prepararSubidaCv,
} from '../../domain/services/uploadsPublicosServices';
import { signUploadToken } from '../../domain/validations/uploadTokens';

const mockApi = jest.mocked(archivosApi);
const mockArchivosRepo = jest.mocked(archivosRepo);
const mockCarpetasRepo = jest.mocked(carpetasRepo);

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(100, 0x20)]);
const DOC = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....[Content_Types].xml....word/document.xml')]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....fotos/foto1.png')]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const UUID = '0b6f3c1e-1234-4abc-8def-0123456789ab';

const solicitud = (over: Record<string, unknown> = {}) => ({
  nombre: 'mi cv.pdf',
  contentType: 'application/pdf',
  size: 1000,
  ...over,
});

const tokenCv = (ext = 'pdf') => signUploadToken({ tipo: 'cv', key: `cvs-web-pendientes/${UUID}.${ext}`, ext });

/** Simula un objeto pendiente en R2: HEAD devuelve su tamaño y los rangos se leen del buffer. */
const objetoEnR2 = (contenido: Buffer) => {
  mockApi.headFile.mockResolvedValue({ size: contenido.length });
  mockApi.readFileRange.mockImplementation(async (_key: string, range: string) => {
    const desdeFinal = /^bytes=-(\d+)$/.exec(range);
    if (desdeFinal) return contenido.subarray(Math.max(0, contenido.length - Number(desdeFinal[1])));
    const [, desde, hasta] = /^bytes=(\d+)-(\d+)$/.exec(range)!;
    return contenido.subarray(Number(desde), Number(hasta) + 1);
  });
};

describe('uploadsPublicos domain - prepararSubidaCv', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockApi.generateUploadUrl.mockResolvedValue('https://r2.example/firmada');
  });

  it('firma un PUT a pendientes con el tipo y tamaño declarados y devuelve un token', async () => {
    const res = await prepararSubidaCv(solicitud());

    expect(res.uploadUrl).toBe('https://r2.example/firmada');
    const [key, expiresIn, contentType, size] = mockApi.generateUploadUrl.mock.calls[0];
    expect(key).toMatch(/^cvs-web-pendientes\/[0-9a-f-]{36}\.pdf$/);
    expect(key).not.toContain('mi cv');
    expect(expiresIn).toBeGreaterThan(0);
    expect(contentType).toBe('application/pdf');
    expect(size).toBe(1000);

    const payload = jwt.decode(res.token) as Record<string, unknown>;
    expect(payload).toMatchObject({ tipo: 'cv', key, ext: 'pdf' });
  });

  it('acepta DOC/DOCX con application/octet-stream', async () => {
    await prepararSubidaCv(solicitud({ nombre: 'cv.DOCX', contentType: 'application/octet-stream' }));
    expect(mockApi.generateUploadUrl.mock.calls[0][0]).toMatch(/\.docx$/);
    expect(mockApi.generateUploadUrl.mock.calls[0][2]).toBe('application/octet-stream');
  });

  it('extensión no permitida → 400', async () => {
    await expect(prepararSubidaCv(solicitud({ nombre: 'cv.exe' }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(prepararSubidaCv(solicitud({ nombre: 'cv' }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(prepararSubidaCv(solicitud({ nombre: undefined }))).rejects.toMatchObject({ statusCode: 400 });
    expect(mockApi.generateUploadUrl).not.toHaveBeenCalled();
  });

  it('mimetype fuera de la allowlist → 400', async () => {
    await expect(
      prepararSubidaCv(solicitud({ contentType: 'application/x-msdownload' })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(prepararSubidaCv(solicitud({ contentType: undefined }))).rejects.toMatchObject({ statusCode: 400 });
  });

  it('tamaño vacío, inválido o de más de 5 MB → 400', async () => {
    await expect(prepararSubidaCv(solicitud({ size: 0 }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(prepararSubidaCv(solicitud({ size: '1000' }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(prepararSubidaCv(solicitud({ size: 1.5 }))).rejects.toMatchObject({ statusCode: 400 });
    await expect(prepararSubidaCv(solicitud({ size: 5 * 1024 * 1024 + 1 }))).rejects.toMatchObject({
      statusCode: 400,
      message: 'El archivo no puede superar los 5 MB.',
    });
    expect(mockApi.generateUploadUrl).not.toHaveBeenCalled();
  });
});

describe('uploadsPublicos domain - confirmarCvPublico', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockCarpetasRepo.getCarpetaByNombreRaiz.mockResolvedValue({ id: 42, id_usuario: 7 });
    mockCarpetasRepo.getCarpetaAclData.mockResolvedValue({
      id: 42,
      owner_id: 7,
      allowed_roles: ['gerencia', 'personasRelaciones'],
      allowed_users: [],
      allowed_user_names: [],
    });
    mockArchivosRepo.existsArchivoByRutaR2.mockResolvedValue(false);
    mockArchivosRepo.createArchivo.mockResolvedValue({ id: 1 } as any);
    mockApi.copyFile.mockResolvedValue(undefined);
    mockApi.deleteFile.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('PDF válido: lo mueve a cvs-web/, borra el pendiente y crea el archivo en la carpeta de CVs', async () => {
    objetoEnR2(PDF);
    await confirmarCvPublico(tokenCv());

    const pendiente = `cvs-web-pendientes/${UUID}.pdf`;
    const definitiva = `cvs-web/${UUID}.pdf`;
    expect(mockCarpetasRepo.getCarpetaByNombreRaiz).toHaveBeenCalledWith(CARPETA_CVS_WEB);
    expect(mockApi.copyFile).toHaveBeenCalledWith(pendiente, definitiva, 'application/pdf');
    expect(mockApi.deleteFile).toHaveBeenCalledWith(pendiente);

    expect(mockArchivosRepo.createArchivo).toHaveBeenCalledTimes(1);
    const dto = mockArchivosRepo.createArchivo.mock.calls[0][0];
    expect(dto).toEqual(expect.objectContaining({
      ruta_r2: definitiva,
      id_carpeta: 42,
      created_by: 7,
      allowed_roles: ['gerencia', 'personasRelaciones'],
      uso: ArchivoUso.EMPRESA,
      tipo: 'application/pdf',
      tamaño: PDF.length,
    }));
    expect(dto.nombre).toMatch(/^CV_\d{8}-\d{6}_0b6f3c1e\.pdf$/);
    expect(dto.titulo).toMatch(/^CV recibido \d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });

  it('DOC y DOCX: usa el contentType detectado; para DOCX lee el final del archivo', async () => {
    objetoEnR2(DOC);
    await confirmarCvPublico(tokenCv('doc'));
    expect(mockApi.copyFile.mock.calls[0][2]).toBe('application/msword');

    objetoEnR2(DOCX);
    await confirmarCvPublico(tokenCv('docx'));
    expect(mockApi.copyFile.mock.calls[1][2]).toBe(MIME_DOCX);
    expect(mockApi.readFileRange).toHaveBeenCalledWith(`cvs-web-pendientes/${UUID}.docx`, expect.stringMatching(/^bytes=-\d+$/));
  });

  it('nunca baja el archivo entero: solo lee rangos', async () => {
    objetoEnR2(PDF);
    await confirmarCvPublico(tokenCv());
    for (const [, range] of mockApi.readFileRange.mock.calls) {
      expect(range).toMatch(/^bytes=(\d+-\d+|-\d+)$/);
    }
  });

  it.each([
    ['extensión que no coincide con los magic bytes', PDF, 'docx'],
    ['.exe renombrado a .pdf', EXE, 'pdf'],
    ['un .zip cualquiera renombrado a .docx', ZIP, 'docx'],
  ])('%s → 400 y borra el pendiente', async (_caso, contenido, ext) => {
    objetoEnR2(contenido);
    await expect(confirmarCvPublico(tokenCv(ext))).rejects.toMatchObject({ statusCode: 400 });
    expect(mockApi.deleteFile).toHaveBeenCalledWith(`cvs-web-pendientes/${UUID}.${ext}`);
    expect(mockApi.copyFile).not.toHaveBeenCalled();
    expect(mockArchivosRepo.createArchivo).not.toHaveBeenCalled();
  });

  it('objeto de más de 5 MB (el cliente no respetó lo firmado) → 400 y lo borra', async () => {
    mockApi.headFile.mockResolvedValue({ size: 5 * 1024 * 1024 + 1 });
    await expect(confirmarCvPublico(tokenCv())).rejects.toMatchObject({ statusCode: 400 });
    expect(mockApi.deleteFile).toHaveBeenCalled();
    expect(mockApi.readFileRange).not.toHaveBeenCalled();
    expect(mockArchivosRepo.createArchivo).not.toHaveBeenCalled();
  });

  it('el archivo nunca se subió → 400', async () => {
    mockApi.headFile.mockResolvedValue(null);
    await expect(confirmarCvPublico(tokenCv())).rejects.toMatchObject({ statusCode: 400 });
    expect(mockArchivosRepo.createArchivo).not.toHaveBeenCalled();
  });

  it('token inválido, de otro tipo o vencido → 400 sin tocar R2', async () => {
    await expect(confirmarCvPublico(undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(confirmarCvPublico('basura')).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      confirmarCvPublico(signUploadToken({ tipo: 'video', key: 'site-media/x.mp4', contentType: 'video/mp4' })),
    ).rejects.toMatchObject({ statusCode: 400 });
    const vencido = jwt.sign(
      { tipo: 'cv', key: `cvs-web-pendientes/${UUID}.pdf`, ext: 'pdf', exp: Math.floor(Date.now() / 1000) - 10 },
      'test-upload-secret',
      { audience: 'upload' },
    );
    await expect(confirmarCvPublico(vencido)).rejects.toMatchObject({ statusCode: 400 });
    const otroSecret = jwt.sign({ tipo: 'cv', key: `cvs-web-pendientes/${UUID}.pdf`, ext: 'pdf' }, 'otro', { audience: 'upload' });
    await expect(confirmarCvPublico(otroSecret)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockApi.headFile).not.toHaveBeenCalled();
  });

  it('confirmar dos veces el mismo token no duplica el registro', async () => {
    mockArchivosRepo.existsArchivoByRutaR2.mockResolvedValue(true);
    await confirmarCvPublico(tokenCv());
    expect(mockArchivosRepo.existsArchivoByRutaR2).toHaveBeenCalledWith(`cvs-web/${UUID}.pdf`);
    expect(mockApi.headFile).not.toHaveBeenCalled();
    expect(mockArchivosRepo.createArchivo).not.toHaveBeenCalled();
  });

  it('si no existe la carpeta "CVs Página Web" → 500 y no registra nada', async () => {
    objetoEnR2(PDF);
    mockCarpetasRepo.getCarpetaByNombreRaiz.mockResolvedValue(null);
    await expect(confirmarCvPublico(tokenCv())).rejects.toMatchObject({ statusCode: 500 });
    expect(console.error).toHaveBeenCalled();
    expect(mockApi.copyFile).not.toHaveBeenCalled();
    expect(mockArchivosRepo.createArchivo).not.toHaveBeenCalled();
  });

  it('si falla el alta en DB propaga el error y deja el pendiente para reintentar', async () => {
    objetoEnR2(PDF);
    mockArchivosRepo.createArchivo.mockRejectedValue(new Error('db caída'));
    await expect(confirmarCvPublico(tokenCv())).rejects.toThrow('db caída');
    expect(mockApi.deleteFile).not.toHaveBeenCalled();
  });

  it('si falla el borrado del pendiente después de registrar, no falla la confirmación', async () => {
    objetoEnR2(PDF);
    mockApi.deleteFile.mockRejectedValue(new Error('R2 caído'));
    await expect(confirmarCvPublico(tokenCv())).resolves.toBeUndefined();
    expect(mockArchivosRepo.createArchivo).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('uploadsPublicos domain - detectarTipoCv', () => {
  it('detecta por magic bytes', () => {
    expect(detectarTipoCv(PDF)).toBe('pdf');
    expect(detectarTipoCv(DOC)).toBe('doc');
    expect(detectarTipoCv(DOCX)).toBe('docx');
    expect(detectarTipoCv(ZIP)).toBeNull();
    expect(detectarTipoCv(EXE)).toBeNull();
    expect(detectarTipoCv(Buffer.alloc(0))).toBeNull();
  });

  it('DOCX: busca "word/" en el final del archivo (directorio central del ZIP)', () => {
    const inicio = DOCX.subarray(0, 8);
    expect(detectarTipoCv(inicio, Buffer.from('central dir: word/document.xml'))).toBe('docx');
    expect(detectarTipoCv(inicio, Buffer.from('central dir: xl/workbook.xml'))).toBeNull();
  });
});
