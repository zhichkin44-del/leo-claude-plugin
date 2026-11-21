// Secret filter. Everything Leo writes to files, returns into context or sends to Haiku goes through redact().
// The list is incomplete: this is a safety net, not a guarantee.
const MASK = '[hidden]';

const RULES = [
  // whole PEM block
  [/-----BEGIN[\s\S]*?(?:-----END[^\n]*|$)/g, MASK],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, MASK],
  // known key prefixes
  [/\b(?:github_pat_|sk-|ghp_|gho_|ghs_|ghu_|ghr_|glpat-|xox[bpars]-|xapp-|AKIA|ASIA|AIza|sk_live_|sk_test_|rk_live_|rk_test_|pk_live_|SG\.|ya29\.)[A-Za-z0-9_.-]{6,}/g, MASK],
  // Bearer token
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${MASK}`],
  // Telegram bot, HuggingFace and Supabase tokens
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}/g, MASK],
  [/\b(?:hf_|sbp_|npm_|pypi-)[A-Za-z0-9_-]{16,}/g, MASK],
  // login:password in a URL
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`],
  // "word: value", including in JSON ("password": "x") and with quotes
  [/((?<![\p{L}])(?:пароль|password|passwd|pin|token|токен|secret|секрет|api[_-]?key|access[_-]?token|client[_-]?secret)["']?[ \t]*[:=][ \t]*["']?)[^\s"',}]+/giu, `$1${MASK}`],
  // "password qwerty" variant without a colon
  [/((?<![\p{L}])(?:пароль|password)[ \t]+)(?!\[hidden\])(?=[^\s,.;]*\d)[^\s,.;]{4,}/giu, `$1${MASK}`],
  // Paths to .env and credentials are not secrets, their contents are: the path stays, assignments are masked.
  // .env lines: NAME with KEY/SECRET/TOKEN/PASSWORD/... = value (the name stays)
  [/(\b[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*_?(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|PWD|CREDENTIALS?|AUTH|PRIVATE)[A-Za-z0-9_]*[ \t]*=[ \t]*["']?)[^\s"',}]{6,}/g, `$1${MASK}`],
  // "credentials: value"
  [/((?<![\p{L}])credentials?["']?[ \t]*[:=][ \t]*["']?)[^\s"',}]+/giu, `$1${MASK}`],
  // Azure connection string
  [/\b(AccountKey|SharedAccessKey|SharedAccessSignature)=[^\s;]+/g, `$1=${MASK}`],
];

export function redact(text) {
  let out = String(text ?? '');
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
