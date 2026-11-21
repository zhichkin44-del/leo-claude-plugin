// PostCompact: only a journal mark (compaction counter). Context is restored by SessionStart with matcher "compact".
import { runHook } from '../lib/io.mjs';
import { logEvent } from '../lib/state.mjs';

await runHook('postcompact', (input, env) => {
  logEvent(env, { event: 'compact', trigger: input.trigger });
  return null;
}, process.env);
