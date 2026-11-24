import { SuscripcionDTO } from "../../dto/SuscripcionDTO";

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class SuscripcionValidationService {
  /**
   * Valida los datos de una suscripción usando el DTO
   */
  static validate(data: SuscripcionDTO): ValidationResult {
    const errors: string[] = [];

    // Validar nombre
    const nombreErrors = this.validateNombre(data.nombre);
    errors.push(...nombreErrors);

    // Validar email
    const emailErrors = this.validateEmail(data.email);
    errors.push(...emailErrors);

    // Validar teléfono (opcional)
    if (data.telefono) {
      const telefonoErrors = this.validateTelefono(data.telefono);
      errors.push(...telefonoErrors);
    }

    // Validar localidad (opcional)
    if (data.localidad) {
      const localidadErrors = this.validateLocalidad(data.localidad);
      errors.push(...localidadErrors);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Validar nombre
   */
  private static validateNombre(nombre: string): string[] {
    const errors: string[] = [];

    if (!nombre || typeof nombre !== 'string') {
      errors.push("El nombre es requerido");
      return errors;
    }

    const trimmedNombre = nombre.trim();

    if (trimmedNombre.length === 0) {
      errors.push("El nombre no puede estar vacío");
    }

    if (trimmedNombre.length < 2) {
      errors.push("El nombre debe tener al menos 2 caracteres");
    }

    if (trimmedNombre.length > 100) {
      errors.push("El nombre no puede tener más de 100 caracteres");
    }

    // Validar que solo contenga letras, espacios y algunos caracteres especiales
    const nombreRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ\s'-]+$/;
    if (!nombreRegex.test(trimmedNombre)) {
      errors.push("El nombre solo puede contener letras, espacios, guiones y apostrofes");
    }

    return errors;
  }

  /**
   * Validar email
   */
  private static validateEmail(email: string): string[] {
    const errors: string[] = [];

    if (!email || typeof email !== 'string') {
      errors.push("El email es requerido");
      return errors;
    }

    const trimmedEmail = email.trim();

    if (trimmedEmail.length === 0) {
      errors.push("El email no puede estar vacío");
    }

    // Validación básica de formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      errors.push("El email debe tener un formato válido");
    }

    // Validación más estricta de email
    const strictEmailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (emailRegex.test(trimmedEmail) && !strictEmailRegex.test(trimmedEmail)) {
      errors.push("El formato del email no es válido");
    }

    if (trimmedEmail.length > 254) {
      errors.push("El email no puede tener más de 254 caracteres");
    }

    // Validar que no tenga dominios obviamente inválidos
    const invalidDomains = ['test.com', 'example.com', 'temp.com'];
    const domain = trimmedEmail.split('@')[1]?.toLowerCase();
    if (domain && invalidDomains.includes(domain)) {
      errors.push("El dominio del email no es válido");
    }

    return errors;
  }

  /**
   * Validar teléfono (opcional)
   */
  private static validateTelefono(telefono: string): string[] {
    const errors: string[] = [];

    if (typeof telefono !== 'string') {
      errors.push("El teléfono debe ser una cadena de texto");
      return errors;
    }

    const trimmedTelefono = telefono.trim();

    if (trimmedTelefono.length === 0) {
      return errors; // Si está vacío, es válido ya que es opcional
    }

    if (trimmedTelefono.length < 8) {
      errors.push("El teléfono debe tener al menos 8 dígitos");
    }

    if (trimmedTelefono.length > 20) {
      errors.push("El teléfono no puede tener más de 20 caracteres");
    }

    // Validar formato de teléfono (permite números, espacios, guiones, paréntesis y +)
    const telefonoRegex = /^[\+]?[\d\s\-\(\)]{8,20}$/;
    if (!telefonoRegex.test(trimmedTelefono)) {
      errors.push("El teléfono solo puede contener números, espacios, guiones, paréntesis y el símbolo +");
    }

    // Validar que tenga al menos 8 dígitos
    const digitsOnly = trimmedTelefono.replace(/\D/g, '');
    if (digitsOnly.length < 8) {
      errors.push("El teléfono debe contener al menos 8 dígitos");
    }

    if (digitsOnly.length > 15) {
      errors.push("El teléfono no puede contener más de 15 dígitos");
    }

    return errors;
  }

  /**
   * Validar localidad (opcional)
   */
  private static validateLocalidad(localidad: string): string[] {
    const errors: string[] = [];

    if (typeof localidad !== 'string') {
      errors.push("La localidad debe ser una cadena de texto");
      return errors;
    }

    const trimmedLocalidad = localidad.trim();

    if (trimmedLocalidad.length === 0) {
      return errors; // Si está vacío, es válido ya que es opcional
    }

    if (trimmedLocalidad.length < 2) {
      errors.push("La localidad debe tener al menos 2 caracteres");
    }

    if (trimmedLocalidad.length > 100) {
      errors.push("La localidad no puede tener más de 100 caracteres");
    }

    // Validar que solo contenga letras, números, espacios y algunos caracteres especiales
    const localidadRegex = /^[a-zA-ZáéíóúÁÉÍÓÚñÑüÜ0-9\s.,-]+$/;
    if (!localidadRegex.test(trimmedLocalidad)) {
      errors.push("La localidad solo puede contener letras, números, espacios, puntos, comas y guiones");
    }

    return errors;
  }

  /**
   * Sanitizar los datos de entrada usando el DTO
   */
  static sanitize(data: SuscripcionDTO): SuscripcionDTO {
    return {
      nombre: this.capitalizeWords(data.nombre?.trim() || ''),
      telefono: data.telefono?.trim() || '',
      email: data.email?.trim().toLowerCase() || '',
      localidad: data.localidad ? this.capitalizeWords(data.localidad.trim()) : '',
    };
  }

  /**
   * Convierte la primera letra de cada palabra a mayúscula
   */
  private static capitalizeWords(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    return text
      .toLowerCase()
      .split(' ')
      .map(word => {
        if (word.length === 0) return word;
        
        // Manejar palabras con guiones o apostrofes
        if (word.includes('-')) {
          return word.split('-').map(part => this.capitalizeFirstLetter(part)).join('-');
        }
        
        if (word.includes("'")) {
          return word.split("'").map(part => this.capitalizeFirstLetter(part)).join("'");
        }
        
        return this.capitalizeFirstLetter(word);
      })
      .join(' ');
  }

  /**
   * Convierte la primera letra de una palabra a mayúscula
   */
  private static capitalizeFirstLetter(word: string): string {
    if (!word || word.length === 0) return word;
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
}