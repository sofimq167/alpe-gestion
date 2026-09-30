// Comandos de mantenimiento:
//   node server/dist/cli.js migrate        -> aplica migraciones
//   node server/dist/cli.js seed           -> carga datos de demostración (solo si la base está vacía)
//   node server/dist/cli.js create-admin <email> <contraseña> [nombre]
import bcrypt from 'bcryptjs';
import { ensureAdmin, isDatabaseEmpty } from './database/bootstrap';
import { runMigrations } from './database/migrate';
import { pool, queryOne } from './database/pool';
import { seedDemoData } from './database/seed';
import { ensureDefaultSettings } from './services/settingsService';

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'migrate': {
      const applied = await runMigrations();
      await ensureDefaultSettings();
      console.log(applied.length ? `Migraciones aplicadas: ${applied.join(', ')}` : 'La base de datos ya está actualizada.');
      break;
    }
    case 'seed': {
      await runMigrations();
      await ensureDefaultSettings();
      await ensureAdmin();
      if (!(await isDatabaseEmpty())) {
        console.log('La base de datos ya tiene información. No se cargaron datos de demostración.');
        break;
      }
      const admin = await queryOne<{ id: number }>(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`);
      await seedDemoData(admin?.id ?? null);
      console.log('Datos de demostración cargados.');
      break;
    }
    case 'create-admin': {
      const [email, password, ...nameParts] = args;
      if (!email || !password) {
        console.log('Uso: npm run create-admin -- correo@empresa.com ContraseñaSegura "Nombre"');
        process.exitCode = 1;
        break;
      }
      if (password.length < 8) throw new Error('La contraseña debe tener al menos 8 caracteres.');
      await runMigrations();
      const name = nameParts.join(' ') || 'Administrador';
      const existing = await queryOne('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
      if (existing) {
        await pool.query(`UPDATE users SET password_hash = $1, role = 'admin', active = TRUE WHERE id = $2`, [await bcrypt.hash(password, 10), existing.id]);
        console.log(`Usuario ${email} actualizado como administrador con la nueva contraseña.`);
      } else {
        await pool.query(`INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin')`, [name, email.toLowerCase(), await bcrypt.hash(password, 10)]);
        console.log(`Administrador ${email} creado.`);
      }
      break;
    }
    default:
      console.log('Comandos: migrate | seed | create-admin <email> <contraseña> [nombre]');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
