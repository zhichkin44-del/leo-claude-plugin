#!/usr/bin/env node
// Leo CLI: show / status / log / doctor, and records of sessions, waiting items, promises and rules. State: ~/.claude/leo/state.json.
import { writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadState, saveState, leoHome, clean, newId, now, today, sameText, MAX } from '../lib/state.mjs';
import { buildRestore } from '../lib/restore.mjs';
import { loadConfig } from '../lib/config.mjs';
import { t, pickLang, pickProfile } from '../lib/i18n.mjs';
import { runDoctor, formatDoctor } from '../lib/doctor.mjs';

const [, , cmd, sub, ...rest] = process.argv;
const env = process.env;
const text = (arr) => clean(arr.join(' '));

const fail = (msg) => {
  process.stderr.write((msg ? msg + '\n' : '') + t('usage', env) + '\n');
  process.exit(1);
};

function removeById(list, id) {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) fail(t('cliNotFound', env, { id }));
  list.splice(i, 1);
}

function readLog(n) {
  let lines = [];
  try {
    lines = readFileSync(join(leoHome(env), 'leo.log'), 'utf8').split('\n').filter(Boolean);
  } catch { /* no journal */ }
  const ev = [];
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      if (o.event === 'stop') ev.push(o);
    } catch { /* broken line */ }
  }
  return ev.slice(-n);
}

try {
  if (cmd === 'show') {
    process.stdout.write(buildRestore('compact', env) + '\n');
  } else if (cmd === 'status') {
    const cfg = loadConfig(env);
    const st = loadState(env);
    process.stdout.write(t('statusLine', env, { v: JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json', import.meta.url), 'utf8')).version, lang: pickLang(env), mode: cfg.mode, profile: pickProfile(env), model: cfg.model, home: leoHome(env) }) + '\n');
    process.stdout.write(`windows ${Object.keys(st.windows).length}, waiting ${st.waiting.length}, promises ${st.promises.length}, rules ${st.rules.length}` + (existsSync(join(leoHome(env), 'off')) ? ', OFF' : '') + '\n');
  } else if (cmd === 'log') {
    const n = Math.max(1, Number(sub) || 20);
    const ev = readLog(n);
    if (!ev.length) process.stdout.write(t('logEmpty', env) + '\n');
    else {
      const count = (v) => ev.filter((e) => e.verdict === v).length;
      const cost = ev.reduce((a, e) => a + (typeof e.cost === 'number' ? e.cost : 0), 0);
      const timed = ev.filter((e) => typeof e.ms === 'number');
      const avg = timed.length ? Math.round(timed.reduce((a, e) => a + e.ms, 0) / timed.length) : 0;
      for (const e of ev) process.stdout.write(`${e.ts} ${e.verdict}${e.serious ? ' serious=' + e.serious : ''}${e.ms ? ' ' + e.ms + 'ms' : ''}${typeof e.cost === 'number' ? ' $' + e.cost.toFixed(4) : ''}\n`);
      process.stdout.write(t('logSummary', env, { n: ev.length, blocks: count('block') + count('advice'), hints: count('hint'), ok: count('ok'), fail: count('haiku-failed') + count('unparsed'), cost: '$' + cost.toFixed(4), ms: avg }) + '\n');
    }
  } else if (cmd === 'doctor') {
    const res = await runDoctor(env, { ping: sub === '--ping' || rest.includes('--ping') });
    process.stdout.write(formatDoctor(res, env) + '\n');
    process.exitCode = res.bad ? 1 : 0;
  } else if (cmd === 'off' || cmd === 'on') {
    const dir = leoHome(env);
    mkdirSync(dir, { recursive: true });
    if (cmd === 'off') writeFileSync(join(dir, 'off'), t('offText', env) + now(env).toISOString() + '\n');
    else rmSync(join(dir, 'off'), { force: true });
    process.stdout.write(t(cmd === 'off' ? 'offDone' : 'onDone', env) + '\n');
  } else if (['window', 'wait', 'promise', 'rule'].includes(cmd)) {
    const st = loadState(env);
    const ts = now(env).toISOString();
    if (cmd === 'window') {
      if (sub === 'set' && rest.length >= 2) {
        st.windows[clean(rest[0], 60)] = { status: clean(rest[1], 40), note: text(rest.slice(2)), ts };
      } else if (sub === 'drop' && rest.length >= 1) {
        delete st.windows[rest[0]];
      } else fail(t('cliWindowNeed', env));
    } else if (cmd === 'wait' || cmd === 'promise') {
      const key = cmd === 'wait' ? 'waiting' : 'promises';
      if (sub === 'add' && rest.length) {
        const x = text(rest);
        if (!st[key].some((e) => sameText(e.text, x))) st[key].push({ id: newId(cmd[0], env), text: x, ts });
        st[key] = st[key].slice(-MAX[key]);
      } else if (sub === 'done' && rest[0]) removeById(st[key], rest[0]);
      else fail(t('cliKindNeed', env, { cmd }));
    } else {
      if (sub === 'add' && rest.length) {
        const x = text(rest);
        if (!st.rules.some((r) => r.date === today(env) && sameText(r.text, x))) st.rules.push({ id: newId('r', env), date: today(env), ts, text: x });
      } else if (sub === 'drop' && rest[0]) removeById(st.rules, rest[0]);
      else fail(t('cliRuleNeed', env));
    }
    saveState(st, env);
    process.stdout.write(t('cliOk', env) + '\n');
  } else fail(cmd ? t('cliUnknown', env, { cmd }) : '');
} catch (e) {
  process.stderr.write(t('cliError', env, { msg: e?.message ?? e }) + '\n');
  process.exit(1);
}
