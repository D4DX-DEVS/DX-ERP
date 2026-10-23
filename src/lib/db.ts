import "server-only";
import mongoose from "mongoose";
import { env } from "@/lib/env";

type Cache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

const globalForMongoose = globalThis as unknown as { __dxMongoose?: Cache };
const cache: Cache = globalForMongoose.__dxMongoose ?? { conn: null, promise: null };
globalForMongoose.__dxMongoose = cache;

mongoose.set("strictQuery", true);

/** Connects once per server instance and reuses the connection across requests and hot reloads. */
export async function connectDB(): Promise<typeof mongoose> {
  if (cache.conn && mongoose.connection.readyState === 1) return cache.conn;
  if (!cache.promise) {
    cache.promise = mongoose
      .connect(env.mongoUri, {
        dbName: env.mongoDb || undefined,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 10_000,
        autoIndex: true,
      })
      .catch((error) => {
        cache.promise = null;
        throw error;
      });
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
