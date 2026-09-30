// Conexión a PostgreSQL. Todas las consultas usan parámetros ($1, $2...) para evitar inyección SQL.
import pg from 'pg';
import { env } from '../config/env';

// DATE -> texto 'YYYY-MM-DD'; NUMERIC y BIGINT -> number.
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1700, (v: string) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v: string) => (v === null ? null : parseInt(v, 10)));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});

pool.on('error', (err) => console.error('[db] Error inesperado en la conexión:', err.message));

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow = any>(
  sql: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

/**
 * Ejecuta varias consultas: en paralelo si se usa el pool, en secuencia si es un cliente de transacción
 * (un mismo cliente no puede ejecutar consultas simultáneas).
 */
export async function all<T extends readonly (() => Promise<unknown>)[]>(
  db: Db,
  fns: T,
): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (db instanceof pg.Pool) return Promise.all(fns.map((f) => f())) as never;
  const out: unknown[] = [];
  for (const f of fns) out.push(await f());
  return out as never;
}

/** Ejecuta una función dentro de una transacción: todo se guarda o nada se guarda. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
