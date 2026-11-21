// Findings from the Haiku-skeptic review (14.11). Each one is a test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, runHook, FK } from './helpers.mjs';
import { redact } from '../lib/secrets.mjs';
import { loadState, normalize } from '../lib/state.mjs';

const input = { session_id: 's', hook_event_name: 'SessionStart', source: 'compact' };
const ctx = (r) => r.json?.hookSpecificOutput?.additionalContext ?? '';

test('secrets in JSON form, in URLs and Telegram/HF tokens are not let through', () => {
  const cases = ['"password": "hunter2xyz"', '{"api_key":"abcdef123456"}', "'token': 'tok123456'", 'https://user:pass1234@example.com/x', 'bot ' + FK.tg, FK.hf, FK.sbp];
  for (const c of cases) {
    const out = redact(c);
    assert.ok(!new RegExp(['hunter2xyz', 'abcdef123456', 'tok123456', 'pass1234', 'ABCdefGhIJKlmNoPQRsTUVwxyZ0123456789', FK.hf, FK.sbp].join('|')).test(out), c + ' → ' + out);
  }
  assert.equal(redact('обычный текст про PR 12 и токены'), 'обычный текст про PR 12 и токены');
});

test('record ids are shown in the output — a promise or waiting item can be closed by command', () => {
  const sb = sandbox();
  sb.setState({
    version: 1, windows: {},
    waiting: [{ id: 'wABC', text: 'владелец: да на витрину', ts: '2026-11-14T08:00:00+07:00' }],
    promises: [{ id: 'pXYZ', text: 'Проверить beta', ts: '2026-11-14T08:00:00+07:00' }],
    rules: [{ id: 'rQ1', date: '2026-11-14', ts: '2026-11-14T08:00:00+07:00', text: 'Без жаргона' }],
  });
  const c = ctx(runHook('session-start.mjs', input, sb.env));
  for (const id of ['wABC', 'pXYZ', 'rQ1']) assert.ok(c.includes(id), id);
});

test('Haiku-found promises older than 3 days are not shown, manual ones are shown', () => {
  const sb = sandbox();
  sb.setState({
    version: 1, windows: {}, waiting: [], rules: [],
    promises: [
      { id: 'pold', text: 'СТАРОЕ-АВТО', ts: '2026-11-09T08:00:00+07:00', auto: true },
      { id: 'pman', text: 'СТАРОЕ-РУЧНОЕ', ts: '2026-11-09T08:00:00+07:00' },
      { id: 'pnew', text: 'СВЕЖЕЕ-АВТО', ts: '2026-11-14T08:00:00+07:00', auto: true },
    ],
  });
  const c = ctx(runHook('session-start.mjs', input, sb.env));
  assert.ok(!c.includes('СТАРОЕ-АВТО'));
  assert.ok(c.includes('СТАРОЕ-РУЧНОЕ'));
  assert.ok(c.includes('СВЕЖЕЕ-АВТО'));
});

test('when windows overflow, the newest survive, not the oldest', () => {
  const windows = {};
  for (let i = 0; i < 31; i++) windows['w' + i] = { status: 'x', note: '', ts: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() };
  const st = normalize({ windows });
  assert.equal(Object.keys(st.windows).length, 30);
  assert.ok(st.windows.w30, 'new window kept');
  assert.ok(!st.windows.w0, 'oldest window evicted');
});

test('an old memorized/lastPrompt field in state.json does not get in the way', () => {
  const sb = sandbox();
  sb.setState({ version: 1, windows: {}, waiting: [], promises: [], rules: [{ id: 'r', date: '2026-11-14', ts: '', text: 'х', memorized: true }], lastPrompt: { text: 'старое', ts: '' } });
  const st = loadState(sb.env);
  assert.equal(st.rules.length, 1);
  assert.equal(st.lastPrompt, undefined);
});

test('huge stdin (> 4 MB) — hook is silent, exit code 0', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', 'x'.repeat(4_500_000), sb.env, { timeout: 20000 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('claude path with spaces and a nonexistent shell path — silent skip', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', { stop_hook_active: false, last_assistant_message: 'Готово: слил PR 12 в main и проверил на стенде, тесты зелёные. '.repeat(3) }, { ...sb.env, LEO_CLAUDE: 'C:/Program Files/нет такого/claude.exe' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.match(sb.log(), /claude-missing/);
});
