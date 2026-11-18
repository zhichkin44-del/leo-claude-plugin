// SessionStart (compact | resume): возвращает в контекст главное — окна, ожидание, правила дня, обещанное.
import { runHook, additionalContext } from '../lib/io.mjs';
import { buildRestore } from '../lib/restore.mjs';

await runHook('session-start', (input, env) => {
  const source = input.source;
  if (source !== 'compact' && source !== 'resume') return null;
  return additionalContext('SessionStart', buildRestore(source, env));
}, process.env);
