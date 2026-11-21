import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, runHook, longReply, ROOT, FK } from './helpers.mjs';

const inp = (msg, extra = {}) => ({ session_id: 's', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg, cwd: '.', ...extra });
// LEO_MODE=block: these tests check blocking; the default mode is advice.
const env = (sb, mode, more = {}) => ({ ...sb.env, LEO_FAKE_MODE: mode, LEO_MODE: 'block', ...more });

test('not a final answer (short reply) — Haiku is not called', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp('Ок, понял.'), env(sb, 'owner'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 0);
});

test('short but with "merged/done" and length ≥ 120 — a final answer, called exactly once', () => {
  const sb = sandbox();
  const msg = 'Готово: PR 12 слит в main, тесты зелёные, стенд проверил. владелец, можешь смотреть витрину по ссылке на странице проекта, там же лежат снимки экрана.';
  assert.ok(msg.length >= 120);
  runHook('stop.mjs', inp(msg), env(sb, 'ok'));
  assert.equal(sb.fakeCalls().length, 1);
});

test('a long reply without claim words is also a final answer (≥ 600 chars)', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp('Вот разбор по пунктам. '.repeat(40)), env(sb, 'ok'));
  assert.equal(sb.fakeCalls().length, 1);
});

test('no findings → silence, exit code 0, one call, journal entry', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'ok'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 1);
  assert.match(sb.log(), /"event":"stop"/);
});

test('serious "owner" finding → decision block + reason with the finding text', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'owner'));
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /нет кнопки «да\/нет»/);
  assert.match(r.json.reason, /владел/);
  assert.equal(sb.fakeCalls().length, 1);
});

test('serious "skeptic" finding → block', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'skeptic'));
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /нет номера коммита/);
  assert.match(r.json.reason, /скептик/i);
});

test('only minor findings → do not block', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'minor'));
  assert.equal(r.stdout.trim(), '');
});

test('loop guard: stop_hook_active=true → no calls and no blocks', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply(), { stop_hook_active: true }), env(sb, 'owner'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 0);
});

test('whole loop: first Stop blocks, second (stop_hook_active) passes — 1 Haiku call in total', () => {
  const sb = sandbox();
  const first = runHook('stop.mjs', inp(longReply()), env(sb, 'owner'));
  assert.equal(first.json.decision, 'block');
  const second = runHook('stop.mjs', inp(longReply('поправил '), { stop_hook_active: true }), env(sb, 'owner'));
  assert.equal(second.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 1);
});

test('finding text is limited: at most 3 findings, each ≤ 240 chars', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'many'));
  assert.equal(r.json.decision, 'block');
  const lines = r.json.reason.split('\n').filter((l) => /^\d\./.test(l));
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.length <= 260));
});

test('Haiku reply wrapped in a ```json fence — accepted', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'fenced'));
  assert.equal(r.json.decision, 'block');
});

test('Haiku returned non-JSON → silent skip, exit code 0', () => {
  const sb = sandbox();
  for (const mode of ['garbage', 'rawgarbage']) {
    const r = runHook('stop.mjs', inp(longReply()), env(sb, mode));
    assert.equal(r.code, 0, mode);
    assert.equal(r.stdout.trim(), '', mode);
  }
});

test('Haiku failed (exit code 1) → silent skip', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'fail'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.match(sb.log(), /haiku/i);
});

test('Haiku hung → timeout, silent skip, fast', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hang', { LEO_HAIKU_TIMEOUT_MS: '1500' }), { timeout: 20000 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.ok(r.ms < 10000, 'took ' + r.ms + ' ms');
  assert.match(sb.log(), /timeout/i);
});

test('claude not found → silent skip', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_CLAUDE: 'C:/нет/такого/claude-xyz' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('inner call (LEO_INNER=1) and LEO_OFF=1 — not called', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'owner', { LEO_INNER: '1' }));
  runHook('stop.mjs', inp(longReply()), env(sb, 'owner', { LEO_OFF: '1' }));
  assert.equal(sb.fakeCalls().length, 0);
});

test('Haiku runs without hooks and tools, on haiku, JSON, with LEO_INNER', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'ok'));
  const c = sb.fakeCalls()[0];
  const a = c.args.join(' ');
  assert.match(a, /-p/);
  assert.match(a, /--safe-mode/);
  assert.match(a, /--model haiku/);
  assert.match(a, /--output-format json/);
  assert.match(a, /--no-session-persistence/);
  assert.match(a, /--disallowedTools \*/);
  assert.equal(c.inner, '1');
});

const userLine = (content, extra = {}) => JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content }, ...extra });

test('Haiku receives the reply without secrets + the owner\'s last messages from the transcript + open promises and day rules', () => {
  const sb = sandbox();
  sb.setState({
    version: 1, windows: {}, waiting: [],
    promises: [{ id: 'p1', text: 'ПРОВЕРИТЬ-ОКНО-БЕТА', ts: '2026-11-14T08:00:00+07:00' }],
    rules: [{ id: 'r1', date: '2026-11-14', ts: '2026-11-14T08:00:00+07:00', text: 'ПРАВИЛО-БЕЗ-ЖАРГОНА' }],
  });
  const tr = sb.write('tr.jsonl', [userLine('ВОПРОС-ВЛАДЕЛЬЦА-СКАЖИ-СТАТУС, password: hunter2')].join('\n'));
  runHook('stop.mjs', inp(longReply(`ключ ${FK.sk} `), { transcript_path: tr }), env(sb, 'ok'));
  const input = sb.fakeCalls()[0].input;
  for (const s of ['ПРОВЕРИТЬ-ОКНО-БЕТА', 'ПРАВИЛО-БЕЗ-ЖАРГОНА', 'ВОПРОС-ВЛАДЕЛЬЦА-СКАЖИ-СТАТУС', 'Сделано: слил PR 12'])
    assert.ok(input.includes(s), s);
  assert.ok(!input.includes(FK.sk));
  assert.ok(!input.includes('hunter2'));
  assert.match(input, /владелец/);
  assert.match(input, /скептик/i);
});

test('the request asks about a new standing instruction and a non-rule example; no trigger words in code', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'ok'));
  const input = sb.fakeCalls()[0].input;
  assert.match(input, /устойчив/i);
  assert.match(input, /никогда не видел такого красивого дизайна/);
  assert.match(input, /сомнева|не уверен/i);
  // trigger words are allowed only inside the request text to Haiku (a quoted string), not in code conditions or regexes
  const bad = [];
  for (const f of ['lib/skeptic.mjs', 'lib/transcript.mjs', 'lib/restore.mjs', 'lib/io.mjs', 'lib/state.mjs', 'bin/leo.mjs', 'hooks/stop.mjs', 'hooks/session-start.mjs']) {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((l, n) => {
      if (/всегда|никогда|запомни|впредь/i.test(l) && !/^\s*('|\/\/)/.test(l)) bad.push(f + ':' + (n + 1) + ' ' + l.trim().slice(0, 80));
    });
  }
  assert.deepEqual(bad, [], 'trigger words in code');
});

test('rule hint without serious findings → soft hint (additionalContext), not block, with the "check and decide" caveat', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hint'));
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, undefined);
  const c = r.json.hookSpecificOutput.additionalContext;
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(c, /похоже на новое правило/i);
  assert.match(c, /Не сливать PR без проверки на стенде/);
  assert.match(c, /проверь и реши/i);
  assert.equal(sb.state()?.rules?.length ?? 0, 0, 'Leo does not write the rule itself');
});

test('hint together with a serious finding → in the block reason', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hintblock'));
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /Отвечать короче/);
  assert.match(r.json.reason, /проверь и реши/i);
});

test('the same hint is not repeated the second time; with stop_hook_active — also silent', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'hint'));
  const r2 = runHook('stop.mjs', inp(longReply('ещё ')), env(sb, 'hint'));
  assert.equal(r2.stdout.trim(), '');
  const sb2 = sandbox();
  const r3 = runHook('stop.mjs', inp(longReply(), { stop_hook_active: true }), env(sb2, 'hint'));
  assert.equal(r3.stdout.trim(), '');
});

test('malformed hint (string instead of object) — ignored', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hintbad'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('promises from the skeptic reply go into the state (no duplicates)', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'promises'));
  runHook('stop.mjs', inp(longReply('ещё раз ')), env(sb, 'promises'));
  const texts = sb.state().promises.map((p) => p.text);
  assert.deepEqual(texts.sort(), ['Проверить окно alpha после обеда', 'Слить PR 12'].sort());
});

test('malformed input: exit code 0, silence, no Haiku call', () => {
  const sb = sandbox();
  for (const bad of ['', 'null', '[]', 'мусор', '{}', '{"last_assistant_message":null}', '{"last_assistant_message":42}', '{"last_assistant_message":{"a":1}}', '"строка"']) {
    const r = runHook('stop.mjs', bad, env(sb, 'owner'));
    assert.equal(r.code, 0, bad);
    assert.equal(r.stdout.trim(), '', bad);
  }
  assert.equal(sb.fakeCalls().length, 0);
});

test('failure inside the hook → journal entry and exit code 0, no block', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'owner', { LEO_TEST_CRASH: '1' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.match(sb.log(), /stop/);
});

test('a very long reply is truncated before sending (≤ 8000 chars in the message)', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp('Готово. '.repeat(5000)), env(sb, 'ok'));
  assert.ok(sb.fakeCalls()[0].input.length < 14000);
});
