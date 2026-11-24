import { fetchClientesVisitadosZona, searchClientesRepo, getAllActiveClients, getAllLocalidades, getZonasDisponibles, getAllClientesByLocalidad } from "../../adapters/db/clientesRepo";
import { validateClienteUpdate, validarClientesImportOArrojar, validateSearchQuery } from "../validations/clientesValidations";
import { createCliente, updateCliente, deleteCliente } from "../../adapters/db/clientesRepo";
import { getCondicionIvaPorDescripcion, getClientesByCuitsOrEmails, createClientesBulk } from "../../adapters/db/clientesRepo";
import { getPedidos} from "../../adapters/db/pedidosRepo";
import { ClienteDTO, ClienteImportDTO, LocalidadDTO, ClientesVisitadosDTO } from "../dto/ClienteDTO";
import { clienteValidator } from "../validations/clientesValidations";
import { BadRequestError, InternalServerError, NotFoundError, UnprocessableEntityError } from "../../adapters/errors/AppError";

const DEFAULT_CONDICION_IVA = 'Consumidor Final';

const tienePedidos = async (id: number): Promise<boolean> => {
  const estados = ['pendiente', 'preparado'];
  for (const estado of estados) {
    const pedidos = await getPedidos(1, 100, id, estado, undefined, undefined);
    if (pedidos.some((p: any) => p.id_cliente === id)) {
      return true;
    }
  }
  return false;
};

export const fetchClientes = async (zona: string): Promise<ClienteDTO[]> => {
  const clientes = await getAllActiveClients(zona);
  return clientes;
};

export const searchClientesService = async (query: string): Promise<ClienteDTO[]> => {
  if (!validateSearchQuery(query)) return [];
  const clientes = await searchClientesRepo(query);
  return clientes;
};

export const NewCliente = async (clienteData: ClienteDTO): Promise<number> => {
  clienteValidator.validateData([clienteData]);
  const newCliente = await createCliente(clienteData);
  return newCliente;
};

export const updateClienteFields = async (id: number, fields: Partial<ClienteDTO>): Promise<{ success: boolean }> => {
  validateClienteUpdate(id, fields);
  const updatedCliente = await updateCliente(id, fields);
  if (!updatedCliente) {
    throw new NotFoundError(`Cliente con ID ${id} no encontrado`);
  }
  return updatedCliente;
};

export const removeCliente = async (id: number): Promise<ClienteDTO | ClienteDTO[] | undefined> => {
  if (await tienePedidos(id)) {
    throw new UnprocessableEntityError('No se puede borrar el cliente porque tiene pedidos en estado pendiente o preparado');
  }
  const deletedCliente = await deleteCliente(id);
  return deletedCliente;
};

export const fetchZonasDisponibles = async (): Promise<{ zona: number | string }[]> => {
  const zonas = await getZonasDisponibles();
  return zonas;
};

export const getClientesVisitadosHoy = async (zona: string): Promise<ClientesVisitadosDTO | undefined> => {
  const clientes = await fetchClientesVisitadosZona(zona);
  return clientes;
};

export const fetchAllLocalidades = async (): Promise<LocalidadDTO[]> => {
  const localidades = await getAllLocalidades();
  return localidades;
};

export const fetchClientesPorLocalidad = async (id_localidad: number): Promise<ClienteDTO[]> => {
  const clientes = await getAllClientesByLocalidad(id_localidad);
  return clientes;
}

function construirClientesImport(
  rows: ClienteImportDTO[],
  localidades: LocalidadDTO[],
  idCondicionIva: number
): { clientes: ClienteDTO[]; erroresLocalidad: { fila: number; errores: string[] }[] } {
  const localidadPorNombre = new Map(localidades.map(l => [l.nombre.trim().toLowerCase(), l.id_localidad]));
  const erroresLocalidad: { fila: number; errores: string[] }[] = [];

  const clientes: ClienteDTO[] = rows.map((row, idx) => {
    const idLocalidad = localidadPorNombre.get(row.localidad.trim().toLowerCase());
    if (!idLocalidad) {
      erroresLocalidad.push({ fila: idx + 1, errores: [`La localidad '${row.localidad}' no existe`] });
    }
    return {
      descripcion: row.descripcion,
      direccion: row.direccion,
      cuit: row.cuit,
      email: row.email ?? '',
      id_condicion_iva: idCondicionIva,
      id_localidad: idLocalidad ?? 0,
      telefonos: row.telefono ? [{ telefono: row.telefono, tipo: 'principal' }] : [],
    };
  });

  return { clientes, erroresLocalidad };
}

async function verificarDuplicadosEnBD(clientes: ClienteDTO[]): Promise<void> {
  const cuits = clientes.map(c => c.cuit);
  const emails = clientes.filter(c => c.email).map(c => c.email);
  const existentes = await getClientesByCuitsOrEmails(cuits, emails);
  if (existentes.length === 0) return;

  const errores = clientes.reduce<{ fila: number; errores: string[] }[]>((acc, cliente, idx) => {
    const errs: string[] = [];
    if (existentes.some(e => e.cuit === cliente.cuit)) errs.push(`cuit ${cliente.cuit} ya existe`);
    if (cliente.email && existentes.some(e => e.email === cliente.email)) errs.push(`email ${cliente.email} ya existe`);
    if (errs.length > 0) acc.push({ fila: idx + 1, errores: errs });
    return acc;
  }, []);

  throw new BadRequestError('Clientes inválidos: ' + JSON.stringify(errores));
}

export const importClientesService = async (rows: ClienteImportDTO[]): Promise<number> => {
  if (rows.length === 0) return 0;

  const condicionIva = await getCondicionIvaPorDescripcion(DEFAULT_CONDICION_IVA);
  if (!condicionIva) {
    throw new InternalServerError(`No se encontró la condición de IVA '${DEFAULT_CONDICION_IVA}'`);
  }

  const localidades = await getAllLocalidades();
  const { clientes, erroresLocalidad } = construirClientesImport(rows, localidades, condicionIva.id_condicion);

  validarClientesImportOArrojar(clientes, erroresLocalidad);

  await verificarDuplicadosEnBD(clientes);

  return createClientesBulk(clientes);
};
