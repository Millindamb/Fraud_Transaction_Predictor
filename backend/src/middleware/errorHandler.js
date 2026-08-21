import env from '../config/env.js';

export const notFound = (req, _res, next) => {
  next(Object.assign(new Error(`No route matches ${req.method} ${req.originalUrl}`), { status: 404 }));
};

export const errorHandler = (err, _req, res, _next) => {
  const status = err.status || 500;

  if (err.code === 11000) {
    return res.status(409).json({ message: 'A record with that value already exists.' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'That identifier is not valid.' });
  }

  if (status >= 500) console.error(err);

  res.status(status).json({
    message: status >= 500 ? 'Something went wrong on our side.' : err.message,
    ...(err.details && { details: err.details }),
    ...(env.NODE_ENV !== 'production' && status >= 500 && { stack: err.stack }),
  });
};
