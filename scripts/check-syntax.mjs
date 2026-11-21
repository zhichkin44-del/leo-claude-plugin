#!/usr/bin/env node
// `node --check` for all .mjs files, no dependencies (syntax linter).
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let bad = 0;
let n = 0;
for (const d of ['lib', 'hooks', 'bin', 'scripts', 'tests']) {
  for (const f of readdirSync(join(root, d))) {
    const p = join(root, d, f);
    if (!f.endsWith('.mjs') || !statSync(p).isFile()) continue;
    n++;
    const r = spawnSync(process.execPath, ['--check', p], { encoding: 'utf8' });
    if (r.status !== 0) { bad++; process.stderr.write(r.stderr); }
  }
}
process.stdout.write(`${n} files checked, ${bad} with syntax errors\n`);
process.exit(bad ? 1 : 0);
