#!/usr/bin/env node
// Runs the tests. The file list is collected here, because `node --test "tests/*.test.mjs"` does not expand the glob on Node 18/20 and on Windows.
// Usage: node scripts/run-tests.mjs [--coverage]
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.mjs')).sort().map((f) => join('tests', f));
const args = ['--test', '--test-reporter=spec'];
if (process.argv.includes('--coverage')) args.push('--experimental-test-coverage');
const r = spawnSync(process.execPath, [...args, ...files], { cwd: root, stdio: 'inherit' });
process.exit(r.status ?? 1);
