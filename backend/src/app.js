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
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));
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
