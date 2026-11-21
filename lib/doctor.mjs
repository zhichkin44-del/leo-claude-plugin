// `leo doctor`: checks that Leo can work on this machine, and for each failure says what to fix.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findClaude, askHaiku } from './haiku.mjs';
import { readConfigFile, validateConfig, loadConfig } from './config.mjs';
import { sources } from './restore.mjs';
import { leoHome } from './state.mjs';
import { t } from './i18n.mjs';

export const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const REQUIRED_HOOKS = ['SessionStart', 'PreCompact', 'PostCompact', 'Stop'];

function run(found, args, env) {
  const cmd = found.shell && /\s/.test(found.cmd) ? `"${found.cmd}"` : found.cmd;
  return spawnSync(cmd, [...found.pre, ...args], { encoding: 'utf8', timeout: 20000, windowsHide: true, shell: !!found.shell, env });
}

// -> { checks: [{ ok: true|false|null, text }], ok, bad }
export async function runDoctor(env = process.env, opts = {}) {
  const checks = [];
  const add = (ok, text) => checks.push({ ok, text });
  const root = env.CLAUDE_PLUGIN_ROOT || PLUGIN_ROOT;

  // 1. Node
  const nodeV = env.LEO_DOCTOR_NODE || process.versions.node;
  if (Number(nodeV.split('.')[0]) >= 18) add(true, t('docNode', env, { v: nodeV }));
  else add(false, t('docNodeBad', env, { v: nodeV }));

  // 2-3. claude and --safe-mode
  const found = findClaude(env);
  const ver = run(found, ['--version'], env);
  const claudeOk = !ver.error && ver.status === 0 && String(ver.stdout).trim() !== '';
  if (claudeOk) {
    add(true, t('docClaude', env, { path: found.pre.length ? found.pre[found.pre.length - 1] : found.cmd, src: found.source, v: String(ver.stdout).trim().split('\n')[0].slice(0, 60) }));
    const help = run(found, ['--help'], env);
    if (/--safe-mode/.test(String(help.stdout) + String(help.stderr))) add(true, t('docSafe', env));
    else add(false, t('docSafeMissing', env));
  } else {
    add(false, t('docClaudeMissing', env));
    add(false, t('docSafeMissing', env));
  }

  // 4. Leo folder
  const dir = leoHome(env);
  try {
    mkdirSync(dir, { recursive: true });
    const probe = join(dir, '.doctor-probe');
    writeFileSync(probe, 'x');
    rmSync(probe, { force: true });
    add(true, t('docHome', env, { dir }));
  } catch (e) {
    add(false, t('docHomeBad', env, { dir, err: String(e.code || e.message) }));
  }

  // 5. config.json
  const cf = readConfigFile(env);
  if (!cf.found) add(null, t('docConfigMissing', env));
  else {
    const problems = cf.error ? [cf.error] : validateConfig(cf.raw);
    if (problems.length) add(false, t('docConfigBad', env, { err: problems.join('; ') }));
    else add(true, t('docConfig', env));
  }

  // 6. hooks.json
  try {
    const h = JSON.parse(readFileSync(join(root, 'hooks', 'hooks.json'), 'utf8')).hooks ?? {};
    const missing = REQUIRED_HOOKS.filter((e) => !h[e]);
    const files = [];
    for (const list of Object.values(h)) for (const g of list) for (const hk of g.hooks ?? []) for (const a of hk.args ?? []) {
      const p = String(a).replace('${CLAUDE_PLUGIN_ROOT}', root);
      if (/\.mjs$/.test(p) && !existsSync(p)) files.push(p);
    }
    if (missing.length || files.length) add(false, t('docHooksBad', env, { err: [missing.length ? 'missing ' + missing.join(', ') : '', files.length ? 'no file ' + files.join(', ') : ''].filter(Boolean).join('; ') }));
    else add(true, t('docHooks', env));
  } catch (e) {
    add(false, t('docHooksBad', env, { err: e.message }));
  }

  // 7. Sources
  const src = sources(env);
  for (const [name, path] of Object.entries(src)) {
    if (!path) { add(null, t('docSources', env, { name, state: t('docSourcesNone', env) })); continue; }
    let readable = false;
    try { statSync(path); readable = true; } catch { /* нет */ }
    if (readable) add(true, t('docSources', env, { name, state: t('docSourcesOk', env) }));
    else add(false, t('docSources', env, { name, state: t('docSourcesBad', env, { path }) }));
  }

  // 8. Off switch
  if (env.LEO_OFF === '1' || existsSync(join(dir, 'off'))) add(false, t('docOff', env));

  // 9. Test call (optional; this is a real, paid call)
  if (opts.ping && claudeOk) {
    const cfg = loadConfig(env);
    const r = await askHaiku('Reply with exactly: {"ok":true}', env, undefined, cfg.model);
    if (r.ok) add(true, t('docPing', env, { ms: r.ms, cost: typeof r.cost === 'number' ? '$' + r.cost.toFixed(4) : '?' }));
    else add(false, t('docPingBad', env, { err: r.error }));
  } else if (claudeOk) add(null, t('docPingSkip', env));

  add(null, t('docLeaves', env));
  const bad = checks.filter((c) => c.ok === false).length;
  const ok = checks.filter((c) => c.ok === true).length;
  return { checks, ok, bad };
}

export function formatDoctor(res, env = process.env) {
  const mark = (c) => (c.ok === true ? t('docOkMark', env) : c.ok === false ? t('docBadMark', env) : t('docInfoMark', env));
  return [t('docTitle', env), ...res.checks.map((c) => `[${mark(c)}] ${c.text}`), t('docSummary', env, { ok: res.ok, bad: res.bad })].join('\n');
}
