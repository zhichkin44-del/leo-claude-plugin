// Вызов Haiku из хука: `claude -p --model haiku` без хуков и инструментов, таймаут, убийство дерева процессов.
// На Windows `claude` из npm — это claude.cmd (нужен shell, +15 с запуска); ищем настоящий claude.exe рядом.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter, extname } from 'node:path';

const ARGS = ['-p', '--safe-mode', '--model', 'haiku', '--output-format', 'json', '--no-session-persistence', '--disallowedTools', '*', '--max-turns', '1'];
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

// → { cmd, pre } — что запускать и какие аргументы поставить перед ARGS
export function findClaude(env = process.env) {
  if (env.LEO_CLAUDE) {
    return /^\.(mjs|cjs|js)$/i.test(extname(env.LEO_CLAUDE)) ? { cmd: process.execPath, pre: [env.LEO_CLAUDE] } : { cmd: env.LEO_CLAUDE, pre: [] };
  }
  if (process.platform === 'win32') {
    const exe = onPath(['claude.exe'], env);
    if (exe) return { cmd: exe.path, pre: [] };
    const shim = onPath(['claude.cmd'], env);
    if (shim) {
      const real = join(shim.dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
      if (existsSync(real)) return { cmd: real, pre: [] };
      return { cmd: shim.path, pre: [], shell: true };
    }
  }
  return { cmd: 'claude', pre: [] };
}

function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else child.kill('SIGKILL');
  } catch { /* уже умер */ }
  try { child.kill(); } catch { /* уже умер */ }
}

// → { ok, text, cost, ms, error }
export function askHaiku(prompt, env = process.env, timeoutMs = Number(env.LEO_HAIKU_TIMEOUT_MS) || 45000) {
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
      child = spawn(shell && /\s/.test(cmd) ? `"${cmd}"` : cmd, [...pre, ...ARGS], {
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
