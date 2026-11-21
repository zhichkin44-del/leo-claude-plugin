// Stop: if the reply is a final answer for the owner, one Haiku call (roles "reader" and "skeptic"); a serious finding -> block, otherwise silence.
import { runHook } from '../lib/io.mjs';
import { reviewReply } from '../lib/skeptic.mjs';

await runHook('stop', (input, env) => reviewReply(input, env), process.env);
