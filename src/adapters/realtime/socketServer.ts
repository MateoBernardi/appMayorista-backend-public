import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { validateAccessToken } from '../../domain/validations/authValidations';
import { allowedOrigins } from '../../config/corsOrigins';

interface SocketUser {
  userId: number;
  userContextId: number;
  role: string;
  entorno: string;
}

let io: SocketIOServer | null = null;

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const payload = validateAccessToken(token);
      if (payload.entorno !== 'interno') {
        return next(new Error('Forbidden'));
      }
      socket.data.user = payload as SocketUser;
      next();
    } catch (err: any) {
      next(new Error(err.message || 'Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user: SocketUser = socket.data.user;
    socket.join(`user:${user.userContextId}`);
  });

  return io;
}

export function emitToUser(userContextId: number, data: object): void {
  try {
    io?.to(`user:${userContextId}`).emit('update', data);
  } catch (err) {
    console.error('Error emitiendo evento de socket a usuario:', err);
  }
}

export function emitToUsers(userContextIds: number[], data: object): void {
  try {
    if (userContextIds.length === 0) return;
    io?.to(userContextIds.map((id) => `user:${id}`)).emit('update', data);
  } catch (err) {
    console.error('Error emitiendo evento de socket a usuarios:', err);
  }
}
