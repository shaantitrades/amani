import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Lanceur de tests des utilitaires purs (aucun DOM requis). */
const testsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests');
const files = readdirSync(testsDir)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(testsDir, f));

console.log(`Tests Bodogui (frontend) : ${files.length} fichiers`);
const child = spawn(process.execPath, ['--test', ...files], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
