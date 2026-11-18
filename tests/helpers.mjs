import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FAKE = join(ROOT, 'tests', 'fake-claude.mjs');

export function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'leo-test-'));
  const home = join(dir, 'home');
  mkdirSync(home);
  const env = {
    LEO_HOME: home,
    LEO_STATUS: join(dir, 'STATUS.md'),
    LEO_HANDOFF_DIR: dir,
    LEO_MEMORY_INDEX: join(dir, 'MEMORY.md'),
    LEO_CLAUDE: FAKE,
    LEO_FAKE_LOG: join(dir, 'fake.log'),
    LEO_NOW: '2026-11-14T10:00:00+07:00',
    CLAUDE_PLUGIN_ROOT: ROOT,
  };
  return {
    dir, home, env,
    write(name, text, mtime) {
      const p = join(dir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text, 'utf8');
      if (mtime) utimesSync(p, mtime, mtime);
      return p;
    },
    state() {
      const p = join(home, 'state.json');
      return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
    },
    setState(obj) { writeFileSync(join(home, 'state.json'), JSON.stringify(obj), 'utf8'); },
    log() {
      const p = join(home, 'leo.log');
      return existsSync(p) ? readFileSync(p, 'utf8') : '';
    },
    fakeCalls() {
      const p = env.LEO_FAKE_LOG;
      return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    },
  };
}

// Запускает хук как отдельный процесс, подставляя stdin. input — объект (в JSON) или строка (как есть).
export function runHook(name, input, env = {}, opts = {}) {
  const stdin = typeof input === 'string' ? input : input === undefined ? '' : JSON.stringify(input);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(ROOT, 'hooks', name)], {
    input: stdin,
    encoding: 'utf8',
    env: { ...process.env, LEO_INNER: '', LEO_OFF: '', ...env },
    timeout: opts.timeout ?? 30000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, ms: Date.now() - t0, json: tryJson(r.stdout) };
}

export function runCli(args, env = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'leo.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export function tryJson(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export const longReply = (extra = '') =>
  ('Сделано: слил PR 12, проверил на стенде. ' + extra + 'Дальше — окно alpha. ').repeat(20);

/** Поддельные секреты для проверки фильтра: собираются на лету, чтобы в исходниках не лежало ничего, похожего на ключ. */
export const FK = {
  sk: ['sk', 'abcdefghijklmnop1234'].join('-'),
  ghp: ['ghp', 'abcdefghijklmnopqrst1234'].join('_'),
  ghp2: ['ghp', 'abcdefghijklmnop1234567'].join('_'),
  pat: ['github_pat', 'abcdefghijk123'].join('_'),
  xox: ['xoxb', '1234', 'abcd'].join('-'),
  akia: ['AKIA', 'ABCDEFGHIJKLMNOP'].join(''),
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'abcdefghij'].join('.'),
  pem: ['-----BEGIN', 'PRIVATE KEY-----'].join(' '),
  tg: ['123456789', 'ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789'].join(':'),
  hf: ['hf', 'abcdefghijklmnopqrstuv'].join('_'),
  sbp: ['sbp', 'abcdefghijklmnopqrst'].join('_'),
};
