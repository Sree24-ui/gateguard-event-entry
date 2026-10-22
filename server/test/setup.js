import { beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/db/connect.js';

beforeAll(async () => {
  await connectDb(process.env.MONGODB_URI);
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
});

afterAll(async () => {
  await disconnectDb();
});
