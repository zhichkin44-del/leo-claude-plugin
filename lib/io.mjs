// Общий каркас хуков: чтение stdin, разбор JSON, защита «любая ошибка → журнал и тихий выход 0».

import { existsSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { logEvent, leoHome } from './state.mjs';

const MAX_STDIN = 4_000_000;

// stdin целиком, до 4 МБ; EAGAIN (неблокирующий канал) — короткие повторы, любой другой сбой → то, что успели прочесть.
export function readStdin() {
  const chunks = [];
  let total = 0;
  let spins = 0;
  const buf = Buffer.alloc(65536);
  for (;;) {
    let n;
    try {
      n = readSync(0, buf, 0, buf.length, null);
    } catch (e) {
      if (e?.code === 'EAGAIN' && spins++ < 200) {
        const until = Date.now() + 10;
        while (Date.now() < until) { /* пауза */ }
        continue;
      }
      if (e?.code === 'EOF') break;
      break;
    }
    if (n === 0) break;
    chunks.push(Buffer.from(buf.subarray(0, n)));
    total += n;
    if (total > MAX_STDIN) return ''; // слишком большой вход — не наш
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Возвращает объект или null (пусто, не-JSON, null, массив, число, строка).
export function parseInput(text) {
  try {
    const v = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

export function disabled(env = process.env) {
  if (env.LEO_OFF === '1' || env.LEO_INNER === '1') return true;
  try {
    return existsSync(join(leoHome(env), 'off')); // выключатель: файл ~/.claude/leo/off (команда `leo.mjs off`)
  } catch {
    return false;
  }
}

// Запускает run(input) и печатает результат. Любое исключение — в журнал, код 0, ничего не печатаем.
export async function runHook(name, run, env = process.env) {
  try {
    if (disabled(env)) return;
    const input = parseInput(readStdin());
    if (!input) return;
    if (env.LEO_TEST_CRASH === '1') throw new Error('тестовый сбой');
    const out = await run(input, env);
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (err) {
    logEvent(env, { event: 'error', hook: name, error: String(err?.stack ?? err).slice(0, 800) });
  }
  process.exitCode = 0;
}

export const additionalContext = (hookEventName, text) => ({ hookSpecificOutput: { hookEventName, additionalContext: text } });
