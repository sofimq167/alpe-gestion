// Configuración leída exclusivamente desde variables de entorno.

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}. Revise el archivo .env o la configuración en Render.`);
  return value;
}

const isProduction = process.env.NODE_ENV === 'production';

export const env = {
  isProduction,
  port: Number(process.env.PORT ?? 3001),
  databaseUrl: required('DATABASE_URL'),
  databaseSsl: (process.env.DATABASE_SSL ?? (isProduction ? 'true' : 'false')) === 'true',
  jwtSecret: (() => {
    const secret = required('JWT_SECRET');
    if (isProduction && secret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres.');
    return secret;
  })(),
  adminEmail: process.env.ADMIN_EMAIL,
  adminPassword: process.env.ADMIN_PASSWORD,
  adminName: process.env.ADMIN_NAME ?? 'Administrador',
  seedDemoData: process.env.SEED_DEMO_DATA === 'true',
  timezone: process.env.APP_TIMEZONE ?? 'America/Bogota',
  sessionHours: 12,
  maxUploadBytes: 2 * 1024 * 1024,
};
