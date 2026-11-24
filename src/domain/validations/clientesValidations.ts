import { ClienteDTO } from "../dto/ClienteDTO";
import { Validator } from "./ValidatorInterface";
import { BadRequestError } from "../../adapters/errors/AppError";

const schema: { [K in keyof ClienteDTO]: 'string' | 'number' | 'optional' | 'array' } = {
            id_cliente: 'optional',
            descripcion: 'string',
            direccion: 'string',
            email: 'string',
            cuit: 'string',
            id_condicion_iva: 'number',
            observacion: 'optional',
            telefonos: 'array',
            id_localidad: 'number'
};

const maxStringLength = 100;

export class ClienteValidator implements Validator {
    validateTypes(data: ClienteDTO[]): any[] {
        const errores: any[] = [];
        data.forEach((cliente, idx) => {
            const camposInvalidos: string[] = [];
            for (const [key, value] of Object.entries(cliente)) {
                const type = schema[key as keyof ClienteDTO];
                if (!type || type === 'optional') continue;
                if (type === 'array') {
                    if (value !== undefined && !Array.isArray(value)) {
                        camposInvalidos.push(key);
                    }
                } else {
                    if (typeof value !== type) {
                        camposInvalidos.push(key);
                    }
                }
            }
            if (camposInvalidos.length > 0) {
                errores.push({ fila: idx + 1, errores: camposInvalidos });
            }
        });
        return errores;
    }

    validateValues(data: ClienteDTO[]): any[] {
        const stringFields: (keyof ClienteDTO)[] = [
            "descripcion", "direccion", "cuit", "observacion", "email"
        ];
        const numberFields: (keyof ClienteDTO)[] = [
            "id_condicion_iva"
        ];

        return data.map((cliente, idx) => {
            const errores: string[] = [];

            // Validar longitud de strings
            for (const campo of stringFields) {
                const valor = cliente[campo];
                if (typeof valor === "string" && valor.length > maxStringLength) {
                    errores.push(`${campo} excede ${maxStringLength} caracteres`);
                }
            }

            // Validar números positivos
            for (const campo of numberFields) {
                const valor = cliente[campo];
                if (typeof valor === "number" && valor <= 0) {
                    errores.push(`${campo} debe ser positivo`);
                }
            }

            // Validar CUIT
            if (typeof cliente.cuit === "string" && !validarCUIT(cliente.cuit)) {
                errores.push("CUIT inválido");
            }

            return errores.length > 0 ? { fila: idx + 1, errores } : null;
        }).filter(Boolean);
    }

    validateData(data: ClienteDTO[]): any[] {
        return [
            ...this.validateTypes(data),
            ...this.validateValues(data)
        ];
    }
}

const validarCUIT = (cuit: string): boolean => {
    const regexCUIT = /^\d{2}-\d{8}-\d{1}$/;
    if (!regexCUIT.test(cuit)) return false;
    const cuitNum = cuit.replace(/-/g, '');
    if (cuitNum.length !== 11) return false;
    const base: readonly number[] = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let suma = 0;
    for (let i = 0; i < 10; i++) {
        const digitChar = cuitNum.charAt(i);
        if (!digitChar || !/\d/.test(digitChar)) return false;
        suma += parseInt(digitChar, 10) * base[i]!;
    }
    const resto = suma % 11;
    let verificador: number;
    if (resto === 0) {
        verificador = 0;
    } else if (resto === 1) {
        const prefix = cuitNum.substring(0, 2);
        if (prefix === '20') {
            verificador = 9;
        } else if (prefix === '27') {
            verificador = 4;
        } else {
            verificador = 11 - resto;
        }
    } else {
        verificador = 11 - resto;
    }
    const ultimoDigito = parseInt(cuitNum.charAt(10), 10);
    return verificador === ultimoDigito;
};

export const clienteValidator = new ClienteValidator();

export function validateSearchQuery(query: string): boolean {
    return !!query && query.trim().length > 0;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function agregarErrorPorFila(mapa: Map<number, string[]>, fila: number, nuevosErrores: string[]): void {
    const existentes = mapa.get(fila) || [];
    mapa.set(fila, [...existentes, ...nuevosErrores]);
}

export function validarClientesImportOArrojar(
    clientes: ClienteDTO[],
    erroresPrevios: { fila: number; errores: string[] }[] = []
): void {
    const erroresPorFila = new Map<number, string[]>();

    erroresPrevios.forEach(({ fila, errores }) => agregarErrorPorFila(erroresPorFila, fila, errores));

    clienteValidator.validateData(clientes).forEach(({ fila, errores }: { fila: number; errores: string[] }) =>
        agregarErrorPorFila(erroresPorFila, fila, errores)
    );

    clientes.forEach((cliente, idx) => {
        const fila = idx + 1;
        const camposFaltantes: string[] = [];
        if (!cliente.descripcion || cliente.descripcion.trim().length === 0) camposFaltantes.push('descripcion es requerida');
        if (!cliente.cuit || cliente.cuit.trim().length === 0) camposFaltantes.push('cuit es requerido');
        if (!cliente.direccion || cliente.direccion.trim().length === 0) camposFaltantes.push('direccion es requerida');
        if (!cliente.id_localidad || cliente.id_localidad <= 0) camposFaltantes.push('localidad es requerida');
        if (camposFaltantes.length > 0) agregarErrorPorFila(erroresPorFila, fila, camposFaltantes);

        if (cliente.email && !EMAIL_REGEX.test(cliente.email)) {
            agregarErrorPorFila(erroresPorFila, fila, ['email inválido']);
        }
    });

    const filasPorCuit = new Map<string, number[]>();
    const filasPorEmail = new Map<string, number[]>();
    clientes.forEach((cliente, idx) => {
        const fila = idx + 1;
        if (cliente.cuit) {
            filasPorCuit.set(cliente.cuit, [...(filasPorCuit.get(cliente.cuit) || []), fila]);
        }
        if (cliente.email) {
            filasPorEmail.set(cliente.email, [...(filasPorEmail.get(cliente.email) || []), fila]);
        }
    });

    filasPorCuit.forEach((filas, cuit) => {
        if (filas.length > 1) {
            filas.forEach(fila => agregarErrorPorFila(erroresPorFila, fila, [
                `cuit ${cuit} está duplicado en las filas: ${filas.filter(f => f !== fila).join(', ')}`
            ]));
        }
    });

    filasPorEmail.forEach((filas, email) => {
        if (filas.length > 1) {
            filas.forEach(fila => agregarErrorPorFila(erroresPorFila, fila, [
                `email ${email} está duplicado en las filas: ${filas.filter(f => f !== fila).join(', ')}`
            ]));
        }
    });

    if (erroresPorFila.size > 0) {
        const errores = Array.from(erroresPorFila.entries())
            .sort(([filaA], [filaB]) => filaA - filaB)
            .map(([fila, errs]) => ({ fila, errores: errs }));
        throw new BadRequestError('Clientes inválidos: ' + JSON.stringify(errores));
    }
}

export function validateClienteUpdate(id: any, fields: any): string | null {
    if (typeof id !== 'number' || id <= 0) {
        throw new Error('ID inválido');
    }
    if ('cuit' in fields || 'id' in fields) {
        throw new Error(`No se puede modificar el campo ${'cuit' in fields ? 'CUIT' : 'ID'}`);
    }

    const errores = clienteValidator.validateData([fields]);
    if (errores.length > 0) {
        const camposFields = Object.keys(fields);
        // Junta todos los errores de todos los elementos
        const todosLosErrores = errores.flatMap(e => e.errores);
        // Busca si algún error menciona un campo de fields
        const camposInvalidos = camposFields.filter(f =>
            todosLosErrores.some(err => err.includes(f))
        );
        if (camposInvalidos.length > 0) {
            throw new Error(`Campo inválido: ${camposInvalidos.join(", ")}`);
        }
    }
    return null;
}