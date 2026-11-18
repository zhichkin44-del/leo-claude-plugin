import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox, FK } from './helpers.mjs';
import { recentUserMessages } from '../lib/transcript.mjs';

const user = (content, extra = {}) => JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content }, ...extra });

test('берёт последние настоящие сообщения владельца: строка и массив text-блоков, в порядке времени', () => {
  const sb = sandbox();
  const p = sb.write('t.jsonl', [
    user('первое'),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'ответ' }] } }),
    user([{ type: 'text', text: 'второе' }, { type: 'text', text: 'и ещё' }]),
    user('третье'),
  ].join('\n'));
  assert.deepEqual(recentUserMessages(p, 2), ['второе и ещё', 'третье']);
});

test('пропускает tool_result, служебные теги, сообщения подагентов, не-user строки и мусор', () => {
  const sb = sandbox();
  const p = sb.write('t.jsonl', [
    user('НАСТОЯЩЕЕ'),
    user([{ type: 'tool_result', tool_use_id: 'x', content: 'вывод' }]),
    user('<system-reminder>Linked sessions</system-reminder>'),
    user('<task-notification>готово</task-notification>'),
    user('<cross-session-message from="x">привет</cross-session-message>'),
    user('из подагента', { isSidechain: true }),
    'null', '42', '"строка"', '[]', '{битая строка', '', JSON.stringify({ type: 'queue-operation', content: 'x' }),
    JSON.stringify({ type: 'user', message: null }), JSON.stringify({ type: 'user' }),
  ].join('\n'));
  assert.deepEqual(recentUserMessages(p, 3), ['НАСТОЯЩЕЕ']);
});

test('нет файла, пустой путь, каталог, не строка — пустой список без падения', () => {
  const sb = sandbox();
  for (const p of ['C:/нет/файла.jsonl', '', undefined, null, 5, sb.dir]) assert.deepEqual(recentUserMessages(p, 3), []);
});

test('обрезает длинные сообщения, прячет секреты, читает только хвост большого файла', () => {
  const sb = sandbox();
  const big = JSON.stringify({ type: 'api-request-blob', blob: 'x'.repeat(4_000_000) });
  const p = sb.write('t.jsonl', [user('СТАРОЕ'), big, user('Проверь ' + 'я'.repeat(2000) + ' password: hunter2'), user('ключ ' + FK.sk)].join('\n'));
  const out = recentUserMessages(p, 3);
  assert.ok(out.every((m) => m.length <= 600));
  assert.ok(!out.join('').includes('hunter2'));
  assert.ok(!out.join('').includes(FK.sk));
});
