#!/usr/bin/env node
// Line-coverage threshold for lib/: average over the lib/ files in the report of `node --test --experimental-test-coverage` (file or stdin).
// Usage: node scripts/check-coverage.mjs report.txt [threshold=85]
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const min = Number(process.argv[3] || 85);
const text = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
let dir = '';
const rows = [];
for (const raw of text.split(/\r?\n/)) {
  const m = /^ℹ(\s+)(\S+)\s*\|\s*([\d.]*)\s*\|/.exec(raw);
  if (!m) continue;
  const [, indent, name, line] = m;
  if (line === '') { dir = name; continue; }
  if (dir === 'lib' && indent.length > 1) rows.push({ name, line: Number(line) });
}
if (!rows.length) {
  process.stderr.write('no lib/ rows in the coverage report\n');
  process.exit(2);
}
const avg = rows.reduce((a, r) => a + r.line, 0) / rows.length;
const worst = rows.reduce((a, r) => (r.line < a.line ? r : a));
process.stdout.write(`lib/ line coverage: ${avg.toFixed(2)}% average over ${rows.length} files (lowest: ${worst.name} ${worst.line}%), threshold ${min}%\n`);
process.exit(avg >= min ? 0 : 1);
