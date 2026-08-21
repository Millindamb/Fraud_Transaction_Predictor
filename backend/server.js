import http from 'http';
import app from './src/app.js';
import env from './src/config/env.js';
import connectDB from './src/config/db.js';
import { initSocket } from './src/realtime/socket.js';

const server = http.createServer(app);

async function start() {
  await connectDB();
  initSocket(server);

  server.listen(env.PORT, () => {
    console.log(`FraudGuard API listening on http://localhost:${env.PORT}`);
    console.log(`Scoring mode: ${env.ML_ENABLED ? 'ML service' : 'built-in fallback scorer'}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});

// Never leave a half-dead process holding the port
const shutdown = (signal) => () => {
  console.log(`${signal} received, closing server`);
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
