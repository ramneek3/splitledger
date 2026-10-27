import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';

await migrate();
if (process.env.SEED_DEMO === 'true') {
  const { seed } = await import('./db/seed.js');
  await seed();
}
const server = createApp().listen(config.port, () => {
  console.log(`SplitLedger API listening on http://localhost:${config.port}`);
});

// Graceful shutdown so in-flight requests finish and DB connections close on redeploy.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
