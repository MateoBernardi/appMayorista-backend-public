# appMayorista — backend

> **Este repositorio es un espejo público del backend en producción**, publicado para mostrar la arquitectura y el código.
> El desarrollo sigue en un repositorio privado.

Backend de la plataforma de gestión de **Italo Argentina**, una cooperativa agropecuaria. Un solo servicio da soporte a tres clientes:

- **App interna** (móvil con Expo y web): comunicación y coordinación del personal: novedades, tablero kanban, solicitudes y chats, documentos, licencias, encuestas, informes y fichaje de horarios con QR y geolocalización.
- **Módulo mayorista**: catálogo de artículos y ofertas, clientes, pedidos, remitos y facturas en PDF, visitas comerciales y reportes de ventas.
- **Sitio web público** (italoarg.com.ar): novedades, catálogo público, suscripciones y carga de archivos (CVs, formularios).

---

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 22 + TypeScript (strict) |
| HTTP | Express 5 |
| Base de datos | PostgreSQL con SQL a mano (`pg`), **sin ORM**, y migraciones SQL versionadas |
| Auth | JWT de acceso + refresh tokens rotativos (hasheados en DB), contraseñas con argon2, login con Google (`google-auth-library`) |
| Tiempo real | Socket.IO (chats y badges) |
| Archivos | Cloudflare R2 (API S3, URLs prefirmadas) y Cloudflare Images |
| Notificaciones | Expo Push (`expo-server-sdk`) y Firebase Admin |
| Mail | Resend |
| Documentos | `pdfkit` / `pdf-lib` (remitos, facturas, reportes) |
| Integraciones | Google Sheets (solo lectura) para la planificación de turnos |
| Tareas programadas | `node-cron` |
| Tests | Jest + ts-jest |
| Deploy | Docker multi-stage → Railway, con CI/CD en GitHub Actions (staging y producción) |

---

## Arquitectura

Monolito modular con capas al estilo **puertos y adaptadores**. El dominio no conoce Express ni PostgreSQL.

```
             HTTP / WebSocket / cron
                      │
   routes/  ──►  middlewares (auth por rol, rate limit, idempotencia)
                      │
   controllers/   validan el request, arman el DTO y traducen errores a HTTP
                      │
   domain/        services (casos de uso) + reglas puras + DTOs + validaciones
                      │
   adapters/      db (repos SQL) · archivos (R2) · images · comunications (push, mail)
                  · inputs_outputs (PDF, CSV/Excel, Google Sheets) · realtime (Socket.IO)
```

```
src/
├── index.ts            # arranque: servidor HTTP, Socket.IO y cron jobs
├── app.ts              # Express: CORS, rate limit, montaje de routers con auth por rol
├── routes/             # un router por módulo (+ public/ para el sitio web)
├── controllers/        # capa HTTP
├── domain/
│   ├── services/       # casos de uso y reglas de negocio (p. ej. planificacionReglas, licenciasTurnosReglas)
│   ├── dto/            # contratos entre capas
│   └── validations/
├── adapters/           # todo lo que toca infraestructura
├── utils/              # cronJobs, tokens QR, fechas, sanitización
└── __tests__/          # ~80 suites de Jest
migrations/             # migraciones SQL numeradas
database/               # baseline del esquema, script de migración y tests SQL
docs/                   # ADRs y registro de decisiones (DECISIONS.md)
```

### Decisiones de diseño

- **Las reglas de negocio viven en TypeScript, no en SQL.** Las reglas de planificación, licencias y cálculo de horas son funciones puras testeadas con Jest. La base de datos guarda los datos y garantiza la integridad (constraints, transacciones y locks), pero no decide. Ver `docs/ADR-010-planificacion-sin-n8n.md`.
- **Autorización por rol en el borde.** Cada router se monta con `auth([...roles])` (`presidencia`, `gerencia`, `encargado`, `empleado`, `ventas`, `deposito`, `admin`, `kiosk`, …). La visibilidad fina (jerarquías, áreas, carpetas) se resuelve en los services.
- **Idempotencia en las mutaciones.** Las operaciones `POST`/`PUT` aceptan el header `X-Idempotency-Key`. La clave se guarda por usuario (`PRIMARY KEY (owner_key, idempotency_key)`) y un reintento devuelve el mismo status. Ver `docs/patterns/idempotency-middleware.md`.
- **Uploads directos a Cloudflare.** El backend solo firma la URL y guarda la metadata, y el archivo no pasa por el servidor.
- **Fichaje con QR fijo o rotativo (TOTP)** y geocerca por sede. La sede puede ser distinta en la entrada y en la salida.
- **Procesos programados** (cron): generación semanal de turnos desde la planilla, cálculo nocturno de horas trabajadas según las marcas, barrido de ausencias y turnos sin marcar, vencimiento de licencias, cola de notificaciones y limpieza de tokens y dispositivos.
- **Notificaciones transaccionales.** Se encolan en la misma transacción que el cambio (`notificaciones_pendientes`) y las despacha un worker.
- **Zona horaria explícita.** La base trabaja en `America/Argentina/Buenos_Aires` y el driver devuelve `timestamp`/`date` como string para evitar conversiones implícitas.

Cada decisión importante está documentada con su motivo, las alternativas descartadas y sus restricciones en [`docs/DECISIONS.md`](docs/DECISIONS.md) y en los ADR de `docs/`.

---

## Correr localmente

Requiere Node 22 y Docker.

```bash
npm install
cp .env.example .env          # completar al menos PG_* y JWT_*
docker compose -f docker-compose.dev.yml up -d
psql -h localhost -U dev_user -d appmayorista_dev -f database/baseline.sql
DATABASE_URL=postgres://dev_user:<password>@localhost:5432/appmayorista_dev npm run migrate
npm run dev
```

```bash
npm test        # Jest
npm run lint    # chequeo de tipos (tsc --noEmit)
```

Las integraciones externas (R2, Cloudflare Images, Expo, Firebase, Resend, Google) necesitan sus propias credenciales. Sin ellas el servidor arranca, pero esos endpoints fallan.

---

## Autor

Mateo Bernardi — [github.com/MateoBernardi](https://github.com/MateoBernardi)
