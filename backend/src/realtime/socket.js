import { Server } from 'socket.io';
import env from '../config/env.js';
import { verifyToken } from '../middleware/auth.js';

let io = null;

export function initSocket(server) {
  io = new Server(server, {
    path: '/socket.io',
    cors: { origin: env.CLIENT_ORIGIN, credentials: true },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Sign in to receive the live stream.'));
    try {
      socket.user = verifyToken(token);
      next();
    } catch {
      next(new Error('Your session has expired.'));
    }
  });

  io.on('connection', (socket) => {
    socket.join('feed');
    socket.on('disconnect', () => {});
  });

  return io;
}

export function emitScored(transaction) {
  io?.to('feed').emit('transaction:scored', transaction);
}

export function emitAlert(alert) {
  io?.to('feed').emit('alert:created', alert);
}
