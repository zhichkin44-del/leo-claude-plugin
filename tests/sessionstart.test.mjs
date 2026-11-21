import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, runHook, FK } from './helpers.mjs';

const STATUS = `# Как дела — 14.11 вечер

| Проект | Окно | К утру |
|---|---|---|
| Альфа | alpha (Sonnet) | кейс Gamma ×3 |
| Бета | beta (Sonnet) | тексты без «нельзя» |

## Вопрос (ответ — словом в чате)
1. **Поссум:** в какой стране живёт сестра?

## Твоё, когда будет минута
- gamma: карточку «Принять» пока не нажимай

## Деньги
~$42 за неделю
`;
const HANDOFF = `# Передача 14.11 день

## Ждёт
- PR 454 (узел 0.4.45) — скептик Haiku: 2 блокера
- Вега t_mwfxmsqv0e41 (Двойник 4а) — идёт

## Решил сам (14.11)
- FL.ru → авто
`;
const MEMORY = `- [ЧИТАТЬ ПЕРВЫМ: передача 14.11 день](h.md) — витрина слита
- [Перед итогом владельцу — Haiku-персона «владелец»](f.md) — он не оператор
`;
const input = (source) => ({ session_id: 's1', hook_event_name: 'SessionStart', source, transcript_path: 'x', cwd: '.' });
const ctx = (r) => r.json?.hookSpecificOutput?.additionalContext ?? '';

function full(sb) {
  sb.write('STATUS.md', STATUS);
  sb.write('HANDOFF-2026-11-14-day.md', HANDOFF);
  sb.write('HANDOFF-2026-11-13-night.md', '# старая\n## Ждёт\n- СТАРОЕ-НЕ-ДОЛЖНО-ПОПАСТЬ\n', new Date('2026-11-13T00:00:00+07:00'));
  sb.write('MEMORY.md', MEMORY);
  sb.setState({
    version: 1,
    windows: { alpha: { status: 'working', note: 'кейс ×3', ts: '2026-11-14T09:00:00+07:00' } },
    waiting: [{ id: 'w1', text: 'владелец: «да» на витрину проекта', ts: '2026-11-14T08:00:00+07:00' }],
    promises: [{ id: 'p1', text: 'Прогнать персону «владелец» на отчёте', ts: '2026-11-14T08:30:00+07:00' }],
    rules: [
      { id: 'r1', date: '2026-11-14', ts: '2026-11-14T07:00:00+07:00', text: 'Всегда проверять ссылку перед показом', memorized: false },
      { id: 'r0', date: '2026-11-13', ts: '2026-11-13T07:00:00+07:00', text: 'ВЧЕРАШНЕЕ-ПРАВИЛО', memorized: true },
    ],
  });
}

test('compact: returns windows, waiting, day rules, promises — in SessionStart format', () => {
  const sb = sandbox(); full(sb);
  const r = runHook('session-start.mjs', input('compact'), sb.env);
  assert.equal(r.code, 0);
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'SessionStart');
  const c = ctx(r);
  for (const s of ['alpha', 'Gamma', 'владелец: «да» на витрину проекта', 'PR 454', 'Всегда проверять ссылку', 'Прогнать персону', 'Haiku-персона'])
    assert.ok(c.includes(s), 'missing: ' + s);
  assert.ok(!c.includes('ВЧЕРАШНЕЕ-ПРАВИЛО'), 'yesterday\'s remembered rule must not be shown');
  assert.ok(!c.includes('СТАРОЕ-НЕ-ДОЛЖНО-ПОПАСТЬ'), 'only the fresh HANDOFF is used');
  assert.ok(!c.includes('~$42'), 'the "Money" section is not needed');
});

test('resume gives the same', () => {
  const sb = sandbox(); full(sb);
  const r = runHook('session-start.mjs', input('resume'), sb.env);
  assert.ok(ctx(r).includes('alpha'));
});

test('startup, clear, fork — silence', () => {
  const sb = sandbox(); full(sb);
  for (const s of ['startup', 'clear', 'fork']) {
    const r = runHook('session-start.mjs', input(s), sb.env);
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '', s);
  }
});

test('≤ 40 lines and < 9000 chars, even if the files are huge', () => {
  const sb = sandbox();
  const big = (n) => Array.from({ length: n }, (_, i) => `- строка ${i} ` + 'ж'.repeat(400)).join('\n');
  sb.write('STATUS.md', '# Как дела\n\n| Проект | Окно |\n|---|---|\n' + Array.from({ length: 200 }, (_, i) => `| П${i} | w${i} |`).join('\n') + '\n\n## Вопрос\n' + big(300));
  sb.write('HANDOFF-2026-11-14-day.md', '# П\n\n## Ждёт\n' + big(300));
  sb.write('MEMORY.md', big(300));
  const rules = Array.from({ length: 50 }, (_, i) => ({ id: 'r' + i, date: '2026-11-14', ts: '2026-11-14T07:00:00+07:00', text: 'правило ' + i, memorized: false }));
  sb.setState({ version: 1, windows: {}, waiting: [], promises: Array.from({ length: 50 }, (_, i) => ({ id: 'p' + i, text: 'обещание ' + i, ts: '2026-11-14T07:00:00+07:00' })), rules });
  const r = runHook('session-start.mjs', input('compact'), sb.env);
  const c = ctx(r);
  assert.ok(c.split('\n').length <= 40, 'lines: ' + c.split('\n').length);
  assert.ok(c.length < 9000, 'chars: ' + c.length);
  assert.ok(c.split('\n').every((l) => l.length <= 240));
});

test('no files and no state — a short honest line, exit code 0', () => {
  const sb = sandbox();
  const r = runHook('session-start.mjs', input('compact'), sb.env);
  assert.equal(r.code, 0);
  assert.match(ctx(r), /Leo/);
  assert.ok(ctx(r).split('\n').length <= 5);
});

test('stale STATUS (> 24 h) is marked as old', () => {
  const sb = sandbox();
  sb.write('STATUS.md', STATUS, new Date('2026-11-12T10:00:00+07:00'));
  const r = runHook('session-start.mjs', input('compact'), sb.env);
  assert.match(ctx(r), /устарел|старше суток/i);
});

test('secrets from files and state do not reach the context', () => {
  const sb = sandbox();
  sb.write('STATUS.md', STATUS + '\n## Вопрос\n- ключ ' + FK.sk + ' и password: hunter2\n');
  sb.setState({ version: 1, windows: {}, waiting: [{ id: 'w', text: `токен ${FK.ghp2}`, ts: '2026-11-14T08:00:00+07:00' }], promises: [], rules: [] });
  const c = ctx(runHook('session-start.mjs', input('compact'), sb.env));
  assert.ok(!new RegExp([FK.sk, 'hunter2', FK.ghp2.slice(0, 20)].join('|')).test(c));
});

test('malformed input: empty, null, array, non-JSON, number — exit code 0, no crash, silence', () => {
  const sb = sandbox(); full(sb);
  for (const bad of ['', 'null', '[]', 'не json', '42', '"строка"', '{"source":null}', '{"source":{}}']) {
    const r = runHook('session-start.mjs', bad, sb.env);
    assert.equal(r.code, 0, JSON.stringify(bad));
    assert.equal(r.stdout.trim(), '', 'silent on garbage input: ' + JSON.stringify(bad));
  }
});

test('broken state.json: exit code 0, carry on', () => {
  const sb = sandbox();
  sb.write('STATUS.md', STATUS);
  sb.write('home/state.json', '{не json');
  const r = runHook('session-start.mjs', input('compact'), sb.env);
  assert.equal(r.code, 0);
  assert.ok(ctx(r).includes('alpha'));
});

test('sources — a directory instead of a file, empty files: no crash', () => {
  const sb = sandbox();
  sb.write('STATUS.md/inner.txt', 'x'); // STATUS.md is a directory
  sb.write('MEMORY.md', '');
  const r = runHook('session-start.mjs', input('compact'), sb.env);
  assert.equal(r.code, 0);
});

test('failure inside the hook → journal entry and exit code 0', () => {
  const sb = sandbox(); full(sb);
  const r = runHook('session-start.mjs', input('compact'), { ...sb.env, LEO_TEST_CRASH: '1' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.match(sb.log(), /session-start/);
});

test('LEO_OFF=1 — silence', () => {
  const sb = sandbox(); full(sb);
  const r = runHook('session-start.mjs', input('compact'), { ...sb.env, LEO_OFF: '1' });
  assert.equal(r.stdout.trim(), '');
});
