import { MongoMemoryServer } from 'mongodb-memory-server';

let server;

/**
 * Starts one in-memory MongoDB for the whole run. If a local mongod is
 * already running, set MONGODB_TEST_URI to reuse it instead.
 */
export async function setup() {
  if (process.env.MONGODB_TEST_URI) {
    process.env.MONGODB_URI = process.env.MONGODB_TEST_URI;
    return;
  }
  server = await MongoMemoryServer.create();
  process.env.MONGODB_URI = server.getUri('gateguard_test');
}

export async function teardown() {
  await server?.stop();
}
