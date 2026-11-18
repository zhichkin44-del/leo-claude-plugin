// Stop: если ответ — итог для Саши, один вызов Haiku (роли «Саша» и «скептик»); серьёзная находка → block, иначе тишина.
import { runHook } from '../lib/io.mjs';
import { reviewReply } from '../lib/skeptic.mjs';

await runHook('stop', (input, env) => reviewReply(input, env), process.env);
