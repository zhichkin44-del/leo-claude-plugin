// SessionStart (compact | resume): returns the essentials into context: tasks and the request from this session, windows, waiting items, rules, promises.
import { runHook, additionalContext } from '../lib/io.mjs';
import { buildRestore } from '../lib/restore.mjs';
import { collectFromTranscript, saveSession } from '../lib/collect.mjs';
import { loadConfig } from '../lib/config.mjs';

await runHook('session-start', (input, env) => {
  const source = input.source;
  if (source !== 'compact' && source !== 'resume') return null;
  const text = buildRestore(source, env, input);
  if (loadConfig(env).autoCollect) saveSession(env, input, collectFromTranscript(input.transcript_path));
  return additionalContext('SessionStart', text);
}, process.env);
