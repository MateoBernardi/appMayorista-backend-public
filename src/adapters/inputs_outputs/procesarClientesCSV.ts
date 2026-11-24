import fs from 'fs';
import readline from 'readline';
import { ClienteImportDTO } from '../../domain/dto/ClienteDTO';

const normalizarCuit = (valor: string): string => {
  if (/^\d{11}$/.test(valor)) {
    return `${valor.slice(0, 2)}-${valor.slice(2, 10)}-${valor.slice(10)}`;
  }
  return valor;
};

export const procesarArchivoClientes = async (filePath: string): Promise<ClienteImportDTO[]> => {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  const clientes: ClienteImportDTO[] = [];
  let esPrimeraLinea = true;

  for await (const line of rl) {
    const cleanLine = line.trim();
    if (!cleanLine) continue;

    if (esPrimeraLinea) {
      esPrimeraLinea = false;
      if (cleanLine.toLowerCase().includes('cuit')) continue;
    }

    const valores = cleanLine.split(',').map((v: string) => v.trim());

    const descripcion = valores[1] || '';
    const localidad = valores[4] || '';
    const cuit = normalizarCuit(valores[6] || '');
    const telefono = valores[7] || '';
    const email = valores[8] || '';
    const direccion = valores[9] || '';

    clientes.push({
      descripcion,
      localidad,
      cuit,
      direccion,
      ...(telefono.length > 0 && { telefono }),
      ...(email.length > 0 && { email }),
    });
  }

  return clientes;
};
