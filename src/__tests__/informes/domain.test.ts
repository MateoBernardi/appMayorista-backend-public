jest.mock('../../adapters/db/informesRepo');
jest.mock('../../adapters/archivos/archivosApi');

import * as repo from '../../adapters/db/informesRepo';
import * as archivos from '../../adapters/archivos/archivosApi';
import {
  agregarAdjunto,
  agregarEntradaInforme,
  crearInforme,
  editarEntrada,
  listarInformes,
  obtenerInforme,
  urlAdjunto,
} from '../../domain/services/informesServices';
import { EntradaFilaDTO } from '../../domain/dto/InformeDTO';

const mockRepo = jest.mocked(repo);
const mockArchivos = jest.mocked(archivos);
const IID = '01a0f3ef-d223-766e-8de8-02948ea77c09';

const fila = (over: Partial<EntradaFilaDTO> = {}): EntradaFilaDTO => ({
  id: '1',
  informe_id: IID,
  tipo: 'relato',
  autor_id: 1,
  menciones: [],
  creado_en: new Date('2026-01-01T00:00:00Z'),
  editado_en: null,
  cuerpo: '<p>hola</p>',
  ...over,
});

const archivo = (over: Record<string, unknown> = {}) => ({
  originalname: 'foto.png',
  mimetype: 'image/png',
  size: 10,
  buffer: Buffer.from('x'),
  ...over,
});

describe('crearInforme', () => {
  beforeEach(() => jest.resetAllMocks());

  it('sanitiza, calcula menciones desde el HTML e inserta el relato', async () => {
    mockRepo.getUsuariosExistentes.mockResolvedValue([2]);
    mockRepo.insertRelato.mockResolvedValue(fila({ menciones: [2] }));

    const r = await crearInforme(1, '<p onclick="x()">hola <span data-mention="2">Ana</span></p><script>x</script>');

    const [informeId, autor, cuerpo, menciones] = mockRepo.insertRelato.mock.calls[0]!;
    expect(informeId).toMatch(/^[0-9a-f-]{36}$/);
    expect([autor, cuerpo, menciones]).toEqual([1, '<p>hola <span data-mention="2">Ana</span></p>', [2]]);
    expect(r.entrada.adjuntos).toEqual([]);
  });

  it('422 si una mención no existe', async () => {
    mockRepo.getUsuariosExistentes.mockResolvedValue([]);
    await expect(crearInforme(1, '<p><span data-mention="999">x</span></p>')).rejects.toMatchObject({
      statusCode: 422,
    });
    expect(mockRepo.insertRelato).not.toHaveBeenCalled();
  });

  it('422 si el id excede el rango de integer', async () => {
    await expect(
      crearInforme(1, '<p><span data-mention="99999999999">x</span></p>'),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('400 si el texto está vacío, es muy largo o el HTML supera el límite', async () => {
    await expect(crearInforme(1, '<p> </p>')).rejects.toMatchObject({ statusCode: 400 });
    await expect(crearInforme(1, `<p>${'a'.repeat(1001)}</p>`)).rejects.toMatchObject({ statusCode: 400 });
    await expect(crearInforme(1, `<p>${' '.repeat(10001)}</p>`)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('agregarEntradaInforme', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockRepo.getUsuariosExistentes.mockResolvedValue([]);
  });

  it.each([
    ['no_existe', 404],
  ] as const)('traduce %s a %i', async (status, code) => {
    mockRepo.agregarEntrada.mockResolvedValue({ status } as any);
    await expect(agregarEntradaInforme(IID, 1, '<p>x</p>')).rejects.toMatchObject({
      statusCode: code,
    });
  });

  it('pasa al repo el acceso de gerencia', async () => {
    mockRepo.agregarEntrada.mockResolvedValue({ status: 'ok', entrada: fila() });
    await agregarEntradaInforme(IID, 1, '<p>x</p>', true);
    expect(mockRepo.agregarEntrada).toHaveBeenCalledWith(IID, 1, '<p>x</p>', [], true);
  });

  it('el texto es obligatorio', async () => {
    await expect(agregarEntradaInforme(IID, 1, undefined)).rejects.toMatchObject({ statusCode: 400 });
    expect(mockRepo.agregarEntrada).not.toHaveBeenCalled();
  });

  it('acepta una entrada que es solo un adjunto en línea', async () => {
    mockRepo.agregarEntrada.mockResolvedValue({ status: 'ok', entrada: fila() });
    await agregarEntradaInforme(IID, 1, '<div data-adjunto="0"></div>');
    expect(mockRepo.agregarEntrada).toHaveBeenCalledWith(IID, 1, '<div data-adjunto="0"></div>', [], false);
    await expect(agregarEntradaInforme(IID, 1, '<p></p>')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('400 con id inválido', async () => {
    await expect(agregarEntradaInforme('x', 1, '<p>x</p>')).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('editarEntrada', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockRepo.getUsuariosExistentes.mockResolvedValue([]);
  });

  it('recalcula menciones y devuelve la entrada con adjuntos', async () => {
    mockRepo.getUsuariosExistentes.mockResolvedValue([3]);
    mockRepo.editarEntrada.mockResolvedValue({ status: 'ok', entrada: fila() });
    mockRepo.getAdjuntosDeEntrada.mockResolvedValue([]);

    await editarEntrada(IID, 1, 1, '<p><span data-mention="3">B</span></p>');

    expect(mockRepo.editarEntrada).toHaveBeenCalledWith(
      IID, 1, 1, '<p><span data-mention="3">B</span></p>', [3],
    );
  });

  it.each([
    ['no_existe', 404],
    ['no_autor', 403],
  ] as const)('traduce %s a %i', async (status, code) => {
    mockRepo.editarEntrada.mockResolvedValue({ status } as any);
    await expect(editarEntrada(IID, 1, 2, '<p>x</p>')).rejects.toMatchObject({ statusCode: code });
  });
});

describe('agregarAdjunto', () => {
  beforeEach(() => jest.resetAllMocks());

  it('400 sin archivo, con mime no permitido o muy grande', async () => {
    await expect(agregarAdjunto(IID, 1, 1, undefined)).rejects.toMatchObject({ statusCode: 400 });
    await expect(agregarAdjunto(IID, 1, 1, archivo({ mimetype: 'application/x-sh' }))).rejects.toMatchObject({
      statusCode: 400,
    });
    await expect(agregarAdjunto(IID, 1, 1, archivo({ size: 51 * 1024 * 1024 }))).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockArchivos.uploadFiles).not.toHaveBeenCalled();
  });

  it('no sube nada si la persona no puede escribir en la entrada', async () => {
    mockRepo.verificarEscrituraEntrada.mockResolvedValue({ status: 'no_autor' });
    await expect(agregarAdjunto(IID, 1, 1, archivo())).rejects.toMatchObject({ statusCode: 403 });
    expect(mockArchivos.uploadFiles).not.toHaveBeenCalled();
  });

  it('sube a R2 con la key del informe y usa el nombre del cliente', async () => {
    mockRepo.verificarEscrituraEntrada.mockResolvedValue({ status: 'ok' });
    mockRepo.insertAdjunto.mockResolvedValue({ status: 'ok', adjunto: { id: '7' } as any });

    await agregarAdjunto(IID, 4, 1, archivo(), 'mi foto.png');

    expect(mockArchivos.uploadFiles.mock.calls[0]![0]).toMatch(
      new RegExp(`^informes/${IID}/4/\\d+-mi_foto\\.png$`),
    );
    expect(mockRepo.insertAdjunto.mock.calls[0]![3]).toMatchObject({ tipo: 'imagen', nombre: 'mi foto.png' });
  });
});

describe('agregarAdjunto con orden', () => {
  beforeEach(() => jest.resetAllMocks());

  it('pasa el orden pedido y rechaza uno inválido o repetido', async () => {
    mockRepo.verificarEscrituraEntrada.mockResolvedValue({ status: 'ok' });
    mockRepo.getAdjuntosDeEntrada.mockResolvedValue([{ orden: 3 } as any]);
    mockRepo.insertAdjunto.mockResolvedValue({ status: 'ok', adjunto: { id: '7' } as any });

    await expect(agregarAdjunto(IID, 4, 1, archivo(), undefined, '-1')).rejects.toMatchObject({ statusCode: 400 });
    await expect(agregarAdjunto(IID, 4, 1, archivo(), undefined, '3')).rejects.toMatchObject({ statusCode: 409 });
    expect(mockArchivos.uploadFiles).not.toHaveBeenCalled();

    await agregarAdjunto(IID, 4, 1, archivo(), undefined, '4');
    expect(mockRepo.insertAdjunto.mock.calls[0]![3]).toMatchObject({ orden: 4 });
  });
});

describe('urlAdjunto', () => {
  beforeEach(() => jest.resetAllMocks());

  it('404 si no es visible', async () => {
    mockRepo.getAdjuntoVisible.mockResolvedValue(null);
    await expect(urlAdjunto(IID, 1, 1)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('firma por 900 s', async () => {
    mockRepo.getAdjuntoVisible.mockResolvedValue({ r2_key: 'k', nombre: 'n', mime: 'image/png' });
    mockArchivos.generateSignedUrl.mockResolvedValue('https://u');
    expect(await urlAdjunto(IID, 1, 1)).toEqual({ url: 'https://u', expira_en: 900 });
    expect(mockArchivos.generateSignedUrl).toHaveBeenCalledWith('k', 900, 'n', 'image/png');
  });
});

describe('obtenerInforme / listarInformes', () => {
  beforeEach(() => jest.resetAllMocks());

  it('404 si la DB no devuelve entradas visibles', async () => {
    mockRepo.getConversacion.mockResolvedValue([]);
    await expect(obtenerInforme(IID, 9)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('arma el hilo con adjuntos por entrada y personas', async () => {
    mockRepo.getConversacion.mockResolvedValue([fila(), fila({ id: '2', tipo: 'mensaje', autor_id: 1 })]);
    mockRepo.getAdjuntosPorInforme.mockResolvedValue([{ id: '5', entrada_id: '2' } as any]);
    mockRepo.getPersonasResumen.mockResolvedValue([{ id: 1, nombre: 'A', apellido: 'B' }]);

    const r = await obtenerInforme(IID, 1);

    expect(r.creador).toBe(1);
    expect(r.entradas[0]!.adjuntos).toEqual([]);
    expect(r.entradas[1]!.adjuntos).toHaveLength(1);
    expect(r.personas[1]).toEqual({ id: 1, nombre: 'A', apellido: 'B' });
  });

  it('400 con cursor inválido y calcula el preview sin título', async () => {
    await expect(listarInformes(1, 'no-fecha')).rejects.toMatchObject({ statusCode: 400 });

    mockRepo.listInformesVisibles.mockResolvedValue({
      informes: [{ informe_id: IID, cuerpo_inicial: '<p>Título</p><p>uno</p><p>dos</p>' } as any],
      nextCursor: null,
    });
    const r = await listarInformes(1, undefined);
    expect(r.informes[0]).toMatchObject({ preview: 'Título uno dos' });
    expect(r.informes[0]).not.toHaveProperty('titulo');
    expect(r.informes[0]).not.toHaveProperty('cuerpo_inicial');
  });
});
