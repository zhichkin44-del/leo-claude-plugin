#!/usr/bin/env node
// Сканер секретов по всей истории git (без зависимостей). Запасной вариант к gitleaks: ищет типичные форматы ключей
// в добавленных строках всех коммитов. Выход 0 — находок нет.
import { spawnSync } from 'node:child_process';

const PATTERNS = [
  ['pem', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['github', /\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/],
  ['openai', /\bsk-[A-Za-z0-9_-]{32,}/],
  ['slack', /\bxox[bpars]-[A-Za-z0-9-]{20,}/],
  ['stripe', /\b[sr]k_live_[A-Za-z0-9]{20,}/],
  ['google', /\bAIza[0-9A-Za-z_-]{35}\b|\bya29\.[A-Za-z0-9_-]{30,}/],
  ['telegram', /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
];

const r = spawnSync('git', ['log', '--all', '-p', '--no-color', '--format=commit %H'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
if (r.status !== 0) {
  process.stderr.write('git log failed: ' + r.stderr + '\n');
  process.exit(2);
}
let commit = '';
const found = [];
for (const line of r.stdout.split('\n')) {
  if (line.startsWith('commit ')) { commit = line.slice(7, 19); continue; }
  if (!line.startsWith('+') || line.startsWith('+++')) continue;
  for (const [name, re] of PATTERNS) if (re.test(line)) found.push(`${commit} ${name}: ${line.slice(0, 60)}`);
}
for (const f of found) process.stdout.write(f + '\n');
process.stdout.write(`${found.length} findings (${found.length} находок)\n`);
process.exit(found.length ? 1 : 0);
