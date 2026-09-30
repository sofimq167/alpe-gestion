import { env } from './config/env';
import { createApp } from './app';
import { bootstrap, seedIfRequested } from './database/bootstrap';
import { pool } from './database/pool';

async function main() {
  await bootstrap();
  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[inicio] ALPE Gestión escuchando en el puerto ${env.port} (${env.isProduction ? 'producción' : 'desarrollo'})`);
    seedIfRequested().catch((err) => console.error('[inicio] No se pudieron cargar los datos de demostración:', err));
  });
  const shutdown = () => {
    server.close(() => pool.end().finally(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('[inicio] No se pudo iniciar la aplicación:', err);
  process.exit(1);
});
