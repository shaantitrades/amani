import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lanceur de tests multiplateforme.
 * (L'argument `tests/` n'est pas resolu comme dossier par Node : on liste les
 * fichiers explicitement, ce qui fonctionne sous Windows comme sous Linux.)
 */
const testsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(testsDir, f));

console.log(`Tests Bodogui : ${files.length} fichiers`);
for (const f of files) console.log(`  - ${path.basename(f)}`);

const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 1));
