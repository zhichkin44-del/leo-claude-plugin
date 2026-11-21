// Leo state file: windows, what waits for "yes", promises, the day's rules, the owner's last message.
// Kept outside the plugin (survives updates and removal): ~/.claude/leo/state.json, overridable with LEO_HOME.
import { readFileSync, writeFileSync, renameSync, rmSync, mkdirSync, appendFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redact } from './secrets.mjs';

export const MAX = { rules: 60, promises: 30, waiting: 30, windows: 30, sessions: 10, text: 300 };

export function leoHome(env = process.env) {
  return env.LEO_HOME || join(homedir(), '.claude', 'leo');
}

export function now(env = process.env) {
  const d = env.LEO_NOW ? new Date(env.LEO_NOW) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// Local date YYYY-MM-DD (the owner's day, by the machine's clock).
export function today(env = process.env) {
  const d = now(env);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const emptyState = () => ({ version: 1, windows: {}, waiting: [], promises: [], rules: [], hintsSeen: [], spend: null, sessions: {} });

function isObj(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x);
}

// Brings anything read from disk to a normal form: extra data is dropped, types are fixed.
export function normalize(raw) {
  const s = emptyState();
  if (!isObj(raw)) return s;
  if (isObj(raw.windows)) {
    // when over the limit, the newest windows (by ts) survive, not the oldest
    const byNewest = Object.entries(raw.windows).sort((a, b) => String(b[1]?.ts ?? '').localeCompare(String(a[1]?.ts ?? '')));
    for (const [k, v] of byNewest.slice(0, MAX.windows)) {
      if (isObj(v)) s.windows[String(k).slice(0, 60)] = { status: String(v.status ?? '').slice(0, 40), note: String(v.note ?? '').slice(0, MAX.text), ts: String(v.ts ?? '') };
    }
  }
  const list = (arr, keep) =>
    (Array.isArray(arr) ? arr : []).filter((x) => isObj(x) && typeof x.text === 'string' && x.text.trim()).slice(-keep);
  s.waiting = list(raw.waiting, MAX.waiting).map((x) => ({ id: String(x.id ?? ''), text: x.text.slice(0, MAX.text), ts: String(x.ts ?? '') }));
  s.promises = list(raw.promises, MAX.promises).map((x) => ({ id: String(x.id ?? ''), text: x.text.slice(0, MAX.text), ts: String(x.ts ?? ''), auto: x.auto === true }));
  s.rules = list(raw.rules, MAX.rules).map((x) => ({ id: String(x.id ?? ''), date: String(x.date ?? ''), ts: String(x.ts ?? ''), text: x.text.slice(0, MAX.text) }));
  if (isObj(raw.sessions)) {
    const strs = (a, n, len) => (Array.isArray(a) ? a : []).filter((x) => typeof x === 'string').slice(0, n).map((x) => x.slice(0, len));
    const byNewest = Object.entries(raw.sessions).filter(([, v]) => isObj(v)).sort((a, b) => String(b[1].ts ?? '').localeCompare(String(a[1].ts ?? '')));
    for (const [k, v] of byNewest.slice(0, MAX.sessions)) {
      s.sessions[String(k).slice(0, 80)] = { ts: String(v.ts ?? ''), cwd: String(v.cwd ?? '').slice(0, 300), intent: String(v.intent ?? '').slice(0, 300), tasks: strs(v.tasks, 12, 160), rules: strs(v.rules, 4, 220), files: strs(v.files, 6, 170) };
    }
  }
  if (isObj(raw.spend) && typeof raw.spend.date === 'string' && typeof raw.spend.usd === 'number') s.spend = { date: raw.spend.date.slice(0, 10), usd: raw.spend.usd };
  if (Array.isArray(raw.hintsSeen)) s.hintsSeen = raw.hintsSeen.filter((x) => typeof x === 'string').slice(-10).map((x) => x.slice(0, 200));
  return s;
}

export function loadState(env = process.env) {
  const file = join(leoHome(env), 'state.json');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return emptyState();
  }
  try {
    return normalize(JSON.parse(text));
  } catch {
    try {
      writeFileSync(file + '.bad', text, 'utf8'); // оставляем копию, начинаем с чистого
    } catch { /* не страшно */ }
    return emptyState();
  }
}

export function saveState(state, env = process.env) {
  const dir = leoHome(env);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'state.json');
  const tmp = file + '.tmp' + process.pid;
  const body = JSON.stringify(state, null, 1);
  writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 });
  // On Windows, rename over a file held by antivirus sometimes gives EPERM/EBUSY: a couple of retries, then a direct write.
  for (let i = 0; i < 3; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch {
      const until = Date.now() + 40 * (i + 1);
      while (Date.now() < until) { /* короткая пауза */ }
    }
  }
  writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 });
  try { rmSync(tmp, { force: true }); } catch { /* не страшно */ }
}

export function newId(prefix, env = process.env) {
  return prefix + now(env).getTime().toString(36).slice(-4) + Math.random().toString(36).slice(2, 5);
}

export function clean(text, max = MAX.text) {
  return redact(String(text ?? '')).replace(/\s+/g, ' ').trim().slice(0, max);
}

const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const sameText = (a, b) => norm(a) === norm(b);

// Leo journal (jsonl). Write errors are swallowed: the journal must not break the hook.
export function logEvent(env, obj) {
  if (env.LEO_NO_LOG === '1' || logDisabledByConfig(env)) return;
  try {
    const dir = leoHome(env);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'leo.log');
    try {
      if (existsSync(file) && statSync(file).size > 500_000) renameSync(file, file + '.1');
    } catch { /* ротация необязательна */ }
    appendFileSync(file, redact(JSON.stringify({ ts: now(env).toISOString(), ...obj })) + '\n', { encoding: 'utf8', mode: 0o600 });
  } catch { /* молча */ }
}

// config.json {"log": false} means: do not write the journal at all.
function logDisabledByConfig(env) {
  try {
    return JSON.parse(readFileSync(join(leoHome(env), 'config.json'), 'utf8')).log === false;
  } catch {
    return false;
  }
}

// Rules in effect now: those recorded in the last `days` days (default 1: today only).
export function activeRules(st, env = process.env, days = 1) {
  const d = Math.max(1, Math.floor(Number(days) || 1));
  const cut = new Date(now(env).getTime() - (d - 1) * 24 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  const from = `${cut.getFullYear()}-${p(cut.getMonth() + 1)}-${p(cut.getDate())}`;
  const to = today(env);
  return st.rules.filter((r) => r.date >= from && r.date <= to);
}
