import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, sandbox, runHook, runCli } from './helpers.mjs';
import { isSummary } from '../lib/skeptic.mjs';

test('docs/leo-docs-quotes.md (quotes from third-party docs) removed from the repository', () => {
  assert.equal(existsSync(join(ROOT, 'docs', 'leo-docs-quotes.md')), false);
});

test('permissions: state.json and leo.log are created with 0600 (on Windows — profile ACL, check skipped)', { skip: process.platform === 'win32' }, () => {
  const sb = sandbox();
  runCli(['rule', 'add', 'тест'], sb.env);
  runHook('stop.mjs', { stop_hook_active: false, last_assistant_message: 'Done: merged PR 12 and tests pass. '.repeat(10) }, sb.env);
  for (const f of ['state.json', 'leo.log']) {
    assert.equal(statSync(join(sb.home, f)).mode & 0o777, 0o600, f);
  }
});

test('the journal does not contain reply or message texts', () => {
  const sb = sandbox();
  const marker = 'UNIQUEMARKER' + 'XYZ123';
  runHook('stop.mjs', { stop_hook_active: false, last_assistant_message: `Done: merged ${marker} into main. `.repeat(10) }, { ...sb.env, LEO_FAKE_MODE: 'skeptic' });
  const log = sb.log();
  assert.ok(log.includes('"verdict"'), 'journal must be written: ' + log);
  assert.ok(!log.includes(marker));
});

test('LEO_NO_LOG=1: the journal is not written', () => {
  const sb = sandbox();
  runHook('stop.mjs', { stop_hook_active: false, last_assistant_message: 'Done: merged PR 12 and tests pass. '.repeat(10) }, { ...sb.env, LEO_NO_LOG: '1' });
  assert.equal(sb.log(), '');
});

const EN_CLAIMS = ['I fixed the bug in the parser and updated the docs for it. All good now', 'Finished the refactor of the module and moved the helpers to a new file', 'The feature is shipped to production and everything works as expected here', 'Everything is done and merged into main branch after the review', 'Tests pass and the deployment is complete, no further action is required today', 'This works now and is verified'];
for (const msg of EN_CLAIMS) {
  test('English final answer is recognized: ' + msg.slice(0, 40), () => {
    const padded = msg.length >= 120 ? msg : msg + ' ' + 'x'.repeat(120 - msg.length);
    assert.equal(isSummary(padded), true);
  });
}
test('RU triggers still work, a plain short text does not', () => {
  assert.equal(isSummary('Готово: слил PR 12, проверил на стенде, всё работает как задумано и проверено сегодня вечером и утром, ещё раз все файлы и тесты'), true);
  assert.equal(isSummary('ok'), false);
  assert.equal(isSummary('Just a remark without any claims that is about one hundred twenty characters long, give or take a few more words'), false);
});

test('no network calls: no fetch, http, net or eval in the code', () => {
  const files = [...readdirSync(join(ROOT, 'lib')).map((f) => join(ROOT, 'lib', f)), ...readdirSync(join(ROOT, 'hooks')).filter((f) => f.endsWith('.mjs')).map((f) => join(ROOT, 'hooks', f)), join(ROOT, 'bin', 'leo.mjs')];
  for (const f of files) {
    const t = readFileSync(f, 'utf8');
    assert.doesNotMatch(t, /\bfetch\s*\(|node:https?|node:net\b|node:dgram|\beval\s*\(|new Function\s*\(/, f);
  }
});

test('package.json: 0 dependencies', () => {
  const p = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(Object.keys(p.dependencies ?? {}).length + Object.keys(p.devDependencies ?? {}).length, 0);
});

test('git history: 0 findings from the secret scanner', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'scan-history.mjs')], { encoding: 'utf8', cwd: ROOT });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /0 находок|0 findings/);
});

test('stdin is read asynchronously: no busy-wait in io.mjs', () => {
  assert.doesNotMatch(readFileSync(join(ROOT, 'lib', 'io.mjs'), 'utf8'), /while \(Date\.now\(\) < until\)/);
});
