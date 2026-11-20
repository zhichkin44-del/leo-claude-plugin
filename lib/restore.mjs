// Возврат главного после сжатия: окна, что ждёт «да», правила дня, обещанное. ≤ 40 строк.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, leoHome, now, activeRules } from './state.mjs';
import { loadConfig } from './config.mjs';
import { t } from './i18n.mjs';
import { sessionState, saveSession, hasCollected } from './collect.mjs';
import { redact } from './secrets.mjs';

export const MAX_LINES = 40;
const PROMISE_TTL_MS = 3 * 24 * 3600 * 1000;
const MAX_LINE = 220;

// Источники по умолчанию не заданы: нет настройки — источник молча пропускается.
const DEFAULT_SOURCES = { status: '', handoffDir: '', memoryIndex: '' };

// Источники: env → ~/.claude/leo/config.json → пусто. Нет файла — источник просто пропускается.
export function sources(env = process.env) {
  const cfg = loadConfig(env).sources;
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
  const tb = tables.find((x) => /окн|window|session/i.test(x[0])) ?? tables[0];
  if (!tb) return [];
  return tb
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

export function buildRestore(source, env = process.env, input = {}) {
  const st = loadState(env);
  const cfg = loadConfig(env);
  const src = sources(env);
  const nowT = now(env);
  const lines = [];
  const add = (l) => lines.push(l);
  const more = (n) => add(t('rsMore', env, { n }));

  const what = t(source === 'resume' ? 'rsResume' : source === 'start' ? 'rsStart' : 'rsAfterCompact', env);
  add(t('rsHead', env, { what, date: fmtDate(nowT) }));

  const statusText = readText(src.status);
  const statusM = statusText != null ? mtime(src.status) : null;
  const hand = newestHandoff(src.handoffDir);
  const handText = hand ? readText(hand.path) : null;
  const parts = [];
  if (statusM) parts.push(t('rsStatusFrom', env, { date: fmtDate(statusM), stale: nowT - statusM > 24 * 3600 * 1000 ? t('rsStale', env) : '' }));
  if (hand && handText != null) parts.push(t('rsHandFrom', env, { file: hand.f, date: fmtDate(hand.m) }));
  add(parts.length ? t('rsSources', env, { parts: parts.join('; ') }) : t('rsNoSources', env));

  // Окна
  const win = Object.entries(st.windows).map(([k, v]) => `${k}: ${v.status}${v.note ? ' — ' + v.note : ''}`);
  const fromStatus = statusText ? firstTable(statusText) : [];
  const winAll = [...win, ...fromStatus];
  if (winAll.length) {
    add(t('rsWindows', env));
    for (const w of winAll.slice(0, 6)) add(' - ' + w);
    if (winAll.length > 6) more(winAll.length - 6);
  }

  // Автосбор из транскрипта этой сессии (и сохранение под её session_id)
  const auto = cfg.autoCollect ? sessionState(env, input) : { intent: '', tasks: [], rules: [], files: [] };
  if (hasCollected(auto)) {
    add(t('rsAuto', env));
    if (auto.tasks.length) {
      add(t('rsAutoTasks', env));
      for (const x of auto.tasks.slice(0, 6)) add(' - ' + x);
      if (auto.tasks.length > 6) more(auto.tasks.length - 6);
    }
    if (auto.intent) add(t('rsAutoIntent', env) + ' ' + auto.intent);
    if (auto.rules.length) {
      add(t('rsAutoRules', env));
      for (const x of auto.rules.slice(0, 3)) add(' - ' + x);
    }
    if (auto.files.length) add(t('rsAutoFiles', env) + ' ' + auto.files.slice(-5).join(', '));
  }

  // Ждёт решения
  const waitRe = new RegExp(t('rsSectionWaiting', env), 'i');
  const wait = [
    ...st.waiting.map((w) => `[${w.id}] ${w.text}`),
    ...(statusText ? sectionItems(statusText, waitRe) : []),
    ...(handText ? sectionItems(handText, waitRe) : []),
  ];
  if (wait.length) {
    add(t('rsWaiting', env));
    for (const w of wait.slice(0, 7)) add(' - ' + w);
    if (wait.length > 7) more(wait.length - 7);
  }

  // Правила пользователя (сегодня или за ruleTtlDays)
  const todays = activeRules(st, env, cfg.ruleTtlDays);
  if (todays.length) {
    add(t('rsRules', env));
    for (const r of todays.slice(-6)) add(` - [${r.id}] ${r.text}`);
    if (todays.length > 6) more(todays.length - 6);
  }

  // Обещано и не сделано (найденные Haiku обещания старше 3 дней считаем остывшими и не показываем)
  const promises = st.promises.filter((p) => !p.auto || !p.ts || !(nowT - new Date(p.ts) >= PROMISE_TTL_MS));
  if (promises.length) {
    add(t('rsPromises', env));
    for (const p of promises.slice(-5)) add(` - [${p.id}] ${p.text}${p.auto ? t('rsFoundByHaiku', env) : ''}`);
    if (promises.length > 5) more(promises.length - 5);
  }

  // Индекс памяти
  const memText = readText(src.memoryIndex);
  const mem = memText ? memoryLines(memText, 3) : [];
  if (mem.length) {
    add(t('rsMemory', env));
    for (const m of mem) add(' - ' + m);
  }

  const root = env.CLAUDE_PLUGIN_ROOT || '<plugin>';
  if (lines.length <= 2 && !hasCollected(auto) && !winAll.length && !wait.length && !todays.length && !promises.length && !mem.length) {
    lines.length = 0;
    add(t('rsEmpty', env));
    add(t('rsHowEmpty', env, { root }));
  } else {
    add(t('rsHowFull', env, { root }));
  }

  const cut = lines.slice(0, MAX_LINES).map((l) => redact(l).slice(0, MAX_LINE));
  return cut.join('\n');
}
