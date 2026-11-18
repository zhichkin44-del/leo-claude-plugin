// Последние настоящие сообщения владельца из транскрипта сессии (jsonl). Читаем только хвост файла; любой сбой → [].
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { clean } from './state.mjs';

const TAIL_BYTES = 3_000_000;
const SERVICE = /^\s*<(?:system-reminder|task-notification|side-sessions-event|ci-monitor-event|cross-session-message|command-name|command-message|local-command|user-prompt-submit-hook|pasted_content)/i;

export function isServiceMessage(text) {
  return SERVICE.test(text);
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const c of content) {
    if (c && typeof c === 'object' && c.type === 'text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join(' ');
}

function readTail(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

// → до n последних сообщений владельца (старые первыми), каждое ≤ 600 знаков, без секретов
export function recentUserMessages(path, n = 3) {
  try {
    if (typeof path !== 'string' || !path) return [];
    const lines = readTail(path).split(/\r?\n/);
    const out = [];
    for (let i = lines.length - 1; i >= 0 && out.length < n; i--) {
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (!o || typeof o !== 'object' || o.type !== 'user' || o.isSidechain === true) continue;
      const text = textOf(o.message?.content).trim();
      if (!text || isServiceMessage(text)) continue;
      out.unshift(clean(text, 600));
    }
    return out;
  } catch {
    return [];
  }
}
