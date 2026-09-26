import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lance les tests AVEC le parcours complet base de donnees (RUN_DB_TESTS=1).
 * Necessite une base PostgreSQL accessible via DATABASE_URL et les migrations.
 *   npm run test:db
 */
const runner = path.join(path.dirname(fileURLToPath(import.meta.url)), 'run-tests.mjs');
const child = spawn(process.execPath, [runner], {
  stdio: 'inherit',
  env: { ...process.env, RUN_DB_TESTS: '1' },
});

if (!process.env.DATABASE_URL) {
  console.log('Rappel : DATABASE_URL doit pointer vers une base PostgreSQL de test.');
}
child.on('exit', (code) => process.exit(code ?? 1));
