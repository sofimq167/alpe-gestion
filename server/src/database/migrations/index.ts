import { sql as init } from './001_init';

// Agregue nuevas migraciones al final de esta lista. Nunca modifique una migración ya aplicada.
export const migrations: { id: string; sql: string }[] = [{ id: '001_init', sql: init }];
