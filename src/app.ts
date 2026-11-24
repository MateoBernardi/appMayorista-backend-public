import express from 'express';
import ArticulosRouter from './routes/articulosRoutes';
import articulosOfertasRouter from './routes/articulosOfertasRoutes';
import clientesRouter from './routes/clientesRoutes';
import pedidosRouter from './routes/pedidosRoutes';
import pedidoArticuloRouter from './routes/detallePedidosRoutes';
import pedidoFacturaRouter from './routes/crearPedidoRouter';
import sincronizarRouter from './routes/sincronizarArticulosRoutes';
import authRouter from './routes/authRoutes';
import publicRouter from './routes/public/publicRoutes';
import SuscripcionRouter from './routes/suscripcionesRoutes';
import usuariosRouter from './routes/usuariosRoutes';
import articulosImagenesRouter from './routes/articulosImagenesRoutes';
import { auth } from './adapters/auth/authPermisos';
import Imagesrouter from './routes/imagenesRoutes';
import mailRouter from './routes/mailRoutes';
import novedadesRouter from './routes/novedadesRoutes';
import novedadesWebRouter from './routes/novedadesWebRoutes';
import archivosRouter from './routes/archivosRoutes';
import associationRouter from './routes/asociacionRoutes';
import SolicitudesActividadesRouter from './routes/solicitudesActividadesRoutes';
import kanbanRouter from './routes/kanbanRoutes';
import licenciasRouter from './routes/licenciasRoutes';
import reportesRouter from './routes/reportesRoutes';
import reportesImagenesRouter from './routes/reportesImagenesRoutes';
import encuestasRouter from './routes/encuestasRoutes';
import devicesRouter from './routes/devicesRoutes';
import carpetasRouter from './routes/carpetasRoutes';
import horariosRouter from './routes/horariosRoutes';
import localidadesRouter from './routes/localidadesRoutes';
import visitasRouter from './routes/visitasRoutes';
import badgesRouter from './routes/badgesRoutes';
import informesRouter from './routes/informesRoutes';
import { allRoles, kioskRoles, productAdminRoles, contentAdminRoles, anyAdminRoles } from './types/roles';
import { globalSafetyNetLimiter } from './adapters/middlewares/rateLimiter';
import { errorHandler } from './adapters/middlewares/errorHandler';
import { NotFoundError } from './adapters/errors/AppError';
import { allowedOrigins } from './config/corsOrigins';

const app = express();

app.set('trust proxy', 1); // Si estás detrás de un proxy (ej. Heroku, Nginx)

// Middleware catch-all para CORS headers y manejo de preflight OPTIONS
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, accessToken, credentials, x-app-entorno, X-Idempotency-Key');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

app.use(globalSafetyNetLimiter);

app.use((req, res, next) => {
  if (!req.is('multipart/form-data')) {
    express.json()(req, res, next);
  } else {
    next();
  }
});

app.use('/public', publicRouter);
app.use('/auth', authRouter);

// Solo requiere auth para estas rutas:
app.use('/usuarios', usuariosRouter);
app.use('/articulos', auth([...anyAdminRoles, 'gerencia', 'deposito', 'ventas']), ArticulosRouter);
app.use('/articulos-ofertas', auth([...productAdminRoles, 'gerencia', 'deposito', 'ventas']), articulosOfertasRouter);
app.use('/clientes', auth(['ventas', 'gerencia', 'deposito', ...productAdminRoles]), clientesRouter);
app.use('/pedidos', auth(['ventas', 'gerencia', 'deposito', 'admin']), pedidosRouter);
app.use('/detallePedidos', auth(['ventas', 'gerencia', 'deposito', 'admin']), pedidoArticuloRouter);
app.use('/newPedido', auth(['ventas', 'gerencia', 'deposito', 'admin']), pedidoFacturaRouter);
app.use('/sync', auth(['ventas', 'gerencia', ...productAdminRoles]), sincronizarRouter);
app.use('/suscripciones', auth([...contentAdminRoles, 'gerencia']), SuscripcionRouter);
app.use('/articulosImagenes', auth(anyAdminRoles), articulosImagenesRouter);
app.use('/imagenes', auth(anyAdminRoles), Imagesrouter);
app.use('/novedades-web', auth(contentAdminRoles), novedadesWebRouter);
app.use('/mail', auth(['gerencia', ...productAdminRoles]), mailRouter);
app.use('/novedades', auth(allRoles), novedadesRouter);
app.use('/archivos', auth(allRoles), archivosRouter);
app.use('/carpetas', auth(allRoles), carpetasRouter);
app.use('/asociar', auth(['readonly']), associationRouter); // Rutas de asociacion de cuentas
app.use('/solicitudes-actividades', auth(allRoles), SolicitudesActividadesRouter); // Rutas de solicitudes y actividades
app.use('/kanban', auth(allRoles), kanbanRouter);
app.use('/licencias', auth(allRoles), licenciasRouter); // Note: licenciasRouter not shown in this snippet
app.use('/reportes', auth(allRoles), reportesRouter); // Auth handled inside router, sacar contable de ver reportes
app.use('/reportesImagenes', auth(allRoles), reportesImagenesRouter);
app.use('/encuestas', encuestasRouter); // Auth handled inside router
app.use('/devices', devicesRouter); // Auth handled inside router
app.use('/horarios', horariosRouter); // Auth handled per-route inside horariosRouter
app.use('/localidades', auth(['deposito', 'ventas', 'gerencia', 'admin']), localidadesRouter);
app.use('/visitas', auth(['gerencia', 'ventas', 'admin']), visitasRouter);
app.use('/badges', auth(allRoles), badgesRouter);
app.use('/informes', auth(allRoles.filter((r) => !kioskRoles.includes(r))), informesRouter);

app.use((req, _res, next) => {
  next(new NotFoundError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`));
});

app.use(errorHandler);

export default app;
