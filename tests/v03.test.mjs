import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, sandbox, runHook, runCli, longReply } from './helpers.mjs';
import { CATALOG, t, pickLang } from '../lib/i18n.mjs';
import { buildPrompt, parseVerdict, blockReason } from '../lib/skeptic.mjs';
import { validateConfig, loadConfig, DEFAULTS } from '../lib/config.mjs';
import { emptyState } from '../lib/state.mjs';

const EN = { LEO_LANG: 'en', LEO_PROFILE: 'default' };
const NOHOME = { LEO_HOME: join(ROOT, 'no-such-home-dir') };
const inp = (msg, extra = {}) => ({ session_id: 's', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg, ...extra });
const enReply = 'Done: merged PR 12 and verified on the staging server. '.repeat(14);

// ---------- i18n ----------
test('all messages exist in EN and RU: key sets match, 0 mismatches', () => {
  const en = Object.keys(CATALOG.en).sort();
  const ru = Object.keys(CATALOG.ru).sort();
  assert.deepEqual(en.filter((k) => !ru.includes(k)), [], 'missing in ru');
  assert.deepEqual(ru.filter((k) => !en.includes(k)), [], 'missing in en');
  for (const k of Object.keys(CATALOG['ru:director'])) assert.ok(en.includes(k), 'director profile: extra key ' + k);
});

test('every t(...) key used in code exists in the catalog', () => {
  const files = [...readdirSync(join(ROOT, 'lib')).map((f) => join(ROOT, 'lib', f)), join(ROOT, 'bin', 'leo.mjs')];
  const used = new Set();
  for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\bt\('(\w+)'/g)) used.add(m[1]);
  for (const k of used) assert.ok(k in CATALOG.en, 'missing key ' + k);
  assert.ok(used.size > 40);
});

test('language: LEO_LANG wins, then config.json, then locale; default en', () => {
  const sb = sandbox();
  const base = { LEO_HOME: sb.home };
  assert.equal(pickLang({ ...base, LEO_LANG: 'ru' }), 'ru');
  assert.equal(pickLang({ ...base, LANG: 'ru_RU.UTF-8' }), 'ru');
  assert.equal(pickLang({ ...base, LANG: 'en_US.UTF-8' }), 'en');
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ lang: 'ru' }));
  assert.equal(pickLang({ ...base, LANG: 'en_US' }), 'ru');
  assert.equal(pickLang({ ...base, LEO_LANG: 'en', LANG: 'en_US' }), 'en');
});

test('t(): variable substitution and fallback for unknown keys', () => {
  assert.equal(t('docNode', { LEO_LANG: 'en', ...NOHOME }, { v: '20.1.0' }), 'Node.js 20.1.0 (need >= 18)');
  assert.match(t('docNode', { LEO_LANG: 'ru', ...NOHOME }, { v: '20.1.0' }), /нужен/);
  assert.equal(t('нет-такого-ключа', { LEO_LANG: 'en', ...NOHOME }), 'нет-такого-ключа');
});

// ---------- prompt without internal jargon ----------
test('EN Haiku prompt: in English, without author jargon', () => {
  const sb = sandbox();
  const p = buildPrompt(enReply, emptyState(), { ...sb.env, ...EN }, ['fix the login page']);
  assert.doesNotMatch(p, /[А-Яа-яЁё]/);
  assert.doesNotMatch(p, /director|owner|not a programmer/i);
  assert.match(p, /reader/);
  assert.match(p, /skeptic/);
  assert.match(p, /fix the login page/);
});

test('RU prompt is neutral by default; the director/owner jargon appears only in the director profile', () => {
  const sb = sandbox();
  const msg = 'Готово: слил PR 12. '.repeat(10);
  const neutral = buildPrompt(msg, emptyState(), { ...sb.env, LEO_LANG: 'ru', LEO_PROFILE: 'default' }, []);
  assert.doesNotMatch(neutral, /директор|владел|не программист/i);
  assert.match(neutral, /пользовател/);
  const dir = buildPrompt(msg, emptyState(), { ...sb.env, LEO_LANG: 'ru', LEO_PROFILE: 'director' }, []);
  assert.match(dir, /владел/);
});

test('code contains no hard-coded jargon outside the profile dictionary', () => {
  for (const f of ['skeptic.mjs', 'restore.mjs', 'haiku.mjs', 'io.mjs', 'doctor.mjs', 'config.mjs']) {
    assert.doesNotMatch(readFileSync(join(ROOT, 'lib', f), 'utf8'), /директор|владел|не программист/i, f);
  }
});

test('verdict parser understands the reader key and the old owner key', () => {
  const a = parseVerdict(JSON.stringify({ reader: { issues: [{ severity: 'serious', text: 'jargon' }] }, skeptic: { issues: [] } }));
  const b = parseVerdict(JSON.stringify({ owner: { issues: [{ severity: 'serious', text: 'jargon' }] }, skeptic: { issues: [] } }));
  assert.equal(a.issues[0].role, 'reader');
  assert.equal(b.issues[0].role, 'reader');
  assert.match(blockReason(a.issues, null, { LEO_LANG: 'en', ...NOHOME }), /\[reader\] jargon/);
});

test('EN: block message in English; English final answer is checked too', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(enReply), { ...sb.env, ...EN, LEO_MODE: 'block', LEO_FAKE_MODE: 'skeptic' });
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /Leo's check/);
  assert.doesNotMatch(r.json.reason, /Проверка Leo/);
  assert.equal(sb.fakeCalls().length, 1);
});

// ---------- settings ----------
test('config.json: schema is validated, errors are clear', () => {
  assert.deepEqual(validateConfig({ mode: 'advice', minLength: 300, roles: { reader: false }, triggers: ['ship it'], model: 'haiku' }), []);
  const bad = validateConfig({ mode: 'loud', minLength: -1, roles: { boss: true }, nope: 1, log: 'yes' });
  assert.equal(bad.length, 5);
  JSON.parse(readFileSync(join(ROOT, 'docs', 'config.schema.json'), 'utf8'));
});

test('bad values in config.json are ignored instead of breaking the hook', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ mode: 'loud', minLength: 'abc', model: 'sonnet' }));
  const c = loadConfig(sb.env);
  assert.equal(c.mode, 'advice');
  assert.equal(c.minLength, 600);
  assert.equal(c.model, 'sonnet');
  writeFileSync(join(sb.home, 'config.json'), '{not json');
  assert.equal(loadConfig(sb.env).mode, 'advice');
});

test('default mode for new users is advice (no config.json and no LEO_MODE)', () => {
  const sb = sandbox();
  assert.equal(loadConfig(sb.env).mode, 'advice');
  assert.equal(DEFAULTS.mode, 'advice');
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'docs', 'config.schema.json'), 'utf8')).properties.mode.default, 'advice');
});

test('mode advice: serious finding gives a hint without block', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ mode: 'advice' }));
  const r = runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'skeptic' });
  assert.equal(r.json.decision, undefined);
  assert.match(r.json.hookSpecificOutput.additionalContext, /нет номера коммита/);
  assert.match(sb.log(), /"verdict":"advice"/);
});

test('model and minLength from config.json reach the call', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ model: 'sonnet', minLength: 200 }));
  runHook('stop.mjs', inp('Вот разбор по пунктам. '.repeat(10)), { ...sb.env, LEO_FAKE_MODE: 'ok' });
  const calls = sb.fakeCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf('--model') + 1], 'sonnet');
});

test('roles: both off, Haiku is not called; reader off, its findings do not block', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ roles: { reader: false, skeptic: false } }));
  runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'owner' });
  assert.equal(sb.fakeCalls().length, 0);
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ roles: { reader: false } }));
  const r = runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'owner' });
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 1);
});

test('maxCostPerDay: after the limit is exceeded, the check is skipped', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ maxCostPerDay: 0.0005 }));
  for (let i = 0; i < 3; i++) runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'ok' });
  assert.equal(sb.fakeCalls().length, 2); // 0.0003 + 0.0003 >= 0.0005
  assert.match(sb.log(), /"verdict":"budget"/);
});

test('ruleTtlDays: yesterday\'s rule stays alive with ruleTtlDays=2', () => {
  const sb = sandbox();
  const st = { version: 1, windows: {}, waiting: [], promises: [], rules: [{ id: 'r1', date: '2026-11-13', ts: '', text: 'ВЧЕРАШНЕЕ-ПРАВИЛО' }], hintsSeen: [] };
  assert.ok(!buildPrompt('x', st, sb.env).includes('ВЧЕРАШНЕЕ-ПРАВИЛО'));
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ ruleTtlDays: 2 }));
  assert.ok(buildPrompt('x', st, sb.env).includes('ВЧЕРАШНЕЕ-ПРАВИЛО'));
});

// ---------- leo doctor: 5 of 5 breakages ----------
const doctor = (env, args = []) => runCli(['doctor', ...args], { ...env, ...EN });

test('doctor: healthy environment — 0 fixes, exit code 0', () => {
  const sb = sandbox();
  sb.write('STATUS.md', '# s');
  sb.write('MEMORY.md', '- a');
  const r = doctor(sb.env);
  assert.equal(r.code, 0, r.stdout);
  assert.match(r.stdout, /0 to fix/);
  assert.match(r.stdout, /What leaves your machine/);
});

const BREAKS = {
  'no claude': (sb) => ({ ...sb.env, LEO_CLAUDE: join(sb.dir, 'нет-такого', 'claude.exe') }),
  'no write access': (sb) => { const f = join(sb.dir, 'file-not-dir'); writeFileSync(f, 'x'); return { ...sb.env, LEO_HOME: join(f, 'sub') }; },
  'broken config': (sb) => { writeFileSync(join(sb.home, 'config.json'), '{oops'); return sb.env; },
  'no --safe-mode flag': (sb) => ({ ...sb.env, LEO_FAKE_NO_SAFE: '1' }),
  'no Node 18': (sb) => ({ ...sb.env, LEO_DOCTOR_NODE: '16.20.2' }),
};
const WHAT = { 'no claude': /claude was not found/, 'no write access': /Cannot write to/, 'broken config': /config\.json problem/, 'no --safe-mode flag': /no --safe-mode flag/, 'no Node 18': /too old/ };
for (const [name, mk] of Object.entries(BREAKS)) {
  test('doctor catches breakage: ' + name, () => {
    const sb = sandbox();
    const r = doctor(mk(sb));
    assert.equal(r.code, 1, r.stdout);
    assert.match(r.stdout, WHAT[name]);
    assert.match(r.stdout, /\[FIX \]/);
  });
}

test('doctor --ping makes one test call and shows time and cost', () => {
  const sb = sandbox();
  const r = doctor(sb.env, ['--ping']);
  assert.match(r.stdout, /Test call to Haiku: \d+ ms, cost \$0\.0003/);
  assert.equal(sb.fakeCalls().length, 1);
});

test('doctor in Russian when LEO_LANG=ru', () => {
  const sb = sandbox();
  const r = runCli(['doctor'], sb.env);
  assert.match(r.stdout, /Диагностика Leo/);
  assert.match(r.stdout, /Что уходит с вашей машины/);
});

test('status and log work', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_FAKE_MODE: 'skeptic' });
  assert.match(runCli(['status'], { ...sb.env, ...EN }).stdout, /Leo 0\.\d+\.\d+: language en, mode advice/);
  const l = runCli(['log'], { ...sb.env, ...EN });
  assert.match(l.stdout, /1 blocks/);
  assert.match(l.stdout, /Cost \$0\.0003/);
  assert.match(runCli(['log'], { ...EN, LEO_HOME: join(sb.dir, 'empty') }).stdout, /No Leo events yet/);
});

// ---------- /leo:* commands and README ----------
for (const name of ['show', 'status', 'doctor', 'off', 'on']) {
  test('skill /leo:' + name + ' is in place and calls the CLI', () => {
    const f = join(ROOT, 'skills', name, 'SKILL.md');
    assert.ok(existsSync(f), f);
    const s = readFileSync(f, 'utf8');
    assert.match(s, /^---\r?\nname: /);
    assert.match(s, /description: /);
    assert.match(s, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/leo\.mjs/);
  });
}

test('README.md is in English', () => {
  const en = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const cyr = (s) => (s.match(/[А-Яа-яЁё]/g) || []).length / s.length;
  assert.ok(cyr(en) < 0.01, 'README.md must be in English');
});

test('README.md: required sections and the "What leaves your machine" section', () => {
  const en = readFileSync(join(ROOT, 'README.md'), 'utf8');
  for (const h of ['## Install', '## What leaves your machine', '## Configuration', '## Commands', '## Troubleshooting', '## Limitations', '## Why Leo']) assert.ok(en.includes(h), h);
  assert.match(en, /8000/);
  assert.match(en, /claude plugin install leo/);
  assert.match(en, /\/leo:doctor/);
  assert.match(en, /claude-mem/);
});

test('plugin.json and marketplace.json: description in English, version matches package.json', () => {
  const p = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.doesNotMatch(p.description, /[А-Яа-яЁё]/);
  assert.doesNotMatch(p.keywords.join(' '), /director/);
  const m = JSON.parse(readFileSync(join(ROOT, '.claude-plugin', 'marketplace.json'), 'utf8'));
  assert.doesNotMatch(JSON.stringify(m), /[А-Яа-яЁё]/);
  assert.equal(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version, p.version);
});
