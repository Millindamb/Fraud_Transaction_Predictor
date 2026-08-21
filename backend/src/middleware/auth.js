import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const protect = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw ApiError.unauthorized('Your session has expired. Sign in again.');
  }

  const user = await User.findById(payload.sub);
  if (!user) throw ApiError.unauthorized('That account no longer exists.');

  req.user = user;
  next();
});

export const requireRole =
  (...roles) =>
  (req, _res, next) => {
    if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
    next();
  };

export const signToken = (user) =>
  jwt.sign({ sub: user._id, role: user.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });

export const verifyToken = (token) => jwt.verify(token, env.JWT_SECRET);
