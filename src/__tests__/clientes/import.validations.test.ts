import { validarClientesImportOArrojar } from '../../domain/validations/clientesValidations';
import { AppError } from '../../adapters/errors/AppError';
import { ClienteDTO } from '../../domain/dto/ClienteDTO';

const makeCliente = (overrides: Partial<ClienteDTO> = {}): ClienteDTO => ({
  descripcion: 'Cliente Uno',
  direccion: 'Calle 1',
  cuit: '20-11111111-2',
  email: '',
  id_condicion_iva: 1,
  id_localidad: 5,
  telefonos: [],
  ...overrides,
});

const capturarError = (clientes: ClienteDTO[], erroresPrevios?: { fila: number; errores: string[] }[]): AppError => {
  try {
    validarClientesImportOArrojar(clientes, erroresPrevios);
  } catch (error) {
    return error as AppError;
  }
  throw new Error('se esperaba un AppError');
};

const parseErrores = (error: AppError): { fila: number; errores: string[] }[] =>
  JSON.parse(error.message.replace('Clientes inválidos: ', ''));

describe('validarClientesImportOArrojar', () => {
  it('does not throw for valid rows', () => {
    const clientes = [
      makeCliente(),
      makeCliente({ descripcion: 'Cliente Dos', cuit: '20-22222222-3', email: 'dos@test.com' }),
    ];

    expect(() => validarClientesImportOArrojar(clientes)).not.toThrow();
  });

  it('merges erroresPrevios into the thrown message under the right fila', () => {
    const clientes = [makeCliente(), makeCliente({ cuit: '20-22222222-3' })];
    const erroresPrevios = [{ fila: 2, errores: ["La localidad 'Nunca' no existe"] }];

    const error = capturarError(clientes, erroresPrevios);
    const errores = parseErrores(error);

    expect(errores).toHaveLength(1);
    expect(errores[0]!.fila).toBe(2);
    expect(errores[0]!.errores).toContain("La localidad 'Nunca' no existe");
  });

  it('reports missing descripcion, cuit, direccion and non-positive id_localidad as required', () => {
    const clientes = [
      makeCliente({ descripcion: '', cuit: '', direccion: '', id_localidad: 0 }),
    ];

    const errores = parseErrores(capturarError(clientes));

    expect(errores[0]!.fila).toBe(1);
    expect(errores[0]!.errores).toEqual(expect.arrayContaining([
      'descripcion es requerida',
      'cuit es requerido',
      'direccion es requerida',
      'localidad es requerida',
    ]));
  });

  it('reports an invalid email format', () => {
    const clientes = [makeCliente({ email: 'no-es-un-email' })];

    const errores = parseErrores(capturarError(clientes));

    expect(errores[0]!.fila).toBe(1);
    expect(errores[0]!.errores).toContain('email inválido');
  });

  it('does not flag an empty email', () => {
    const clientes = [makeCliente({ email: '' })];

    expect(() => validarClientesImportOArrojar(clientes)).not.toThrow();
  });

  it('reports an in-file duplicate cuit on both filas mentioning the other fila', () => {
    const clientes = [
      makeCliente(),
      makeCliente({ descripcion: 'Cliente Dos', cuit: '20-22222222-3' }),
      makeCliente({ descripcion: 'Cliente Tres' }),
    ];

    const errores = parseErrores(capturarError(clientes));

    expect(errores).toHaveLength(2);
    expect(errores[0]!.fila).toBe(1);
    expect(errores[0]!.errores[0]).toContain('20-11111111-2');
    expect(errores[0]!.errores[0]).toContain('3');
    expect(errores[1]!.fila).toBe(3);
    expect(errores[1]!.errores[0]).toContain('1');
  });

  it('reports an in-file duplicate email', () => {
    const clientes = [
      makeCliente({ email: 'mismo@test.com' }),
      makeCliente({ descripcion: 'Cliente Dos', cuit: '20-22222222-3', email: 'mismo@test.com' }),
    ];

    const errores = parseErrores(capturarError(clientes));

    expect(errores).toHaveLength(2);
    expect(errores[0]!.errores[0]).toContain('mismo@test.com');
    expect(errores[1]!.errores[0]).toContain('mismo@test.com');
  });

  it('does not flag duplicate empty-string emails as duplicates', () => {
    const clientes = [
      makeCliente({ email: '' }),
      makeCliente({ descripcion: 'Cliente Dos', cuit: '20-22222222-3', email: '' }),
    ];

    expect(() => validarClientesImportOArrojar(clientes)).not.toThrow();
  });

  it('sorts the reported errors by fila', () => {
    const clientes = [
      makeCliente({ descripcion: 'Cliente Uno', cuit: '20-33333333-9' }),
      makeCliente({ descripcion: 'Cliente Dos', cuit: '20-22222222-3' }),
      makeCliente({ descripcion: '', cuit: '20-44444444-5' }),
    ];
    const erroresPrevios = [{ fila: 3, errores: ["La localidad 'Nunca' no existe"] }];

    const errores = parseErrores(capturarError(clientes, erroresPrevios));

    expect(errores.map(e => e.fila)).toEqual([1, 3]);
  });

  it('throws an AppError with statusCode 400 and a parseable JSON payload', () => {
    const clientes = [makeCliente({ cuit: '20-33333333-9' })];

    const error = capturarError(clientes);

    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(400);
    expect(error.message.startsWith('Clientes inválidos: ')).toBe(true);
    const payload = JSON.parse(error.message.replace('Clientes inválidos: ', ''));
    expect(Array.isArray(payload)).toBe(true);
    expect(payload[0]).toEqual({ fila: 1, errores: expect.arrayContaining(['CUIT inválido']) });
  });
});
