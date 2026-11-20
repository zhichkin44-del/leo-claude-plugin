import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, runHook, longReply, ROOT } from './helpers.mjs';
import { findClaude, standardLocations, noteClaudeMissingOnce } from '../lib/haiku.mjs';
import { validateConfig } from '../lib/config.mjs';

// Поддельный файл claude в каталоге песочницы: поиск проверяем по существованию файла.
function fake(sb, ...parts) {
  const p = join(sb.dir, ...parts);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, '');
  return p;
}
const bare = (sb) => ({ LEO_HOME: sb.env.LEO_HOME, PATH: '', USERPROFILE: join(sb.dir, 'up'), APPDATA: join(sb.dir, 'ap'), LOCALAPPDATA: join(sb.dir, 'la'), HOME: join(sb.dir, 'hm') });

test('claude на Windows: порядок LEO_CLAUDE → config → PATH → стандартные места', () => {
  const sb = sandbox();
  const std = fake(sb, 'up', '.local', 'bin', 'claude.exe');
  const cfg = fake(sb, 'custom', 'claude.exe');
  const pathDir = join(sb.dir, 'pathdir');
  const inPath = fake(sb, 'pathdir', 'claude.exe');
  const env = { ...bare(sb), PATH: pathDir };
  const win = { platform: 'win32', configured: '' };

  // только стандартное место (PATH пуст)
  assert.deepEqual(findClaude({ ...bare(sb) }, win), { cmd: std, pre: [], source: 'standard', found: true });
  // PATH важнее стандартного места
  assert.equal(findClaude(env, win).cmd, inPath);
  assert.equal(findClaude(env, win).source, 'PATH');
  // config важнее PATH
  assert.deepEqual(findClaude(env, { platform: 'win32', configured: cfg }), { cmd: cfg, pre: [], source: 'config', found: true });
  // LEO_CLAUDE важнее config
  assert.equal(findClaude({ ...env, LEO_CLAUDE: std }, { platform: 'win32', configured: cfg }).source, 'LEO_CLAUDE');
  // config с несуществующим путём — переходим дальше по цепочке
  assert.equal(findClaude(env, { platform: 'win32', configured: join(sb.dir, 'нет', 'claude.exe') }).source, 'PATH');
});

test('claude на Windows: npm-шим claude.cmd запускается через shell, а настоящий claude.exe рядом — напрямую', () => {
  const sb = sandbox();
  const cmd = fake(sb, 'ap', 'npm', 'claude.cmd');
  const r = findClaude(bare(sb), { platform: 'win32', configured: '' });
  assert.equal(r.cmd, cmd);
  assert.equal(r.shell, true);
  assert.equal(r.source, 'standard');
  // шим рядом с настоящим exe: берём exe, shell не нужен
  const real = fake(sb, 'ap', 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  const r2 = findClaude(bare(sb), { platform: 'win32', configured: cmd });
  assert.equal(r2.cmd, real);
  assert.equal(r2.shell, undefined);
});

test('claude на Windows: стандартное место %LOCALAPPDATA%\\Programs\\claude\\claude.exe', () => {
  const sb = sandbox();
  const p = fake(sb, 'la', 'Programs', 'claude', 'claude.exe');
  assert.equal(findClaude(bare(sb), { platform: 'win32', configured: '' }).cmd, p);
});

test('claude на macOS/Linux: ~/.local/bin/claude, ~/.npm-global/bin/claude и PATH', () => {
  const sb = sandbox();
  const local = fake(sb, 'hm', '.local', 'bin', 'claude');
  assert.equal(findClaude(bare(sb), { platform: 'linux', configured: '' }).cmd, local);
  assert.equal(findClaude(bare(sb), { platform: 'darwin', configured: '' }).source, 'standard');
  const g = sandbox();
  const npm = fake(g, 'hm', '.npm-global', 'bin', 'claude');
  assert.equal(findClaude(bare(g), { platform: 'linux', configured: '' }).cmd, npm);
  const pathDir = join(g.dir, 'p');
  const inPath = fake(g, 'p', 'claude');
  assert.equal(findClaude({ ...bare(g), PATH: pathDir }, { platform: 'linux', configured: '' }).cmd, inPath);
});

test('стандартные места перечислены полностью (Windows и POSIX)', () => {
  const env = { USERPROFILE: 'U', APPDATA: 'A', LOCALAPPDATA: 'L', HOME: 'H' };
  const w = standardLocations(env, 'win32');
  assert.equal(w.length, 3);
  assert.match(w[0], /\.local[\\/]bin[\\/]claude\.exe$/);
  assert.match(w[1], /npm[\\/]claude\.cmd$/);
  assert.match(w[2], /Programs[\\/]claude[\\/]claude\.exe$/);
  const p = standardLocations(env, 'linux');
  assert.ok(p.includes('/usr/local/bin/claude'));
  assert.ok(p.includes('/opt/homebrew/bin/claude'));
  assert.match(p[0], /\.local[\\/]bin[\\/]claude$/);
  assert.match(p[3], /\.npm-global[\\/]bin[\\/]claude$/);
});

test('claude нигде нет → found: false, и один раз на сессию', () => {
  const sb = sandbox();
  const r = findClaude(bare(sb), { platform: 'win32', configured: '' });
  assert.equal(r.found, false);
  assert.equal(r.source, 'none');
  assert.equal(noteClaudeMissingOnce(sb.env, 'sess-A'), true);
  assert.equal(noteClaudeMissingOnce(sb.env, 'sess-A'), false);
  assert.equal(noteClaudeMissingOnce(sb.env, 'sess-B'), true);
});

test('claudePath: тип проверяется, пустая строка — по умолчанию', () => {
  assert.deepEqual(validateConfig({ claudePath: 'C:\\x\\claude.exe' }), []);
  assert.deepEqual(validateConfig({ claudePath: '' }), []);
  assert.equal(validateConfig({ claudePath: 5 }).length, 1);
});

test('хук без claude пишет одну строку claude-missing на сессию, а не 7 ошибок haiku-failed', () => {
  const sb = sandbox();
  const e = { ...bare(sb), LEO_CLAUDE: '', LEO_HOME: sb.env.LEO_HOME, LEO_FAKE_LOG: sb.env.LEO_FAKE_LOG };
  const input = (session) => ({ session_id: session, stop_hook_active: false, last_assistant_message: longReply() });
  for (let i = 0; i < 3; i++) runHook('stop.mjs', input('sess-1'), e);
  runHook('stop.mjs', input('sess-2'), e);
  const log = readFileSync(join(sb.env.LEO_HOME, 'leo.log'), 'utf8');
  const lines = log.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.verdict === 'claude-missing').length, 2);
  assert.equal(lines.filter((l) => l.verdict === 'haiku-failed').length, 0);
  assert.ok(existsSync(join(sb.env.LEO_HOME, 'claude-missing.json')));
});
