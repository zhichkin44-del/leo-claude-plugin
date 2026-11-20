// Настройки Leo: ~/.claude/leo/config.json (или $LEO_HOME/config.json). Все ключи необязательны.
// Схема описана в docs/config.schema.json; validateConfig() используется в `leo doctor`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { leoHome } from './state.mjs';

export const DEFAULTS = {
  lang: '',            // 'en' | 'ru'; пусто — по LEO_LANG и локали
  profile: 'default',  // 'default' | 'director' (личный словарь автора)
  mode: 'advice',      // 'advice' — только подсказка (по умолчанию); 'block' — серьёзная находка возвращает ответ на доработку
  minLength: 600,      // длинный ответ без слов-утверждений тоже проверяется от этой длины
  model: 'haiku',      // модель проверки
  claudePath: '',      // полный путь к claude; пусто — искать в LEO_CLAUDE, PATH и стандартных местах
  maxCostPerDay: 0,    // доллары в сутки; 0 — без лимита
  roles: { reader: true, skeptic: true },
  ruleTtlDays: 1,      // сколько дней живёт правило, записанное ассистентом
  triggers: [],        // свои слова-утверждения для проверки итога
  log: true,           // false — не вести журнал
  autoCollect: true,   // собирать состояние из транскрипта (PreCompact)
  sources: {},         // status / handoffDir / memoryIndex
};

const KEYS = Object.keys(DEFAULTS);

export function readConfigFile(env = process.env) {
  const file = join(leoHome(env), 'config.json');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return { found: false, file, raw: {} };
  }
  try {
    const raw = JSON.parse(text);
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { found: true, file, raw: {}, error: 'top level must be an object' };
    return { found: true, file, raw };
  } catch (e) {
    return { found: true, file, raw: {}, error: 'invalid JSON: ' + e.message };
  }
}

// → список текстовых проблем; пусто — всё хорошо
export function validateConfig(raw) {
  const p = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return ['top level must be an object'];
  for (const k of Object.keys(raw)) if (!KEYS.includes(k)) p.push(`unknown key "${k}"`);
  if ('lang' in raw && !['', 'en', 'ru'].includes(raw.lang)) p.push('"lang" must be "en" or "ru"');
  if ('profile' in raw && !['default', 'director'].includes(raw.profile)) p.push('"profile" must be "default" or "director"');
  if ('mode' in raw && !['block', 'advice'].includes(raw.mode)) p.push('"mode" must be "block" or "advice"');
  for (const k of ['minLength', 'maxCostPerDay', 'ruleTtlDays']) {
    if (k in raw && !(typeof raw[k] === 'number' && Number.isFinite(raw[k]) && raw[k] >= 0)) p.push(`"${k}" must be a number >= 0`);
  }
  if ('model' in raw && !(typeof raw.model === 'string' && /^[\w.:-]+$/.test(raw.model))) p.push('"model" must be a model name such as "haiku"');
  if ('claudePath' in raw && typeof raw.claudePath !== 'string') p.push('"claudePath" must be a string with the full path to claude');
  if ('roles' in raw) {
    if (raw.roles === null || typeof raw.roles !== 'object' || Array.isArray(raw.roles)) p.push('"roles" must be an object like {"reader": true, "skeptic": true}');
    else for (const [k, v] of Object.entries(raw.roles)) {
      if (!['reader', 'skeptic'].includes(k)) p.push(`unknown role "${k}"`);
      else if (typeof v !== 'boolean') p.push(`role "${k}" must be true or false`);
    }
  }
  if ('triggers' in raw && !(Array.isArray(raw.triggers) && raw.triggers.every((x) => typeof x === 'string'))) p.push('"triggers" must be an array of strings');
  for (const k of ['log', 'autoCollect']) if (k in raw && typeof raw[k] !== 'boolean') p.push(`"${k}" must be true or false`);
  if ('sources' in raw) {
    if (raw.sources === null || typeof raw.sources !== 'object' || Array.isArray(raw.sources)) p.push('"sources" must be an object');
    else for (const [k, v] of Object.entries(raw.sources)) {
      if (!['status', 'handoffDir', 'memoryIndex'].includes(k)) p.push(`unknown source "${k}"`);
      else if (typeof v !== 'string') p.push(`source "${k}" must be a string path`);
    }
  }
  return p;
}

// Рабочие настройки: значения по умолчанию + корректные ключи из файла (плохие значения игнорируются, а не валят хук).
export function loadConfig(env = process.env) {
  const { raw } = readConfigFile(env);
  const cfg = { ...DEFAULTS, roles: { ...DEFAULTS.roles }, sources: {} };
  if (raw && typeof raw === 'object') {
    const bad = new Set(validateConfig(raw).flatMap((m) => [...m.matchAll(/"(\w+)"/g)].map((x) => x[1])));
    for (const k of KEYS) {
      if (!(k in raw) || bad.has(k)) continue;
      if (k === 'roles') cfg.roles = { ...cfg.roles, ...Object.fromEntries(Object.entries(raw.roles).filter(([rk, v]) => ['reader', 'skeptic'].includes(rk) && typeof v === 'boolean')) };
      else if (k === 'sources') cfg.sources = raw.sources;
      else cfg[k] = raw[k];
    }
  }
  if (env.LEO_MODE === 'block' || env.LEO_MODE === 'advice') cfg.mode = env.LEO_MODE;
  if (env.LEO_MODEL) cfg.model = env.LEO_MODEL;
  if (env.LEO_MIN_LENGTH && Number(env.LEO_MIN_LENGTH) >= 0) cfg.minLength = Number(env.LEO_MIN_LENGTH);
  return cfg;
}
