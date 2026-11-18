// Возврат главного после сжатия: окна, что ждёт «да», правила дня, обещанное. ≤ 40 строк.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, leoHome, now, today } from './state.mjs';
import { redact } from './secrets.mjs';

export const MAX_LINES = 40;
const PROMISE_TTL_MS = 3 * 24 * 3600 * 1000;
const MAX_LINE = 220;

// Источники по умолчанию не заданы: нет настройки — источник молча пропускается.
const DEFAULT_SOURCES = { status: '', handoffDir: '', memoryIndex: '' };

// Источники: env → ~/.claude/leo/config.json → пусто. Нет файла — источник просто пропускается.
export function sources(env = process.env) {
  let cfg = {};
  try {
    const c = JSON.parse(readFileSync(join(leoHome(env), 'config.json'), 'utf8'));
    if (c && typeof c === 'object' && c.sources && typeof c.sources === 'object') cfg = c.sources;
  } catch { /* нет конфига */ }
  const pick = (k, e) => (typeof env[e] === 'string' && env[e]) || (typeof cfg[k] === 'string' && cfg[k]) || DEFAULT_SOURCES[k];
  return { status: pick('status', 'LEO_STATUS'), handoffDir: pick('handoffDir', 'LEO_HANDOFF_DIR'), memoryIndex: pick('memoryIndex', 'LEO_MEMORY_INDEX') };
}

function readText(path) {
  try {
    if (!statSync(path).isFile()) return null;
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
const mtime = (p) => {
  try { return statSync(p).mtime; } catch { return null; }
};

function newestHandoff(dir) {
  try {
    const files = readdirSync(dir).filter((f) => /^HANDOFF-.*\.md$/i.test(f));
    let best = null;
    for (const f of files) {
      const m = mtime(join(dir, f));
      if (m && (!best || m > best.m)) best = { f, m, path: join(dir, f) };
    }
    return best;
  } catch {
    return null;
  }
}

// Разбор markdown на разделы: [{title, lines[]}]. Строки до первого заголовка — раздел с пустым title.
export function sections(text) {
  const out = [{ title: '', lines: [] }];
  for (const line of text.split(/\r?\n/)) {
    const m = /^#{1,3}\s+(.*)$/.exec(line);
    if (m) out.push({ title: m[1].trim(), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const useful = (l) => l.trim() && !/^[-*_]{3,}\s*$/.test(l.trim());

// Первая таблица (лучше — та, где в шапке есть «окн»): строки без шапки и разделителя → «a — b — c».
export function firstTable(text) {
  const tables = [];
  let cur = null;
  for (const l of text.split(/\r?\n/)) {
    if (/^\s*\|/.test(l)) (cur ??= []).push(l);
    else if (cur) { tables.push(cur); cur = null; }
  }
  if (cur) tables.push(cur);
  const t = tables.find((x) => /окн/i.test(x[0])) ?? tables[0];
  if (!t) return [];
  return t
    .slice(1)
    .filter((l) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(l))
    .map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.replace(/\*\*/g, '').trim()).filter(Boolean).join(' — '));
}

function sectionItems(text, re) {
  const items = [];
  for (const s of sections(text)) {
    if (s.title && re.test(s.title)) for (const l of s.lines) if (useful(l)) items.push(l.trim().replace(/^[-*]\s+/, '').replace(/^\d+\.\s+/, ''));
  }
  return items;
}

const fmtDate = (d) => `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function memoryLines(text, n) {
  return text
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s/.test(l))
    .slice(0, n)
    .map((l) => l.replace(/^\s*[-*]\s+/, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'));
}

export function buildRestore(source, env = process.env) {
  const st = loadState(env);
  const src = sources(env);
  const t = now(env);
  const lines = [];
  const add = (l) => lines.push(l);

  add(`Leo: ${source === 'resume' ? 'сессия возобновлена' : 'после сжатия контекста'} (${fmtDate(t)}). Ниже — снимок из файлов, не живая картина: окна и PR не проверены прямо сейчас.`);

  const statusText = readText(src.status);
  const statusM = statusText != null ? mtime(src.status) : null;
  const hand = newestHandoff(src.handoffDir);
  const handText = hand ? readText(hand.path) : null;
  const parts = [];
  if (statusM) {
    const stale = t - statusM > 24 * 3600 * 1000;
    parts.push(`STATUS от ${fmtDate(statusM)}${stale ? ' — устарел (старше суток)' : ''}`);
  }
  if (hand && handText != null) parts.push(`${hand.f} от ${fmtDate(hand.m)}`);
  add(parts.length ? `Источники: ${parts.join('; ')}.` : 'Источников нет: STATUS и HANDOFF не найдены; есть только то, что Leo вёл сам.');

  // Окна
  const win = Object.entries(st.windows).map(([k, v]) => `${k}: ${v.status}${v.note ? ' — ' + v.note : ''}`);
  // sectionItems/таблица из файлов дают строки без id; state-записи выше показывают id в скобках
  const fromStatus = statusText ? firstTable(statusText) : [];
  const winAll = [...win, ...fromStatus];
  if (winAll.length) {
    add('Окна-сессии и их статус:');
    for (const w of winAll.slice(0, 6)) add(' - ' + w);
    if (winAll.length > 6) add(` - … ещё ${winAll.length - 6}`);
  }

  // Ждёт «да» владельца
  const wait = [
    ...st.waiting.map((w) => `[${w.id}] ${w.text}`),
    ...(statusText ? sectionItems(statusText, /вопрос|твоё|твое/i) : []),
    ...(handText ? sectionItems(handText, /ждёт|ждет/i) : []),
  ];
  if (wait.length) {
    add('Ждёт «да» или решения владельца:');
    for (const w of wait.slice(0, 7)) add(' - ' + w);
    if (wait.length > 7) add(` - … ещё ${wait.length - 7}`);
  }

  // Правила владельца за сегодня
  const day = today(env);
  const todays = st.rules.filter((r) => r.date === day);
  if (todays.length) {
    add('Правила владельца за сегодня (записаны директором):');
    for (const r of todays.slice(-6)) add(` - [${r.id}] ${r.text}`);
    if (todays.length > 6) add(` - … ещё ${todays.length - 6}`);
  }

  // Обещано и не сделано (найденные Haiku обещания старше 3 дней считаем остывшими и не показываем)
  const promises = st.promises.filter((p) => !p.auto || !p.ts || !(t - new Date(p.ts) >= PROMISE_TTL_MS));
  if (promises.length) {
    add('Обещано и не сделано:');
    for (const p of promises.slice(-5)) add(` - [${p.id}] ${p.text}${p.auto ? ' (нашёл Haiku)' : ''}`);
    if (promises.length > 5) add(` - … ещё ${promises.length - 5}`);
  }

  // Индекс памяти
  const memText = readText(src.memoryIndex);
  const mem = memText ? memoryLines(memText, 3) : [];
  if (mem.length) {
    add('Из индекса памяти (первые строки):');
    for (const m of mem) add(' - ' + m);
  }

  if (lines.length <= 2 && !winAll.length && !wait.length && !todays.length && !promises.length && !mem.length) {
    lines.length = 0;
    add('Leo: после сжатия сохранённого состояния нет — ни STATUS/HANDOFF, ни записей Leo. Окна, ожидание и обещания стоит восстановить по живым сессиям.');
    add('Вести записи: node "' + (env.CLAUDE_PLUGIN_ROOT || '<плагин>') + '/bin/leo.mjs" show');
  } else {
    add(`Вести записи Leo: node "${env.CLAUDE_PLUGIN_ROOT || '<плагин>'}/bin/leo.mjs" (show | window set/drop | wait add/done | promise add/done | rule add/drop; id — в скобках).`);
  }

  const cut = lines.slice(0, MAX_LINES).map((l) => redact(l).slice(0, MAX_LINE));
  return cut.join('\n');
}
