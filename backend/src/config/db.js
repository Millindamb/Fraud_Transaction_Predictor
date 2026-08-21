import mongoose from 'mongoose';
import env from './env.js';

export default async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  console.log(`MongoDB connected: ${mongoose.connection.name}`);

  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
  return mongoose.connection;
}
