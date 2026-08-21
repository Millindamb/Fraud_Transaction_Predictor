import dotenv from 'dotenv';
dotenv.config();

const num = (v, fallback) => (v === undefined ? fallback : Number(v));
const bool = (v, fallback) => (v === undefined ? fallback : v === 'true');

const env = {
  PORT: num(process.env.PORT, 5000),
  NODE_ENV: process.env.NODE_ENV || 'development',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',

  MONGO_URI: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fraudguard',

  JWT_SECRET: process.env.JWT_SECRET || 'dev_only_secret_do_not_ship',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '8h',

  FUSION_STRATEGY: process.env.FUSION_STRATEGY || 'weighted',
  FUSION_RULE_WEIGHT: num(process.env.FUSION_RULE_WEIGHT, 0.4),
  FUSION_ML_WEIGHT: num(process.env.FUSION_ML_WEIGHT, 0.6),

  BAND_LOW_MAX: num(process.env.BAND_LOW_MAX, 30),
  BAND_MEDIUM_MAX: num(process.env.BAND_MEDIUM_MAX, 60),
  BAND_HIGH_MAX: num(process.env.BAND_HIGH_MAX, 80),

  ML_ENABLED: bool(process.env.ML_ENABLED, false),
  ML_SERVICE_URL: process.env.ML_SERVICE_URL || 'http://localhost:8000',
  ML_TIMEOUT_MS: num(process.env.ML_TIMEOUT_MS, 250),

  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL || 'analyst@bank.in',
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD || 'Analyst@123',
};

if (env.NODE_ENV === 'production' && env.JWT_SECRET.startsWith('dev_only')) {
  throw new Error('JWT_SECRET must be set in production');
}

export default env;
