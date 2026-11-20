import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, sandbox, runCli, FK } from './helpers.mjs';
import { redact } from '../lib/secrets.mjs';

const j = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('plugin.json: имя leo, kebab-case, нет лишнего', () => {
  const p = j('.claude-plugin/plugin.json');
  assert.equal(p.name, 'leo');
  assert.match(p.version, /^\d+\.\d+\.\d+$/);
  assert.ok(p.description);
});

test('marketplace.json: name, owner, plugins[leo] с относительным source', () => {
  const m = j('.claude-plugin/marketplace.json');
  assert.ok(m.name && m.owner?.name);
  const e = m.plugins.find((x) => x.name === 'leo');
  assert.ok(e);
  assert.ok(e.source === './' || e.source === '.' || e.source.startsWith('./'));
});

test('hooks.json: события SessionStart/PreCompact/PostCompact/Stop (нет хука на каждое сообщение), exec-форма node + CLAUDE_PLUGIN_ROOT, нужные matcher и таймауты', () => {
  const h = j('hooks/hooks.json').hooks;
  assert.deepEqual(Object.keys(h).sort(), ['PostCompact', 'PreCompact', 'SessionStart', 'Stop']);
  assert.equal(h.SessionStart[0].matcher, 'compact|resume');
  for (const [ev, file] of [['SessionStart', 'session-start.mjs'], ['Stop', 'stop.mjs']]) {
    const hk = h[ev][0].hooks[0];
    assert.equal(hk.type, 'command');
    assert.equal(hk.command, 'node');
    assert.deepEqual(hk.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/' + file]);
    assert.ok(existsSync(join(ROOT, 'hooks', file)));
    assert.ok(hk.timeout > 0);
  }
  assert.ok(h.Stop[0].hooks[0].timeout >= 50, 'Stop ждёт Haiku');
});

test('claude plugin validate проходит (если claude есть)', { skip: spawnSync('claude', ['--version'], { shell: process.platform === 'win32' }).status !== 0 }, () => {
  const r = spawnSync('claude', ['plugin', 'validate', ROOT], { encoding: 'utf8', shell: process.platform === 'win32' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('фильтр секретов', () => {
  for (const s of [FK.sk, FK.ghp, FK.pat, FK.xox, FK.akia, 'Bearer abcdefghijklmnop12345', FK.jwt])
    assert.ok(!redact('ключ ' + s + ' конец').includes(s), s);
  assert.ok(!redact('password: hunter2 и пароль = qwerty').match(/hunter2|qwerty/));
  assert.ok(!redact(FK.pem + '\nMIIabc\n-----END PRIVATE KEY-----').includes('MIIabc'));
  assert.equal(redact('обычный текст про PR 12'), 'обычный текст про PR 12');
});

test('CLI: окна, ожидание, обещания, правила, show', () => {
  const sb = sandbox();
  const run = (...a) => runCli(a, sb.env);
  assert.equal(run('window', 'set', 'alpha', 'working', 'кейс ×3').code, 0);
  assert.equal(run('wait', 'add', 'владелец: да на витрину').code, 0);
  assert.equal(run('promise', 'add', 'Проверить beta').code, 0);
  assert.equal(run('rule', 'add', 'Никогда без проверки').code, 0);
  const st = sb.state();
  assert.equal(st.windows.alpha.status, 'working');
  assert.equal(st.waiting.length, 1);
  assert.equal(st.promises.length, 1);
  assert.equal(st.rules.length, 1);
  const shown = run('show');
  assert.match(shown.stdout, /alpha/);
  assert.match(shown.stdout, /Проверить beta/);
  assert.equal(run('promise', 'done', st.promises[0].id).code, 0);
  assert.equal(sb.state().promises.length, 0);
  assert.equal(run('wait', 'done', st.waiting[0].id).code, 0);
  assert.equal(run('rule', 'drop', st.rules[0].id).code, 0);
  assert.equal(sb.state().rules.length, 0);
  assert.equal(run('window', 'drop', 'alpha').code, 0);
  assert.equal(Object.keys(sb.state().windows).length, 0);
});

test('CLI: ошибки аргументов — понятное сообщение, код 1, без падения', () => {
  const sb = sandbox();
  const r = runCli(['window', 'set'], sb.env);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /Использование|usage/i);
  assert.equal(runCli(['что-то'], sb.env).code, 1);
  assert.equal(runCli(['promise', 'done', 'нет-такого'], sb.env).code, 1);
});
