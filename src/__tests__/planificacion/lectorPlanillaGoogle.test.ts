/**
 * Tests del lector de la planilla de Google (solo lectura). google-auth-library está mockeada:
 * no se llama a Google.
 */

const mockRequest = jest.fn();
const mockJwt = jest.fn();
jest.mock('google-auth-library', () => ({
  JWT: function (opts: unknown) {
    mockJwt(opts);
    return { request: mockRequest };
  },
}));

import { leerPlanilla } from '../../adapters/inputs_outputs/lectorPlanillaGoogle';

const OLD_ENV = process.env;

beforeEach(() => {
  jest.clearAllMocks();
  process.env = {
    ...OLD_ENV,
    GOOGLE_SHEETS_CLIENT_EMAIL: 'svc@proyecto.iam.gserviceaccount.com',
    GOOGLE_SHEETS_PRIVATE_KEY: '-----BEGIN KEY-----\\nabc\\n-----END KEY-----',
    PLANIFICACION_SHEET_ID: 'sheet123',
    PLANIFICACION_SHEET_RANGE: 'planilla horarios!A1:AM200',
  };
  delete process.env.PLANIFICACION_SHEETS_TIMEOUT_MS;
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterAll(() => { process.env = OLD_ENV; });

describe('leerPlanilla', () => {
  it.each([
    'GOOGLE_SHEETS_CLIENT_EMAIL', 'GOOGLE_SHEETS_PRIVATE_KEY', 'PLANIFICACION_SHEET_ID', 'PLANIFICACION_SHEET_RANGE',
  ])('falta %s: 503 sin llamar a Google', async (variable) => {
    delete process.env[variable];

    await expect(leerPlanilla()).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'El servicio de planificación no está configurado.',
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('pide solo lectura: scope readonly, GET de values con UNFORMATTED_VALUE y clave con saltos de línea reales', async () => {
    mockRequest.mockResolvedValue({ data: { values: [['ID', 'Empleado'], [1, 'Ana']] } });

    const filas = await leerPlanilla();

    expect(filas).toEqual([['ID', 'Empleado'], [1, 'Ana']]);
    expect(mockJwt).toHaveBeenCalledWith({
      email: 'svc@proyecto.iam.gserviceaccount.com',
      key: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith({
      url: `https://sheets.googleapis.com/v4/spreadsheets/sheet123/values/${encodeURIComponent('planilla horarios!A1:AM200')}?valueRenderOption=UNFORMATTED_VALUE`,
      method: 'GET',
      timeout: 20000,
    });
  });

  it('usa PLANIFICACION_SHEETS_TIMEOUT_MS si está configurado', async () => {
    process.env.PLANIFICACION_SHEETS_TIMEOUT_MS = '5000';
    mockRequest.mockResolvedValue({ data: {} });

    expect(await leerPlanilla()).toEqual([]);
    expect(mockRequest.mock.calls[0][0].timeout).toBe(5000);
  });

  it('error de red o de Google: 503 genérico y no se loguea la clave', async () => {
    mockRequest.mockRejectedValue(new Error('socket hang up'));

    await expect(leerPlanilla()).rejects.toMatchObject({ statusCode: 503, code: 'SERVICE_UNAVAILABLE' });
    const logueado = JSON.stringify((console.error as jest.Mock).mock.calls);
    expect(logueado).toContain('socket hang up');
    expect(logueado).not.toContain('BEGIN KEY');
  });
});
