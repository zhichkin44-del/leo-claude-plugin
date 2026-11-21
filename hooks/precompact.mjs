// PreCompact: while the transcript is intact, collect the session state (tasks, request, instructions, files) and save it under session_id.
import { runHook } from '../lib/io.mjs';
import { collectFromTranscript, saveSession } from '../lib/collect.mjs';
import { loadConfig } from '../lib/config.mjs';
import { logEvent } from '../lib/state.mjs';

await runHook('precompact', (input, env) => {
  if (!loadConfig(env).autoCollect) return null;
  const c = collectFromTranscript(input.transcript_path);
  saveSession(env, input, c);
  logEvent(env, { event: 'precompact', trigger: input.trigger, tasks: c.tasks.length, rules: c.rules.length, files: c.files.length });
  return null;
}, process.env);
