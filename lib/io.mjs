// Common hook frame: read stdin, parse JSON, guard everything: "any error -> journal and silent exit 0".

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logEvent, leoHome } from './state.mjs';

const MAX_STDIN = 4_000_000;

// Whole stdin, up to 4 MB, asynchronously (no busy waiting); on any failure, returns what was read so far.
export async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  let total = 0;
  try {
    for await (const c of process.stdin) {
      chunks.push(c);
      total += c.length;
      if (total > MAX_STDIN) return ''; // input too large — not ours
    }
  } catch { /* return what was read */ }
  return Buffer.concat(chunks).toString('utf8');
}

// Returns an object, or null (empty, not JSON, null, array, number, string).
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
    return existsSync(join(leoHome(env), 'off')); // off switch: file ~/.claude/leo/off (command `leo.mjs off`)
  } catch {
    return false;
  }
}

// Runs run(input) and prints the result. Any exception goes to the journal, exit code 0, nothing printed.
export async function runHook(name, run, env = process.env) {
  try {
    if (disabled(env)) return;
    const input = parseInput(await readStdin());
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
