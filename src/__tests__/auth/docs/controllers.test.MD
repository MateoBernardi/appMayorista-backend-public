# 📘 Documentación de Tests: Auth Controllers

Esta suite de pruebas unitarias verifica la lógica de negocio y el contrato HTTP de los controladores de autenticación (`authControllers.ts`). 

El objetivo principal es asegurar que la API responda correctamente a los diferentes tipos de clientes (**Web** vs **Mobile**) y maneje los errores de forma controlada sin depender de la base de datos ni servicios externos.

---

## 🛠 Stack Tecnológico de Pruebas
* **Framework:** Jest + ts-jest
* **Tipo de Test:** Unit Testing (Aislamiento total).
* **Dependencias Mockeadas:** 
  * `authServices` (Lógica de dominio)
  * `clientType` (Detección de entorno)
  * `errorsHandler` (Manejo de excepciones)
  * `cookieOptions` (Configuración de cookies)

---

## ✅ Cobertura de Escenarios (Test Cases)

A continuación se detallan los escenarios cubiertos por el archivo `authControllers.test.ts`:

### 1. Login Controller (`POST /login`)
| Escenario | Tipo Cliente | Resultado Esperado | Descripción |
| :--- | :--- | :--- | :--- |
| **Validación Input** | N/A | `400 Bad Request` | Falla si no se envía `username` ni `email`, o si faltan ambos. |
| **Validación Header** | N/A | `400 Bad Request` | Falla si el header `x-app-entorno` es inválido o inexistente. |
| **Login Exitoso** | **Web** | `200 OK` + **Set-Cookie** | Retorna CSRF token en body y RefreshToken en cookie `HttpOnly`. |
| **Login Readonly** | **Web** | `200 OK` (Sin Cookie) | Si `requiresAssociation: true`, no setea cookies, solo devuelve AccessToken limitado. |
| **Login Exitoso** | **Mobile/API** | `200 OK` (JSON) | Retorna ambos tokens (Access + Refresh) en el body JSON. No usa cookies. |
| **Manejo de Error** | Cualquiera | `401 Unauthorized` | Captura excepciones del servicio (ej. credenciales inválidas) y delega al `handleError`. |

### 2. Refresh Token Controller (`POST /refresh`)
| Escenario | Tipo Cliente | Resultado Esperado | Descripción |
| :--- | :--- | :--- | :--- |
| **Falta Token** | **Web** | `401 Unauthorized` | Falla si la cookie `refreshToken` no existe en la petición. |
| **Rotación Exitosa** | **Web** | `200 OK` + **Update-Cookie** | Genera nuevos tokens, actualiza la cookie y devuelve nuevo CSRF. |
| **Cambio Entorno** | **Web** | `403 Forbidden` | Retorna error específico si el usuario intenta rotar token hacia un entorno sin permisos. |
| **Rotación Exitosa** | **Mobile/API** | `200 OK` (JSON) | Lee el `refreshToken` del body y devuelve los nuevos tokens en el JSON de respuesta. |

### 3. Switch Profile Controller (`POST /switch-profile`)
| Escenario | Tipo Cliente | Resultado Esperado | Descripción |
| :--- | :--- | :--- | :--- |
| **ID Inválido** | N/A | `400 Bad Request` | Falla si `targetUserContextId` no es numérico o falta. |
| **Cambio Exitoso** | **Web** | `200 OK` + **Update-Cookie** | Verifica permisos, invalida tokens anteriores y setea nueva cookie con el nuevo perfil. |

### 4. Logout Controller (`POST /logout`)
| Escenario | Tipo Cliente | Resultado Esperado | Descripción |
| :--- | :--- | :--- | :--- |
| **Logout Exitoso** | **Web** | `200 OK` + **Clear-Cookie** | Llama al servicio de revocación y limpia la cookie del navegador. |
| **Logout Exitoso** | **Mobile/API** | `200 OK` | Llama al servicio de revocación usando el token del body. No intenta limpiar cookies. |

---

## 🧩 Estrategia de Mocks y Aislamiento

Para garantizar la velocidad y estabilidad de los tests, se han aislado las dependencias externas utilizando `jest.mock`.

### Factories (`controllersMocks.ts`)
Se utiliza un helper `createMockReqRes` para generar objetos `Request` y `Response` de Express bajo demanda, permitiendo configurar solo lo necesario para cada test:

```typescript
const { req, res } = createMockReqRes({ 
  body: { username: 'test' }, 
  headers: { 'x-app-entorno': 'web' } 
});