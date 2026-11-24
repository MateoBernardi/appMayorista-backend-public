import fs from 'fs';
import os from 'os';
import path from 'path';
import { procesarArchivoClientes } from '../../adapters/inputs_outputs/procesarClientesCSV';

const createdFiles: string[] = [];

const writeCsv = (content: string): string => {
  const filePath = path.join(os.tmpdir(), `clientes-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`);
  fs.writeFileSync(filePath, content);
  createdFiles.push(filePath);
  return filePath;
};

const dataRow = 'C001,Cliente Uno,CatA,RamoB,Cordoba,Cordoba,20-11111111-2,3511234567,uno@test.com,Calle 1';

describe('procesarArchivoClientes', () => {
  afterEach(() => {
    while (createdFiles.length > 0) {
      const filePath = createdFiles.pop();
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  it('skips the first line when it contains cuit in any case', async () => {
    const filePath = writeCsv(`codigo,descripcion,categoria,ramo,localidad,provincia,CUIT,telefono,email,direccion\n${dataRow}\n`);

    const result = await procesarArchivoClientes(filePath);

    expect(result).toHaveLength(1);
    expect(result[0]!.descripcion).toBe('Cliente Uno');
  });

  it('treats the first line as data when there is no header', async () => {
    const filePath = writeCsv(`${dataRow}\nC002,Cliente Dos,CatA,RamoB,Cordoba,Cordoba,20-22222222-3,,,Calle 2\n`);

    const result = await procesarArchivoClientes(filePath);

    expect(result).toHaveLength(2);
    expect(result[0]!.descripcion).toBe('Cliente Uno');
    expect(result[1]!.descripcion).toBe('Cliente Dos');
  });

  it('skips empty lines', async () => {
    const filePath = writeCsv(`\n${dataRow}\n\n   \nC002,Cliente Dos,CatA,RamoB,Cordoba,Cordoba,20-22222222-3,,,Calle 2\n\n`);

    const result = await procesarArchivoClientes(filePath);

    expect(result).toHaveLength(2);
  });

  it('maps columns 1, 4, 6, 7, 8, 9 and ignores 0, 2, 3, 5', async () => {
    const filePath = writeCsv('IGNORED0,Cliente Uno,IGNORED2,IGNORED3,Cordoba,IGNORED5,20-11111111-2,3511234567,uno@test.com,Calle 1\n');

    const result = await procesarArchivoClientes(filePath);

    expect(result).toEqual([
      {
        descripcion: 'Cliente Uno',
        localidad: 'Cordoba',
        cuit: '20-11111111-2',
        telefono: '3511234567',
        email: 'uno@test.com',
        direccion: 'Calle 1',
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('IGNORED');
  });

  it('normalizes an 11-digit cuit to the dashed format', async () => {
    const filePath = writeCsv('C001,Cliente Uno,CatA,RamoB,Cordoba,Cordoba,20111111112,,,Calle 1\n');

    const result = await procesarArchivoClientes(filePath);

    expect(result[0]!.cuit).toBe('20-11111111-2');
  });

  it('passes a dashed cuit through unchanged', async () => {
    const filePath = writeCsv(`${dataRow}\n`);

    const result = await procesarArchivoClientes(filePath);

    expect(result[0]!.cuit).toBe('20-11111111-2');
  });

  it('passes a malformed cuit through as-is for later validation', async () => {
    const filePath = writeCsv('C001,Cliente Uno,CatA,RamoB,Cordoba,Cordoba,12345,,,Calle 1\n');

    const result = await procesarArchivoClientes(filePath);

    expect(result[0]!.cuit).toBe('12345');
  });

  it('omits telefono and email properties when their fields are empty', async () => {
    const filePath = writeCsv('C001,Cliente Uno,CatA,RamoB,Cordoba,Cordoba,20-11111111-2,,,Calle 1\n');

    const result = await procesarArchivoClientes(filePath);

    expect(result[0]).not.toHaveProperty('telefono');
    expect(result[0]).not.toHaveProperty('email');
  });

  it('trims whitespace around values', async () => {
    const filePath = writeCsv('C001,  Cliente Uno  , CatA , RamoB , Cordoba , Cordoba , 20-11111111-2 , 3511234567 , uno@test.com ,  Calle 1  \n');

    const result = await procesarArchivoClientes(filePath);

    expect(result[0]).toEqual({
      descripcion: 'Cliente Uno',
      localidad: 'Cordoba',
      cuit: '20-11111111-2',
      telefono: '3511234567',
      email: 'uno@test.com',
      direccion: 'Calle 1',
    });
  });

  it('handles CRLF line endings', async () => {
    const filePath = writeCsv(`codigo,descripcion,categoria,ramo,localidad,provincia,cuit,telefono,email,direccion\r\n${dataRow}\r\nC002,Cliente Dos,CatA,RamoB,Cordoba,Cordoba,20-22222222-3,,,Calle 2\r\n`);

    const result = await procesarArchivoClientes(filePath);

    expect(result).toHaveLength(2);
    expect(result[0]!.direccion).toBe('Calle 1');
    expect(result[1]!.cuit).toBe('20-22222222-3');
  });
});
