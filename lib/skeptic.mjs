// Проверка итогового ответа: один вызов Haiku в двух ролях — «читатель» и «скептик» — плюс вопрос про новое устойчивое правило.
import { loadState, saveState, clean, sameText, newId, now, today, logEvent, activeRules, MAX } from './state.mjs';
import { recentUserMessages } from './transcript.mjs';
import { redact } from './secrets.mjs';
import { askHaiku, extractJson, findClaude, noteClaudeMissingOnce } from './haiku.mjs';
import { loadConfig, DEFAULTS } from './config.mjs';
import { t } from './i18n.mjs';

const MIN_ANY = 120;
const MAX_SEND = 8000;
const MAX_ISSUES = 3;
const ISSUE_LEN = 240;
const PROMISE_TTL_MS = 3 * 24 * 3600 * 1000;
const CLAIM = /(?<![p{L}])(сделано|слит[оаы]?|слил[аи]?|готов[оаы]?|влит[оаы]?|смержен[оаы]?|закрыт[оаы]?|исправлен[оаы]?|проверено|принят[оаы]?|работает|выложен[оаы]?|merged|done|finished|fixed|shipped|deployed|completed?|resolved|works|working|verified|tests?\s+pass(?:ed|ing)?|all\s+(?:green|good))(?![p{L}])/iu;
const esc = (w) => w.replace(/[.*+?^${}()|[]\]/g, '\$&');

// Итог для пользователя: длинный, или с утверждениями «сделано/слито/готово/done/fixed».
export function isSummary(msg, cfg = DEFAULTS) {
  if (typeof msg !== 'string') return false;
  const x = msg.trim();
  if (x.length >= (cfg.minLength ?? DEFAULTS.minLength)) return true;
  if (x.length < MIN_ANY) return false;
  if (CLAIM.test(x)) return true;
  const extra = (cfg.triggers ?? []).filter((w) => typeof w === 'string' && w.trim());
  return extra.length > 0 && new RegExp('(?<![\p{L}])(?:' + extra.map(esc).join('|') + ')(?![\p{L}])', 'iu').test(x);
}

export function buildPrompt(msg, st, env = process.env, userMsgs = [], cfg = loadConfig(env)) {
  const rules = activeRules(st, env, cfg.ruleTtlDays).slice(-8).map((r) => '- ' + r.text);
  const promises = st.promises.slice(-8).map((p) => '- ' + p.text);
  const body = redact(msg.length > MAX_SEND ? msg.slice(0, MAX_SEND / 2) + '\n' + t('truncated', env) + '\n' + msg.slice(-MAX_SEND / 2) : msg);
  const roleNote = cfg.roles.reader && !cfg.roles.skeptic ? [t('promptOnlyReader', env)] : !cfg.roles.reader && cfg.roles.skeptic ? [t('promptOnlySkeptic', env)] : [];
  return [
    t('promptIntro', env),
    t('promptData', env),
    '',
    t('promptThree', env),
    t('promptQ1', env),
    t('promptQ2', env),
    t('promptQ3', env),
    '',
    t('promptSerious', env),
    t('promptPromises', env),
    ...roleNote,
    '',
    t('promptJson', env),
    t('promptJsonShape', env),
    t('promptHintShape', env),
    '',
    t('dataUser', env),
    userMsgs.map((m) => '- ' + m).join('\n') || t('unknown', env),
    t('dataRules', env),
    rules.join('\n') || t('none', env),
    t('dataPromises', env),
    promises.join('\n') || t('none', env),
    t('dataAnswer', env),
    body,
    t('dataEnd', env),
  ].join('\n');
}

function issuesOf(role, node) {
  const arr = Array.isArray(node?.issues) ? node.issues : [];
  const out = [];
  for (const i of arr) {
    const text = typeof i === 'string' ? i : typeof i?.text === 'string' ? i.text : '';
    const sev = typeof i === 'object' && i ? String(i.severity ?? '').toLowerCase() : 'minor';
    if (text.trim()) out.push({ role, serious: sev === 'serious', text: clean(text, ISSUE_LEN) });
  }
  return out;
}

export function parseVerdict(text) {
  const j = extractJson(text);
  if (!j) return null;
  const issues = [...issuesOf('reader', j.reader ?? j.owner), ...issuesOf('skeptic', j.skeptic)];
  const promises = (Array.isArray(j.skeptic?.promises) ? j.skeptic.promises : []).filter((p) => typeof p === 'string' && p.trim()).map((p) => clean(p, 160)).slice(0, 5);
  let hint = null;
  const h = j.rule_hint;
  if (h && typeof h === 'object' && !Array.isArray(h) && typeof h.text === 'string' && h.text.trim()) {
    hint = { text: clean(h.text, 200), quote: typeof h.quote === 'string' ? clean(h.quote, 120) : '' };
  }
  return { issues, promises, hint };
}

function addPromises(list, env) {
  const st = loadState(env);
  const ts = now(env);
  st.promises = st.promises.filter((p) => !p.auto || !p.ts || ts - new Date(p.ts) < PROMISE_TTL_MS);
  for (const text of list) {
    if (!st.promises.some((p) => sameText(p.text, text))) st.promises.push({ id: newId('p', env), text, ts: ts.toISOString(), auto: true });
  }
  st.promises = st.promises.slice(-MAX.promises);
  saveState(st, env);
}

// Подсказка ассистенту, не команда: Leo ничего не пишет в память, решает ассистент.
export function hintLine(hint, env = process.env) {
  return t('hintLine', env, { text: hint.text, quote: hint.quote ? t('hintQuote', env, { quote: hint.quote }) : '' });
}

const roleLabel = (role, env) => t(role === 'reader' ? 'roleReader' : 'roleSkeptic', env);

export function blockReason(serious, hint, env = process.env, advice = false) {
  const lines = serious.slice(0, MAX_ISSUES).map((i, n) => `${n + 1}. [${roleLabel(i.role, env)}] ${i.text}`);
  return [
    t(advice ? 'adviceHead' : 'blockHead', env),
    ...lines,
    t(advice ? 'adviceTail' : 'blockTail', env),
    ...(hint ? [hintLine(hint, env)] : []),
  ].join('\n');
}

// Дневной расход на проверки: state.spend = {date, usd}
function spentToday(st, env) {
  return st.spend && st.spend.date === today(env) ? st.spend.usd : 0;
}
function addSpend(cost, env) {
  if (typeof cost !== 'number') return;
  const st = loadState(env);
  const d = today(env);
  st.spend = { date: d, usd: (st.spend?.date === d ? st.spend.usd : 0) + cost };
  saveState(st, env);
}

// Возвращает объект для печати хуком (block, подсказка) или null (тихо пропустить).
export async function reviewReply(input, env = process.env) {
  if (input.stop_hook_active === true) return null; // не больше одного круга
  const cfg = loadConfig(env);
  const msg = input.last_assistant_message;
  if (!isSummary(msg, cfg)) return null;
  if (!cfg.roles.reader && !cfg.roles.skeptic) return null;

  const st = loadState(env);
  if (cfg.maxCostPerDay > 0 && spentToday(st, env) >= cfg.maxCostPerDay) {
    logEvent(env, { event: 'stop', verdict: 'budget', usd: spentToday(st, env) });
    return null;
  }
  const r = await askHaiku(buildPrompt(msg, st, env, recentUserMessages(input.transcript_path, 3), cfg), env, undefined, cfg.model);
  if (!r.ok) {
    if (!findClaude(env).found) {
      // claude не найден: одна строка на сессию, подсказка — в leo doctor
      if (noteClaudeMissingOnce(env, input.session_id)) logEvent(env, { event: 'stop', verdict: 'claude-missing', ms: r.ms, hint: 'set claudePath in config.json' });
    } else {
      logEvent(env, { event: 'stop', verdict: 'haiku-failed', error: r.error, ms: r.ms });
    }
    return null;
  }
  addSpend(r.cost, env);
  const v = parseVerdict(r.text);
  if (!v) {
    logEvent(env, { event: 'stop', verdict: 'unparsed', ms: r.ms, cost: r.cost });
    return null;
  }
  v.issues = v.issues.filter((i) => cfg.roles[i.role]);
  if (v.promises.length && cfg.roles.skeptic) addPromises(v.promises, env);
  const serious = v.issues.filter((i) => i.serious);

  // Одну и ту же подсказку дважды не повторяем (и ту, что ассистент уже записал как правило).
  let hint = v.hint;
  if (hint) {
    const cur = loadState(env);
    if (cur.hintsSeen.some((x) => sameText(x, hint.text)) || cur.rules.some((x) => sameText(x.text, hint.text))) hint = null;
    else {
      cur.hintsSeen = [...cur.hintsSeen, hint.text].slice(-10);
      saveState(cur, env);
    }
  }

  const advice = cfg.mode === 'advice';
  logEvent(env, { event: 'stop', verdict: serious.length ? (advice ? 'advice' : 'block') : hint ? 'hint' : 'ok', serious: serious.length, minor: v.issues.length - serious.length, hint: !!hint, chars: msg.length, ms: r.ms, cost: r.cost });
  if (serious.length && !advice) return { decision: 'block', reason: blockReason(serious, hint, env) };
  if (serious.length) return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: blockReason(serious, hint, env, true) } };
  if (hint) return { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: hintLine(hint, env) } };
  return null;
}
