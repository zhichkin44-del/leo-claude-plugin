// Фильтр секретов. Всё, что Leo пишет в файлы, возвращает в контекст или отправляет Haiku, проходит через redact().
// Список неполный — это страховка, а не гарантия.
const MASK = '[скрыто]';

const RULES = [
  // PEM-блок целиком
  [/-----BEGIN[\s\S]*?(?:-----END[^\n]*|$)/g, MASK],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, MASK],
  // известные префиксы ключей
  [/\b(?:github_pat_|sk-|ghp_|gho_|ghs_|glpat-|xox[bpas]-|AKIA|AIza)[A-Za-z0-9_-]{6,}/g, MASK],
  // Bearer-токен
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, `Bearer ${MASK}`],
  // токены Telegram-бота, HuggingFace, Supabase
  [/\b\d{8,10}:[A-Za-z0-9_-]{30,}/g, MASK],
  [/\b(?:hf_|sbp_|npm_|pypi-)[A-Za-z0-9_-]{16,}/g, MASK],
  // логин:пароль в URL
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`],
  // «слово : значение», в том числе в JSON ("password": "x") и с кавычками
  [/((?<![\p{L}])(?:пароль|password|passwd|pin|token|токен|secret|секрет|api[_-]?key|access[_-]?token|client[_-]?secret)["']?[ \t]*[:=][ \t]*["']?)[^\s"',}]+/giu, `$1${MASK}`],
  // «пароль qwerty»-вариант без двоеточия
  [/((?<![\p{L}])(?:пароль|password)[ \t]+)(?!\[скрыто\])[^\s,.;]{4,}/giu, `$1${MASK}`],
  // пути к .env и файлам credentials
  [/[^\s'"`]*\.env(?:\.[\w.-]+)?\b|[^\s'"`]*credentials[^\s'"`]*/gi, MASK],
];

export function redact(text) {
  let out = String(text ?? '');
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
