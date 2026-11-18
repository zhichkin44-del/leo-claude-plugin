import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sandbox, runHook, longReply, ROOT, FK } from './helpers.mjs';

const inp = (msg, extra = {}) => ({ session_id: 's', hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: msg, cwd: '.', ...extra });
const env = (sb, mode, more = {}) => ({ ...sb.env, LEO_FAKE_MODE: mode, ...more });

test('не итог (короткий ответ) — Haiku не зовём', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp('Ок, понял.'), env(sb, 'owner'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 0);
});

test('короткий, но с «слито/готово» и длиной ≥ 120 — это итог, зовём ровно один раз', () => {
  const sb = sandbox();
  const msg = 'Готово: PR 12 слит в main, тесты зелёные, стенд проверил. владелец, можешь смотреть витрину по ссылке на странице проекта, там же лежат снимки экрана.';
  assert.ok(msg.length >= 120);
  runHook('stop.mjs', inp(msg), env(sb, 'ok'));
  assert.equal(sb.fakeCalls().length, 1);
});

test('длинный ответ без слов-утверждений тоже итог (≥ 600 знаков)', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp('Вот разбор по пунктам. '.repeat(40)), env(sb, 'ok'));
  assert.equal(sb.fakeCalls().length, 1);
});

test('нет находок → тишина, код 0, один вызов, запись в журнал', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'ok'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 1);
  assert.match(sb.log(), /"event":"stop"/);
});

test('серьёзная находка «владельца» → decision block + reason с текстом находки', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'owner'));
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /нет кнопки «да\/нет»/);
  assert.match(r.json.reason, /владел/);
  assert.equal(sb.fakeCalls().length, 1);
});

test('серьёзная находка «скептика» → block', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'skeptic'));
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /нет номера коммита/);
  assert.match(r.json.reason, /скептик/i);
});

test('только мелкие находки → не блокируем', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'minor'));
  assert.equal(r.stdout.trim(), '');
});

test('защита от петли: stop_hook_active=true → никаких вызовов и блоков', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply(), { stop_hook_active: true }), env(sb, 'owner'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 0);
});

test('петля целиком: первый Stop блокирует, второй (stop_hook_active) пропускает — всего 1 вызов Haiku', () => {
  const sb = sandbox();
  const first = runHook('stop.mjs', inp(longReply()), env(sb, 'owner'));
  assert.equal(first.json.decision, 'block');
  const second = runHook('stop.mjs', inp(longReply('поправил '), { stop_hook_active: true }), env(sb, 'owner'));
  assert.equal(second.stdout.trim(), '');
  assert.equal(sb.fakeCalls().length, 1);
});

test('текст находок ограничен: не больше 3 находок, каждая ≤ 240 знаков', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'many'));
  assert.equal(r.json.decision, 'block');
  const lines = r.json.reason.split('\n').filter((l) => /^\d\./.test(l));
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.length <= 260));
});

test('ответ Haiku в «забор» ```json — принимаем', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'fenced'));
  assert.equal(r.json.decision, 'block');
});

test('Haiku вернул не JSON → тихий пропуск, код 0', () => {
  const sb = sandbox();
  for (const mode of ['garbage', 'rawgarbage']) {
    const r = runHook('stop.mjs', inp(longReply()), env(sb, mode));
    assert.equal(r.code, 0, mode);
    assert.equal(r.stdout.trim(), '', mode);
  }
});

test('Haiku упал (код 1) → тихий пропуск', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'fail'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.match(sb.log(), /haiku/i);
});

test('Haiku завис → таймаут, тихий пропуск, быстро', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hang', { LEO_HAIKU_TIMEOUT_MS: '1500' }), { timeout: 20000 });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.ok(r.ms < 10000, 'ушло ' + r.ms + ' мс');
  assert.match(sb.log(), /timeout/i);
});

test('claude не найден → тихий пропуск', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), { ...sb.env, LEO_CLAUDE: 'C:/нет/такого/claude-xyz' });
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('внутренний вызов (LEO_INNER=1) и LEO_OFF=1 — не зовём', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'owner', { LEO_INNER: '1' }));
  runHook('stop.mjs', inp(longReply()), env(sb, 'owner', { LEO_OFF: '1' }));
  assert.equal(sb.fakeCalls().length, 0);
});

test('Haiku запускается без хуков и инструментов, на haiku, JSON, с LEO_INNER', () => {
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

test('в Haiku уходит ответ без секретов + последние сообщения владельца из транскрипта + открытые обещания и правила дня', () => {
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

test('в запросе есть вопрос про новое устойчивое указание и пример-не-правило; слов-триггеров в коде нет', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'ok'));
  const input = sb.fakeCalls()[0].input;
  assert.match(input, /устойчив/i);
  assert.match(input, /никогда не видел такого красивого дизайна/);
  assert.match(input, /сомнева|не уверен/i);
  // слова-триггеры допустимы только внутри текста запроса к Haiku (строка в кавычках), но не в условиях/регулярках кода
  const bad = [];
  for (const f of ['lib/skeptic.mjs', 'lib/transcript.mjs', 'lib/restore.mjs', 'lib/io.mjs', 'lib/state.mjs', 'bin/leo.mjs', 'hooks/stop.mjs', 'hooks/session-start.mjs']) {
    readFileSync(join(ROOT, f), 'utf8').split('\n').forEach((l, n) => {
      if (/всегда|никогда|запомни|впредь/i.test(l) && !/^\s*('|\/\/)/.test(l)) bad.push(f + ':' + (n + 1) + ' ' + l.trim().slice(0, 80));
    });
  }
  assert.deepEqual(bad, [], 'слова-триггеры в коде');
});

test('подсказка о правиле без серьёзных находок → мягкая подсказка (additionalContext), не block, с оговоркой «проверь и реши»', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hint'));
  assert.equal(r.code, 0);
  assert.equal(r.json.decision, undefined);
  const c = r.json.hookSpecificOutput.additionalContext;
  assert.equal(r.json.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(c, /похоже на новое правило/i);
  assert.match(c, /Не сливать PR без проверки на стенде/);
  assert.match(c, /проверь и реши/i);
  assert.equal(sb.state()?.rules?.length ?? 0, 0, 'Leo сам правило не записывает');
});

test('подсказка вместе с серьёзной находкой → в причине block', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hintblock'));
  assert.equal(r.json.decision, 'block');
  assert.match(r.json.reason, /Отвечать короче/);
  assert.match(r.json.reason, /проверь и реши/i);
});

test('одну и ту же подсказку второй раз не повторяем; при stop_hook_active — тоже тихо', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'hint'));
  const r2 = runHook('stop.mjs', inp(longReply('ещё ')), env(sb, 'hint'));
  assert.equal(r2.stdout.trim(), '');
  const sb2 = sandbox();
  const r3 = runHook('stop.mjs', inp(longReply(), { stop_hook_active: true }), env(sb2, 'hint'));
  assert.equal(r3.stdout.trim(), '');
});

test('кривая подсказка (строка вместо объекта) — игнорируем', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'hintbad'));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
});

test('обещания из ответа скептика попадают в состояние (без дублей)', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp(longReply()), env(sb, 'promises'));
  runHook('stop.mjs', inp(longReply('ещё раз ')), env(sb, 'promises'));
  const texts = sb.state().promises.map((p) => p.text);
  assert.deepEqual(texts.sort(), ['Проверить окно alpha после обеда', 'Слить PR 12'].sort());
});

test('кривой вход: код 0, тишина, без вызова Haiku', () => {
  const sb = sandbox();
  for (const bad of ['', 'null', '[]', 'мусор', '{}', '{"last_assistant_message":null}', '{"last_assistant_message":42}', '{"last_assistant_message":{"a":1}}', '"строка"']) {
    const r = runHook('stop.mjs', bad, env(sb, 'owner'));
    assert.equal(r.code, 0, bad);
    assert.equal(r.stdout.trim(), '', bad);
  }
  assert.equal(sb.fakeCalls().length, 0);
});

test('сбой внутри хука → журнал и код 0, без блока', () => {
  const sb = sandbox();
  const r = runHook('stop.mjs', inp(longReply()), env(sb, 'owner', { LEO_TEST_CRASH: '1' }));
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.match(sb.log(), /stop/);
});

test('очень длинный ответ обрезается перед отправкой (≤ 8000 знаков в сообщении)', () => {
  const sb = sandbox();
  runHook('stop.mjs', inp('Готово. '.repeat(5000)), env(sb, 'ok'));
  assert.ok(sb.fakeCalls()[0].input.length < 14000);
});
