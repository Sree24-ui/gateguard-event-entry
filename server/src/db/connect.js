import mongoose from 'mongoose';
import { env } from '../config/env.js';

mongoose.set('strictQuery', true);

let connecting = null;

/**
 * Connect once and reuse the connection. Serverless invocations reuse a warm
 * instance, so caching the promise avoids a reconnect storm per request.
 */
export function connectDb(uri = env.mongoUri) {
  if (mongoose.connection.readyState === 1) return Promise.resolve(mongoose.connection);
  if (!connecting) {
    connecting = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10
      })
      .then((m) => m.connection)
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}

export async function disconnectDb() {
  connecting = null;
  await mongoose.disconnect();
}

export function dbState() {
  return ['disconnected', 'connected', 'connecting', 'disconnecting'][
    mongoose.connection.readyState
  ] || 'unknown';
}
