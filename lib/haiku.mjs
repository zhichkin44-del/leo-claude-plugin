// Вызов Haiku из хука: `claude -p --model haiku` без хуков и инструментов, таймаут, убийство дерева процессов.
// На Windows `claude` из npm — это claude.cmd (нужен shell, +15 с запуска); ищем настоящий claude.exe рядом.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, extname, dirname } from 'node:path';
import { readConfigFile } from './config.mjs';
import { leoHome } from './state.mjs';

export const argsFor = (model = 'haiku') => ['-p', '--safe-mode', '--model', model, '--output-format', 'json', '--no-session-persistence', '--disallowedTools', '*', '--max-turns', '1'];
const MAX_OUT = 300_000;

function onPath(names, env) {
  for (const dir of (env.PATH || env.Path || '').split(delimiter).filter(Boolean)) {
    for (const n of names) {
      const p = join(dir, n);
      if (existsSync(p)) return { dir, path: p };
    }
  }
  return null;
}

// Стандартные места установки claude (если хук запущен с урезанным PATH).
export function standardLocations(env = process.env, platform = process.platform) {
  const add = (base, ...parts) => (base ? [join(base, ...parts)] : []);
  if (platform === 'win32') {
    return [
      ...add(env.USERPROFILE, '.local', 'bin', 'claude.exe'),
      ...add(env.APPDATA, 'npm', 'claude.cmd'),
      ...add(env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'),
    ];
  }
  return [
    ...add(env.HOME, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    ...add(env.HOME, '.npm-global', 'bin', 'claude'),
  ];
}

// Файл пути → команда. Windows .cmd (npm-шим) — через shell, либо сразу настоящий claude.exe рядом.
function target(p, platform) {
  if (/^\.(mjs|cjs|js)$/i.test(extname(p))) return { cmd: process.execPath, pre: [p] };
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(p)) {
    const real = join(dirname(p), 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
    if (existsSync(real)) return { cmd: real, pre: [] };
    return { cmd: p, pre: [], shell: true };
  }
  return { cmd: p, pre: [] };
}

// Порядок: LEO_CLAUDE → claudePath в config.json → PATH → стандартные места.
// → { cmd, pre, shell?, source, found }; found=false — claude нигде не найден (запуск вернёт ENOENT).
export function findClaude(env = process.env, opts = {}) {
  const platform = opts.platform || process.platform;
  if (env.LEO_CLAUDE) return { ...target(env.LEO_CLAUDE, platform), source: 'LEO_CLAUDE', found: existsSync(env.LEO_CLAUDE) };
  const configured = 'configured' in opts ? opts.configured : readConfigFile(env).raw.claudePath;
  if (typeof configured === 'string' && configured && existsSync(configured)) return { ...target(configured, platform), source: 'config', found: true };
  if (platform === 'win32') {
    const exe = onPath(['claude.exe'], env);
    if (exe) return { ...target(exe.path, platform), source: 'PATH', found: true };
  }
  const hit = onPath(platform === 'win32' ? ['claude.cmd'] : ['claude'], env);
  if (hit) return { ...target(hit.path, platform), source: 'PATH', found: true };
  for (const p of standardLocations(env, platform)) {
    if (existsSync(p)) return { ...target(p, platform), source: 'standard', found: true };
  }
  return { cmd: 'claude', pre: [], source: 'none', found: false };
}

// claude не найден: возвращает true только при первом отказе за сессию (session_id), чтобы не писать 7 одинаковых строк.
export function noteClaudeMissingOnce(env = process.env, sessionId = '') {
  try {
    const f = join(leoHome(env), 'claude-missing.json');
    let last = null;
    try { last = JSON.parse(readFileSync(f, 'utf8')).session; } catch { /* файла нет */ }
    const key = String(sessionId || 'unknown');
    if (last === key) return false;
    writeFileSync(f, JSON.stringify({ session: key }), { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return true;
  }
}

function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else child.kill('SIGKILL');
  } catch { /* уже умер */ }
  try { child.kill(); } catch { /* уже умер */ }
}

// → { ok, text, cost, ms, error }
export function askHaiku(prompt, env = process.env, timeoutMs = Number(env.LEO_HAIKU_TIMEOUT_MS) || 45000, model = 'haiku') {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let done = false;
    let timer; // объявлен до finish(): синхронный сбой spawn вызывает finish() раньше установки таймера
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ms: Date.now() - t0, ...r });
    };
    let child;
    let out = '';
    let err = '';
    const { cmd, pre, shell } = findClaude(env);
    try {
      // с shell:true путь с пробелами нужно взять в кавычки (аргументы ARGS пробелов не содержат)
      child = spawn(shell && /\s/.test(cmd) ? `"${cmd}"` : cmd, [...pre, ...argsFor(model)], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...env, LEO_INNER: '1' },
        cwd: tmpdir(),
        windowsHide: true,
        shell: !!shell,
      });
    } catch (e) {
      return finish({ ok: false, error: 'spawn: ' + e.message });
    }
    timer = setTimeout(() => {
      killTree(child);
      finish({ ok: false, error: 'timeout' });
    }, timeoutMs);
    child.on('error', (e) => finish({ ok: false, error: 'spawn: ' + e.message }));
    child.stdout.on('data', (d) => { if (out.length < MAX_OUT) out += d; });
    child.stderr.on('data', (d) => { if (err.length < 2000) err += d; });
    child.stdin.on('error', () => { /* процесс закрылся раньше времени */ });
    child.on('close', (code) => {
      if (code !== 0) return finish({ ok: false, error: `haiku exit ${code}: ${err.slice(0, 200)}` });
      try {
        const j = JSON.parse(out);
        if (j && j.is_error) return finish({ ok: false, error: 'haiku is_error' });
        const text = typeof j?.result === 'string' ? j.result : '';
        return finish({ ok: true, text, cost: typeof j?.total_cost_usd === 'number' ? j.total_cost_usd : undefined });
      } catch {
        return finish({ ok: false, error: 'haiku: ответ не JSON' });
      }
    });
    try { child.stdin.end(prompt); } catch { /* ошибка запуска придёт в 'error' */ }
  });
}

// Достаёт JSON-объект из текста ответа (допускает ```json-забор и слова вокруг).
export function extractJson(text) {
  if (typeof text !== 'string') return null;
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, b + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
