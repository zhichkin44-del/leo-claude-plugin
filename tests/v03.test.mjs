import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, sandbox, runHook, runCli, longReply } from './helpers.mjs';
import { CATALOG, t, pickLang } from '../lib/i18n.mjs';
import { buildPrompt, parseVerdict, blockReason } from '../lib/skeptic.mjs';
import { validateConfig, loadConfig } from '../lib/config.mjs';
import { emptyState } from '../lib/state.mjs';

const EN = { LEO_LANG: 'en', LEO_PROFILE: 'default' };
const NOHOME = { LEO_HOME: join(ROOT, 'no-such-home-dir') };
const inp = (msg, extra = {}) => ({ session_id: 's', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg, ...extra });
const enReply = 'Done: merged PR 12 and verified on the staging server. '.repeat(14);

// ---------- i18n ----------
test('все сообщения есть в EN и RU: наборы ключей совпадают, расхождений 0', () => {
  const en = Object.keys(CATALOG.en).sort();
  const ru = Object.keys(CATALOG.ru).sort();
  assert.deepEqual(en.filter((k) => !ru.includes(k)), [], 'нет в ru');
  assert.deepEqual(ru.filter((k) => !en.includes(k)), [], 'нет в en');
  for (const k of Object.keys(CATALOG['ru:director'])) assert.ok(en.includes(k), 'профиль director: лишний ключ ' + k);
});

test('каждый ключ t(...) в коде есть в каталоге', () => {
  const files = [...readdirSync(join(ROOT, 'lib')).map((f) => join(ROOT, 'lib', f)), join(ROOT, 'bin', 'leo.mjs')];
  const used = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('(\w+)'/g)) used.add(m[1]);
  for (const k of used) assert.ok(k in CATALOG.en, 'нет ключа ' + k);
  assert.ok(used.size > 40);
});

test('язык: LEO_LANG важнее всего, затем config.json, затем локаль; по умолчанию en', () => {
  const sb = sandbox();
  const base = { LEO_HOME: sb.home };
  assert.equal(pickLang({ ...base, LEO_LANG: 'ru' }), 'ru');
  assert.equal(pickLang({ ...base, LANG: 'ru_RU.UTF-8' }), 'ru');
  assert.equal(pickLang({ ...base, LANG: 'en_US.UTF-8' }), 'en');
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ lang: 'ru' }));
  assert.equal(pickLang({ ...base, LANG: 'en_US' }), 'ru');
  assert.equal(pickLang({ ...base, LEO_LANG: 'en', LANG: 'en_US' }), 'en');
});

test('t(): подстановка переменных и запасной ключ', () => {
  assert.equal(t('docNode', { LEO_LANG: 'en', ...NOHOME }, { v: '20.1.0' }), 'Node.js 20.1.0 (need >= 18)');
  assert.match(t('docNode', { LEO_LANG: 'ru', ...NOHOME }, { v: '20.1.0' }), /нужен/);
  assert.equal(t('нет-такого-ключа', { LEO_LANG: 'en', ...NOHOME }), 'нет-такого-ключа');
});

// ---------- промпт без внутреннего жаргона ----------
test('EN-промпт Haiku: по-английски, без жаргона автора', () => {
  const sb = sandbox();
  const p = buildPrompt(enReply, emptyState(), { ...sb.env, ...EN }, ['fix the login page']);
  assert.doesNotMatch(p, /[А-Яа-яЁё]/);
  assert.doesNotMatch(p, /director|owner|not a programmer/i);
  assert.match(p, /reader/);
  assert.match(p, /skeptic/);
  assert.match(p, /fix the login page/);
});

test('RU-промпт по умолчанию нейтральный; жаргон «директор/владелец» — только в профиле director', () => {
  const sb = sandbox();
  const msg = 'Готово: слил PR 12. '.repeat(10);
  const neutral = buildPrompt(msg, emptyState(), { ...sb.env, LEO_LANG: 'ru', LEO_PROFILE: 'default' }, []);
  assert.doesNotMatch(neutral, /директор|владел|не программист/i);
  assert.match(neutral, /пользовател/);
  const dir = buildPrompt(msg, emptyState(), { ...sb.env, LEO_LANG: 'ru', LEO_PROFILE: 'director' }, []);
  assert.match(dir, /владел/);
});

test('код не содержит зашитого жаргона вне словаря профиля', () => {
  for (const f of ['skeptic.mjs', 'restore.mjs', 'haiku.mjs', 'io.mjs', 'doctor.mjs', 'config.mjs']) {
    assert.doesNotMatch(readFileSync(join(ROOT, 'lib', f), 'utf8'), /директор|владел|не программист/i, f);
  }
});

test('парсер вердикта понимает ключ reader и старый owner', () => {
  const a = parseVerdict(JSON.stringify({ reader: { issues: [{ severity: 'serious', text: 'jargon' }] }, skeptic: { issues: [] } }));
  const b = parseVerdict(JSON.stringify({ owner: { issues: [{ severity: 'serious', text: 'jargon' }] }, skeptic: { issues: [] } }));
  assert.equal(a.issues[0].role, 'reader');
  assert.equal(b.issues[0].role, 'reader');
  assert.match(blockReason(a.issues, null, { LEO_LANG: 'en', ...NOHOME }), /\[reader\] jargon/);
});

test('EN: блокировка по-английски; английский итог тоже проверяется', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(enReply), { ...sb.env, ...EN, LEO_FAKE_MODE: 'skeptic' });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /Leo's check/);
  assert.doesNotMatch(r.json.reason, /Проверка Leo/);
  assert.equal(sb.fakeCalls().length, 1);
});

// ---------- настройки ----------
test('config.json: схема валидируется, ошибки понятны', () => {
  assert.deepEqual(validateConfig({ mode: 'advice', minLength: 300, roles: { reader: false }, triggers: ['ship it'], model: 'haiku' }), []);
  const bad = validateConfig({ mode: 'loud', minLength: -1, roles: { boss: true }, nope: 1, log: 'yes' });
  assert.equal(bad.length, 5);
  JSON.parse(readFileSync(join(ROOT, 'docs', 'config.schema.json'), 'utf8'));
});

test('плохие значения в config.json игнорируются, а не валят хук', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ mode: 'loud', minLength: 'abc', model: 'sonnet' }));
  const c = loadConfig(sb.env);
  assert.equal(c.mode, 'block');
  assert.equal(c.minLength, 600);
  assert.equal(c.model, 'sonnet');
  writeFileSync(join(sb.home, 'config.json'), '{not json');
  assert.equal(loadConfig(sb.env).mode, 'block');
});

test('mode advice: серьёзная находка — подсказка без block', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ mode: 'advice' }));
  const r = runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'skeptic' });
  assert.equal(r.json.decision, undefined);
  assert.match(r.json.hookSpecificOutput.additionalContext, /нет номера коммита/);
  assert.match(sb.log(), /"verdict":"advice"/);
});

test('model и minLength из config.json доходят до вызова', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ model: 'sonnet', minLength: 200 }));
  runHook('stop.mjs', inp('Вот разбор по пунктам. '.repeat(10)), { ...sb.env, LEO_FAKE_MODE: 'ok' });
  const calls = sb.fakeCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'sonnet');
});

test('roles: обе выключены — Haiku не зовём; выключен читатель — его находки не блокируют', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ roles: { reader: false, skeptic: false } }));
  runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'owner' });
  assert.equal(sb.fakeCalls().length, 0);
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ roles: { reader: false } }));
  const r = runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'owner' });
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 1);
});

test('maxCostPerDay: после превышения проверка пропускается', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ maxCostPerDay: 0.0005 }));
  for (let i = 0; i < 3; i++) runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'ok' });
  assert.equal(sb.fakeCalls().length, 2); // 0.0003 + 0.0003 >= 0.0005
  assert.match(sb.log(), /"verdict":"budget"/);
});

test('ruleTtlDays: правило вчерашнего дня живёт при ruleTtlDays=2', () => {
  const sb = sandbox();
  const st = { version: 1, windows: {}, waiting: [], promises: [], rules: [{ id: 'r1', date: '2026-11-13', ts: '', text: 'ВЧЕРАШНЕЕ-ПРАВИЛО' }], hintsSeen: [] };
  assert.ok(!buildPrompt('x', st, sb.env).includes('ВЧЕРАШНЕЕ-ПРАВИЛО'));
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ ruleTtlDays: 2 }));
  assert.ok(buildPrompt('x', st, sb.env).includes('ВЧЕРАШНЕЕ-ПРАВИЛО'));
});

// ---------- leo doctor: 5 из 5 поломок ----------
const doctor = (env, args = []) => runCli(['doctor', ...args], { ...env, ...EN });

test('doctor: здоровая среда — 0 исправлений, код 0', () => {
  const sb = sandbox();
  sb.write('STATUS.md', '# s');
  sb.write('MEMORY.md', '- a');
  const r = doctor(sb.env);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /0 to fix/);
  assert.match(r.stdout, /What leaves your machine/);
});

const BREAKS = {
  'нет claude': (sb) => ({ ...sb.env, LEO_CLAUDE: join(sb.dir, 'нет-такого', 'claude.exe') }),
  'нет прав записи': (sb) => { const f = join(sb.dir, 'file-not-dir'); writeFileSync(f, 'x'); return { ...sb.env, LEO_HOME: join(f, 'sub') }; },
  'битый config': (sb) => { writeFileSync(join(sb.home, 'config.json'), '{oops'); return sb.env; },
  'нет флага --safe-mode': (sb) => ({ ...sb.env, LEO_FAKE_NO_SAFE: '1' }),
  'нет Node 18': (sb) => ({ ...sb.env, LEO_DOCTOR_NODE: '16.20.2' }),
};
const WHAT = { 'нет claude': /claude was not found/, 'нет прав записи': /Cannot write to/, 'битый config': /config\.json problem/, 'нет флага --safe-mode': /no --safe-mode flag/, 'нет Node 18': /too old/ };
for (const [name, mk] of Object.entries(BREAKS)) {
  test('doctor ловит поломку: ' + name, () => {
    const sb = sandbox();
    const r = doctor(mk(sb));
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, WHAT[name]);
    assert.match(r.stdout, /\[FIX \]/);
  });
}

test('doctor --ping делает один пробный вызов и показывает время и цену', () => {
  const sb = sandbox();
  const r = doctor(sb.env, ['--ping']);
  assert.match(r.stdout, /Test call to Haiku: \d+ ms, cost \$0\.0003/);
  assert.equal(sb.fakeCalls().length, 1);
});

test('doctor по-русски при LEO_LANG=ru', () => {
  const sb = sandbox();
  const r = runCli(['doctor'], sb.env);
  assert.match(r.stdout, /Диагностика Leo/);
  assert.match(r.stdout, /Что уходит с вашей машины/);
});

test('status и log работают', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'skeptic' });
  assert.match(runCli(['status'], { ...sb.env, ...EN }).stdout, /Leo 0\.\d+\.\d+: language en, mode block/);
  const l = runCli(['log'], { ...sb.env, ...EN });
  assert.match(l.stdout, /1 blocks/);
  assert.match(l.stdout, /Cost \$0\.0003/);
  assert.match(runCli(['log'], { ...EN, LEO_HOME: join(sb.dir, 'empty') }).stdout, /No Leo events yet/);
});

// ---------- команды /leo:* и README ----------
for (const name of ['show', 'status', 'doctor', 'off', 'on']) {
  test('skill /leo:' + name + ' на месте и зовёт CLI', () => {
    const f = join(ROOT, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(f), f);
    const s = readFileSync(f, 'utf8');
    assert.match(s, /^---\r?\nname: /);
    assert.match(s, /description: /);
    assert.match(s, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/leo\.mjs/);
  });
}

test('README.md — английский; README.ru.md — русский; ссылки друг на друга', () => {
  const en = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const ru = readFileSync(join(ROOT, 'README.ru.md'), 'utf8');
  const cyr = (s) => (s.match(/[А-Яа-яЁё]/g) || []).length / s.length;
  assert.ok(cyr(en) < 0.01, 'README.md должен быть английским');
  assert.ok(cyr(ru) > 0.2, 'README.ru.md должен быть русским');
  assert.match(en, /README\.ru\.md/);
  assert.match(ru, /README\.md/);
});

test('README.md: обязательные разделы и раздел «What leaves your machine»', () => {
  const en = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const h of ['## Install', '## What leaves your machine', '## Configuration', '## Commands', '## Troubleshooting', '## Limitations', '## Why Leo']) assert.ok(en.includes(h), h);
  assert.match(en, /8000/);
  assert.match(en, /claude plugin install leo/);
  assert.match(en, /\/leo:doctor/);
  assert.match(en, /claude-mem/);
});

test('README.ru.md: те же главные разделы', () => {
  const ru = readFileSync(join(ROOT, 'README.ru.md'), 'utf8');
  for (const h of ['## Установка', '## Что уходит наружу', '## Настройки', '## Команды', '## Если не работает', '## Ограничения']) assert.ok(ru.includes(h), h);
});

test('plugin.json и marketplace.json: описание по-английски, версия совпадает с package.json', () => {
  const p = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.doesNotMatch(p.description, /[А-Яа-яЁё]/);
  assert.doesNotMatch(p.keywords.join(' '), /director/);
  const m = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(m), /[А-Яа-яЁё]/);
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version, p.version);
});
