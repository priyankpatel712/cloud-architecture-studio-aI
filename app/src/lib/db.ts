import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/cloud_architecture_studio';
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || 'cloud_architecture_studio';

/**
 * Cached connection so Next.js dev HMR doesn't open a new pool on every reload.
 * Node runtime only — never import this from middleware or an Edge route.
 */
interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var _mongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = global._mongooseCache ?? { conn: null, promise: null };
global._mongooseCache = cache;

export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose.connect(MONGODB_URI, {
      dbName: MONGODB_DB_NAME,
      bufferCommands: false,
    });
  }
  try {
    cache.conn = await cache.promise;
  } catch (e) {
    // A failed connect (e.g. MongoDB not yet started) must not poison the
    // cache with a forever-rejected promise — clear it so the next request
    // retries instead of 500ing until the server is restarted.
    cache.promise = null;
    throw e;
  }
  return cache.conn;
}
