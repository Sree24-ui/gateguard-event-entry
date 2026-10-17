import { beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/db/connect.js';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-value';
process.env.TICKET_SECRET = 'test-ticket-secret-value';

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
