#!/usr/bin/env node
// CLI Leo: директор ведёт окна, ожидание, обещания и отмечает правила. Состояние — ~/.claude/leo/state.json.
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, saveState, leoHome, clean, newId, now, today, sameText, MAX } from '../lib/state.mjs';
import { buildRestore } from '../lib/restore.mjs';

const USAGE = `Использование: leo.mjs <команда>
  show                              показать то, что Leo вернёт после сжатия
  window set <имя> <статус> [заметка]   окно-сессия и его статус
  window drop <имя>
  wait add <текст>  | wait done <id>    что ждёт «да» владельца
  promise add <текст> | promise done <id>   обещано и не сделано
  rule add <текст> | rule drop <id>     правило владельца за сегодня (решает директор, Leo сам не пишет)
  off | on                          выключить / включить Leo (файл-выключатель)`;

const fail = (msg) => {
  process.stderr.write((msg ? msg + '\n' : '') + USAGE + '\n');
  process.exit(1);
};

const [, , cmd, sub, ...rest] = process.argv;
const env = process.env;
const text = (arr) => clean(arr.join(' '));

function removeById(list, id) {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) fail(`Не найдено: ${id}`);
  list.splice(i, 1);
}

try {
  if (cmd === 'show') {
    process.stdout.write(buildRestore('compact', env) + '\n');
  } else if (cmd === 'off' || cmd === 'on') {
    const dir = leoHome(env);
    mkdirSync(dir, { recursive: true });
    if (cmd === 'off') writeFileSync(join(dir, 'off'), 'выключено ' + now(env).toISOString() + '\n');
    else rmSync(join(dir, 'off'), { force: true });
    process.stdout.write(cmd === 'off' ? 'Leo выключен (хуки молчат).\n' : 'Leo включён.\n');
  } else if (['window', 'wait', 'promise', 'rule'].includes(cmd)) {
    const st = loadState(env);
    const ts = now(env).toISOString();
    if (cmd === 'window') {
      if (sub === 'set' && rest.length >= 2) {
        st.windows[clean(rest[0], 60)] = { status: clean(rest[1], 40), note: text(rest.slice(2)), ts };
      } else if (sub === 'drop' && rest.length >= 1) {
        delete st.windows[rest[0]];
      } else fail('Нужно: window set <имя> <статус> [заметка] | window drop <имя>');
    } else if (cmd === 'wait' || cmd === 'promise') {
      const key = cmd === 'wait' ? 'waiting' : 'promises';
      if (sub === 'add' && rest.length) {
        const t = text(rest);
        if (!st[key].some((x) => sameText(x.text, t))) st[key].push({ id: newId(cmd[0], env), text: t, ts });
        st[key] = st[key].slice(-MAX[key]);
      } else if (sub === 'done' && rest[0]) removeById(st[key], rest[0]);
      else fail(`Нужно: ${cmd} add <текст> | ${cmd} done <id>`);
    } else {
      if (sub === 'add' && rest.length) {
        const t = text(rest);
        if (!st.rules.some((r) => r.date === today(env) && sameText(r.text, t))) st.rules.push({ id: newId('r', env), date: today(env), ts, text: t });
      } else if (sub === 'drop' && rest[0]) removeById(st.rules, rest[0]);
      else fail('Нужно: rule add <текст> | rule drop <id>');
    }
    saveState(st, env);
    process.stdout.write('ок\n');
  } else fail(cmd ? `Неизвестная команда: ${cmd}` : '');
} catch (e) {
  process.stderr.write('Ошибка Leo: ' + (e?.message ?? e) + '\n');
  process.exit(1);
}
