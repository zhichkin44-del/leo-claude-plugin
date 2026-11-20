// PostCompact: только отметка в журнале (счётчик сжатий). Возврат контекста делает SessionStart с matcher "compact".
import { runHook } from '../lib/io.mjs';
import { logEvent } from '../lib/state.mjs';

await runHook('postcompact', (input, env) => {
  logEvent(env, { event: 'compact', trigger: input.trigger });
  return null;
}, process.env);
