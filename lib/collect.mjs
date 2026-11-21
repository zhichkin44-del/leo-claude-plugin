// Automatic collection of session state from the transcript (jsonl): open tasks (TodoWrite), the last user request, standing instructions
// from the user ("always/never" and the Russian "всегда/никогда") and recently edited files. No model call; any failure gives an empty result.
import { readTail, textOf, isServiceMessage } from './transcript.mjs';
import { clean, sameText, loadState, saveState, normalize, now } from './state.mjs';

const MAX_USER_SCAN = 60;
const STANDING = /\b(?:always|never|from now on|going forward|every time|must not|should never|do not ever|don'?t ever|make sure (?:to|you))\b|(?<![\p{L}])(?:всегда|никогда|впредь|отныне|каждый раз|больше не|нельзя|не надо|не нужно)(?![\p{L}])/iu;
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

export const emptyCollected = () => ({ intent: '', tasks: [], rules: [], files: [] });

export function collectFromTranscript(path) {
  const out = emptyCollected();
  try {
    if (typeof path !== 'string' || !path) return out;
    const lines = readTail(path).split(/\r?\n/);
    const users = [];
    let todos = null;
    const files = [];
    for (const line of lines) {
      let o;
      try { o = JSON.parse(line); } catch { continue; }
      if (!o || typeof o !== 'object' || o.isSidechain === true) continue;
      if (o.type === 'user') {
        const text = textOf(o.message?.content).trim();
        if (text && !isServiceMessage(text)) users.push(text);
      } else if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
        for (const b of o.message.content) {
          if (!b || b.type !== 'tool_use') continue;
          if (b.name === 'TodoWrite' && Array.isArray(b.input?.todos)) todos = b.input.todos;
          else if (FILE_TOOLS.has(b.name) && typeof (b.input?.file_path ?? b.input?.notebook_path) === 'string') files.push(b.input.file_path ?? b.input.notebook_path);
        }
      }
    }
    if (todos) {
      out.tasks = todos
        .filter((x) => x && typeof x === 'object' && typeof x.content === 'string' && x.status !== 'completed')
        .slice(0, 12)
        .map((x) => clean(x.content, 140) + (x.status === 'in_progress' ? ' (in progress)' : ''));
    }
    const recent = users.slice(-MAX_USER_SCAN);
    const substantive = [...recent].reverse().find((m) => m.length >= 15) ?? recent[recent.length - 1];
    if (substantive) out.intent = clean(substantive, 300);
    const rules = [];
    for (const m of recent) {
      for (const s of m.split(/(?<=[.!?])\s+|\n+/)) {
        const x = s.trim();
        if (x.length >= 8 && x.length <= 240 && STANDING.test(x)) {
          const c = clean(x, 200);
          const i = rules.findIndex((r) => sameText(r, c));
          if (i >= 0) rules.splice(i, 1);
          rules.push(c);
        }
      }
    }
    out.rules = rules.slice(-4);
    const seen = [];
    for (let i = files.length - 1; i >= 0 && seen.length < 6; i--) if (!seen.includes(files[i])) seen.push(files[i]);
    out.files = seen.reverse().map((f) => clean(f, 160));
    return out;
  } catch {
    return emptyCollected();
  }
}

export const hasCollected = (c) => !!(c && (c.intent || c.tasks?.length || c.rules?.length || c.files?.length));

// Save the collected data under session_id (old sessions are evicted; at most 10 are kept).
export function saveSession(env, input, collected) {
  const id = typeof input?.session_id === 'string' && input.session_id ? input.session_id.slice(0, 80) : '';
  if (!id || !hasCollected(collected)) return;
  const st = loadState(env);
  st.sessions[id] = { ts: now(env).toISOString(), cwd: typeof input.cwd === 'string' ? input.cwd : '', ...collected };
  saveState(normalize(st), env); // normalize оставляет 10 самых свежих сессий
}

// What to show: a fresh transcript parse; if there is none, the data saved for this session_id; for resume under a new id, the latest session of the same folder.
export function sessionState(env, input) {
  const fresh = collectFromTranscript(input?.transcript_path);
  if (hasCollected(fresh)) return fresh;
  const st = loadState(env);
  const id = typeof input?.session_id === 'string' ? input.session_id : '';
  if (id && st.sessions[id]) return st.sessions[id];
  if (typeof input?.cwd === 'string' && input.cwd) {
    const same = Object.values(st.sessions).filter((s) => s.cwd === input.cwd).sort((a, b) => b.ts.localeCompare(a.ts));
    if (same[0]) return same[0];
  }
  return emptyCollected();
}
