import { createApp } from './app.js';
import { connectDb } from './db/connect.js';
import { env } from './config/env.js';

const app = createApp();

connectDb()
  .then(() => {
    console.log(`[gateguard] mongodb connected (${env.nodeEnv})`);
    app.listen(env.port, () => console.log(`[gateguard] api listening on :${env.port}`));
  })
  .catch((err) => {
    console.error('[gateguard] could not reach mongodb:', err.message);
    process.exit(1);
  });
