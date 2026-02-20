import { buildApp } from './app';
import { env } from './config/env';
import { db } from './db/pool';
import { ensureBootstrapData } from './db/bootstrap';
import { startConfirmationPoller, stopConfirmationPoller } from './jobs/confirmationPoller';

async function start() {
  const app = await buildApp();

  try {
    await db.query('SELECT 1');
    await ensureBootstrapData();

    await app.listen({
      host: '0.0.0.0',
      port: env.PORT
    });

    startConfirmationPoller(app);

    const close = async () => {
      stopConfirmationPoller();
      await app.close();
      await db.end();
      process.exit(0);
    };

    process.on('SIGINT', () => {
      void close();
    });

    process.on('SIGTERM', () => {
      void close();
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

void start();
