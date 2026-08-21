import { z } from 'zod';
import User from '../models/User.js';
import ApiError from '../utils/ApiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { signToken } from '../middleware/auth.js';

export const loginSchema = z.object({
  email: z.string().email('Enter a valid work email.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
  // Same message either way — never reveal which accounts exist
  if (!user || !(await user.verifyPassword(password))) {
    throw ApiError.unauthorized('Those credentials did not match an account.');
  }

  user.lastLoginAt = new Date();
  await user.save({ validateBeforeSave: false });

  res.json({ token: signToken(user), user: user.toPublic() });
});

export const me = asyncHandler(async (req, res) => {
  res.json(req.user.toPublic());
});
