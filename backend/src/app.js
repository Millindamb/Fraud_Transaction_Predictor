import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import env from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

app.set('trust proxy', 1);
app.use(helmet());
// CLIENT_ORIGIN accepts a comma-separated list. Vite falls back to 5174, 5175
// and so on when a port is taken, and a CORS rejection at that point looks
// exactly like a broken app — so the common dev ports are allowed by default.
const allowedOrigins = new Set(
  [
    ...env.CLIENT_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean),
    ...(env.NODE_ENV === 'production'
      ? []
      : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175']),
  ]
);

app.use(
  cors({
    origin(origin, cb) {
      // Same-origin and non-browser callers (curl, the simulator) send no Origin
      if (!origin || allowedOrigins.has(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed. Add it to CLIENT_ORIGIN.`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '200kb' }));
app.use(compression());
if (env.NODE_ENV !== 'test') app.use(morgan('dev'));

app.use(
  '/api',
  rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false })
);

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

export default app;