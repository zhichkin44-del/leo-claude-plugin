import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { ROOT, sandbox, runHook, runCli, FK } from './helpers.mjs';
import { collectFromTranscript } from '../lib/collect.mjs';
import { MAX_LINES } from '../lib/restore.mjs';

const EN = { LEO_LANG: 'en', LEO_PROFILE: 'default' };
const user = (text, extra = {}) => JSON.stringify({ type: 'user', isSidechain: false, message: { role: 'user', content: text }, ...extra });
const asst = (blocks) => JSON.stringify({ type: 'assistant', isSidechain: false, message: { role: 'assistant', content: blocks } });
const todo = (todos) => asst([{ type: 'tool_use', name: 'TodoWrite', input: { todos } }]);
const edit = (file, name = 'Edit') => asst([{ type: 'tool_use', name, input: { file_path: file } }]);

function transcript(sb, lines, name = 'tr.jsonl') {
  return sb.write(name, lines.join('\n') + '\n');
}
const sample = (sb) => transcript(sb, [
  user('Please refactor the parser module and keep the public API'),
  asst([{ type: 'text', text: 'On it.' }]),
  todo([{ content: 'Split tokenizer', status: 'completed', activeForm: 'Splitting' }, { content: 'Rewrite error messages', status: 'in_progress', activeForm: 'Rewriting' }, { content: 'Update docs', status: 'pending', activeForm: 'Updating' }]),
  edit('/repo/src/parser.js'),
  edit('/repo/src/tokenizer.js', 'Write'),
  user('Also, never commit directly to main. Use a branch.'),
  user('<system-reminder>service text</system-reminder>'),
  user('Now run the tests and show me the output'),
]);

// ---------- автосбор ----------
test('collect: открытые задачи из TodoWrite (завершённые не берём)', () => {
  const sb = sandbox();
  const c = collectFromTranscript(sample(sb));
  assert.deepEqual(c.tasks, ['Rewrite error messages (in progress)', 'Update docs']);
});

test('collect: последняя просьба — без служебных сообщений', () => {
  const sb = sandbox();
  const c = collectFromTranscript(sample(sb));
  assert.equal(c.intent, 'Now run the tests and show me the output');
});

test('collect: устойчивые указания «never/always/всегда/никогда», разовые просьбы не берём', () => {
  const sb = sandbox();
  const c = collectFromTranscript(sample(sb));
  assert.deepEqual(c.rules, ['Also, never commit directly to main.']);
  const tr = transcript(sb, [user('Всегда пиши коротко. Исправь опечатку в README'), user('fix the typo please')], 'ru.jsonl');
  assert.deepEqual(collectFromTranscript(tr).rules, ['Всегда пиши коротко.']);
});

test('collect: тронутые файлы — последние, без повторов', () => {
  const sb = sandbox();
  const tr = transcript(sb, [edit('/a.js'), edit('/b.js'), edit('/a.js'), edit('/c.js', 'MultiEdit')]);
  assert.deepEqual(collectFromTranscript(tr).files, ['/b.js', '/a.js', '/c.js']);
});

test('collect: секреты в просьбах и задачах маскируются', () => {
  const sb = sandbox();
  const tr = transcript(sb, [user('use key ' + FK.sk + ' for the call, always'), todo([{ content: 'set password: hunter2hunter2', status: 'pending' }])]);
  const c = collectFromTranscript(tr);
  const all = JSON.stringify(c);
  assert.ok(!all.includes(FK.sk));
  assert.ok(!all.includes('hunter2'));
});

test('collect: нет файла, пустой, мусор, чужие типы — пустой результат без падения', () => {
  const sb = sandbox();
  for (const p of [undefined, '', join(sb.dir, 'нет.jsonl'), sb.dir, transcript(sb, ['{{{', 'null', '42', '"x"'], 'junk.jsonl')]) {
    const c = collectFromTranscript(p);
    assert.deepEqual(c, { intent: '', tasks: [], rules: [], files: [] });
  }
});

test('collect: сообщения подагентов (isSidechain) игнорируются', () => {
  const sb = sandbox();
  const tr = transcript(sb, [user('main request here ok'), user('sidechain never do this', { isSidechain: true })]);
  const c = collectFromTranscript(tr);
  assert.equal(c.intent, 'main request here ok');
  assert.deepEqual(c.rules, []);
});

// ---------- хуки ----------
test('hooks.json: SessionStart, PreCompact, PostCompact, Stop; нет хука на каждое сообщение', () => {
  const h = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(Object.keys(h).sort(), ['PostCompact', 'PreCompact', 'SessionStart', 'Stop']);
  assert.equal(h.SessionStart[0].matcher, 'compact|resume');
  for (const [ev, file] of [['PreCompact', 'precompact.mjs'], ['PostCompact', 'postcompact.mjs']]) {
    const hk = h[ev][0].hooks[0];
    assert.equal(hk.command, 'node');
    assert.deepEqual(hk.args, ['${CLAUDE_PLUGIN_ROOT}/hooks/' + file]);
    assert.ok(existsSync(join(ROOT, 'hooks', file)));
    assert.ok(hk.timeout > 0 && hk.timeout <= 30);
  }
});

test('PreCompact: сохраняет состояние сессии по session_id, молчит, код 0', () => {
  const sb = sandbox();
  const r = runHook('precompact.mjs', { session_id: 'S1', hook_event_name: 'PreCompact', trigger: 'auto', transcript_path: sample(sb), cwd: '/repo' }, sb.env);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  const s = sb.state().sessions.S1;
  assert.equal(s.intent, 'Now run the tests and show me the output');
  assert.equal(s.tasks.length, 2);
  assert.equal(s.cwd, '/repo');
});

test('PostCompact: пишет событие в журнал, ничего не печатает', () => {
  const sb = sandbox();
  const r = runHook('postcompact.mjs', { session_id: 'S1', hook_event_name: 'PostCompact', trigger: 'auto' }, sb.env);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), '');
  assert.match(sb.log(), /"event":"compact"/);
});

test('PreCompact: autoCollect=false — ничего не сохраняем', () => {
  const sb = sandbox();
  writeFileSync(join(sb.home, 'config.json'), JSON.stringify({ autoCollect: false }));
  runHook('precompact.mjs', { session_id: 'S1', transcript_path: sample(sb), cwd: '/repo' }, sb.env);
  assert.equal(sb.state(), null);
});

test('хуки сжатия: мусор на входе и выключатель — тишина и код 0', () => {
  const sb = sandbox();
  for (const name of ['precompact.mjs', 'postcompact.mjs']) {
    for (const input of ['', 'не json', '[]', 'null']) {
      const r = runHook(name, input, sb.env);
      assert.equal(r.code, 0);
      assert.equal(r.stdout.trim(), '');
    }
    assert.equal(runHook(name, { session_id: 'S', transcript_path: sample(sb) }, { ...sb.env, LEO_OFF: '1' }).code, 0);
  }
  assert.equal(sb.state(), null);
});

// ---------- «из коробки» ----------
const noSources = (sb) => ({ ...sb.env, ...EN, LEO_STATUS: '', LEO_HANDOFF_DIR: '', LEO_MEMORY_INDEX: '' });

test('из коробки: без настройки и без записей Leo после сжатия возврат непустой — 5 прогонов из 5', () => {
  let nonEmpty = 0;
  for (let i = 0; i < 5; i++) {
    const sb = sandbox();
    const env = noSources(sb);
    const tr = sample(sb);
    runHook('precompact.mjs', { session_id: 'S' + i, transcript_path: tr, cwd: '/repo' }, env);
    const r = runHook('session-start.mjs', { session_id: 'S' + i, hook_event_name: 'SessionStart', source: 'compact', transcript_path: tr, cwd: '/repo' }, env);
    const c = r.json?.hookSpecificOutput?.additionalContext ?? '';
    if (c.includes('Rewrite error messages') && c.includes('Now run the tests') && c.includes('never commit directly to main') && c.includes('parser.js')) nonEmpty++;
  }
  assert.equal(nonEmpty, 5);
});

test('из коробки: даже без PreCompact SessionStart сам собирает состояние из транскрипта', () => {
  const sb = sandbox();
  const env = noSources(sb);
  const r = runHook('session-start.mjs', { session_id: 'Z', source: 'compact', transcript_path: sample(sb), cwd: '/repo' }, env);
  const c = r.json.hookSpecificOutput.additionalContext;
  assert.match(c, /Open tasks:/);
  assert.match(c, /Rewrite error messages \(in progress\)/);
  assert.match(c, /Last request from the user:/);
  assert.doesNotMatch(c, /no saved state/);
});

test('из коробки: нет транскрипта и нет записей — честное «ничего нет» (не пустота и не выдумка)', () => {
  const sb = sandbox();
  const r = runHook('session-start.mjs', { session_id: 'Z', source: 'compact' }, noSources(sb));
  assert.match(r.json.hookSpecificOutput.additionalContext, /no saved state/);
});

test('если транскрипт недоступен, берём то, что PreCompact сохранил для этого session_id', () => {
  const sb = sandbox();
  const env = noSources(sb);
  runHook('precompact.mjs', { session_id: 'S9', transcript_path: sample(sb), cwd: '/repo' }, env);
  const r = runHook('session-start.mjs', { session_id: 'S9', source: 'compact', transcript_path: join(sb.dir, 'удалён.jsonl') }, env);
  assert.match(r.json.hookSpecificOutput.additionalContext, /Rewrite error messages/);
});

test('изоляция по session_id: два окна не видят задач друг друга', () => {
  const sb = sandbox();
  const env = noSources(sb);
  const trA = transcript(sb, [user('task for window A only'), todo([{ content: 'ALPHA-TASK', status: 'pending' }])], 'a.jsonl');
  const trB = transcript(sb, [user('task for window B only'), todo([{ content: 'BETA-TASK', status: 'pending' }])], 'b.jsonl');
  runHook('precompact.mjs', { session_id: 'A', transcript_path: trA, cwd: '/a' }, env);
  runHook('precompact.mjs', { session_id: 'B', transcript_path: trB, cwd: '/b' }, env);
  const a = runHook('session-start.mjs', { session_id: 'A', source: 'compact', cwd: '/a' }, env).json.hookSpecificOutput.additionalContext;
  const b = runHook('session-start.mjs', { session_id: 'B', source: 'compact', cwd: '/b' }, env).json.hookSpecificOutput.additionalContext;
  assert.ok(a.includes('ALPHA-TASK') && !a.includes('BETA-TASK'));
  assert.ok(b.includes('BETA-TASK') && !b.includes('ALPHA-TASK'));
});

test('resume под новым session_id берёт состояние последней сессии той же папки (cwd)', () => {
  const sb = sandbox();
  const env = noSources(sb);
  runHook('precompact.mjs', { session_id: 'OLD', transcript_path: sample(sb), cwd: '/repo' }, env);
  const r = runHook('session-start.mjs', { session_id: 'NEW', source: 'resume', cwd: '/repo' }, env);
  assert.match(r.json.hookSpecificOutput.additionalContext, /Rewrite error messages/);
  const other = runHook('session-start.mjs', { session_id: 'NEW2', source: 'resume', cwd: '/elsewhere' }, env);
  assert.doesNotMatch(other.json.hookSpecificOutput.additionalContext, /Rewrite error messages/);
});

test('возврат не длиннее 40 строк даже при огромном транскрипте', () => {
  const sb = sandbox();
  const lines = [];
  for (let i = 0; i < 300; i++) lines.push(user('always do thing number ' + i + ' carefully'), edit('/f' + i + '.js'));
  lines.push(todo(Array.from({ length: 80 }, (_, i) => ({ content: 'task ' + i, status: 'pending' }))));
  const r = runHook('session-start.mjs', { session_id: 'Z', source: 'compact', transcript_path: transcript(sb, lines) }, noSources(sb));
  assert.ok(r.json.hookSpecificOutput.additionalContext.split('\n').length <= MAX_LINES);
});

test('ручные записи и автосбор уживаются в одном возврате', () => {
  const sb = sandbox();
  const env = noSources(sb);
  runCli(['wait', 'add', 'approve the release'], env);
  const r = runHook('session-start.mjs', { session_id: 'Z', source: 'compact', transcript_path: sample(sb) }, env);
  const c = r.json.hookSpecificOutput.additionalContext;
  assert.match(c, /approve the release/);
  assert.match(c, /Open tasks:/);
});

test('старые сессии вытесняются: хранится не больше 10', () => {
  const sb = sandbox();
  for (let i = 0; i < 14; i++) {
    runHook('precompact.mjs', { session_id: 'S' + i, transcript_path: sample(sb), cwd: '/r' + i }, { ...sb.env, LEO_NOW: `2026-11-14T10:${String(i).padStart(2, '0')}:00+07:00` });
  }
  const keys = Object.keys(sb.state().sessions);
  assert.equal(keys.length, 10);
  assert.ok(keys.includes('S13') && !keys.includes('S0'));
});

// ---------- CI ----------
test('CI: workflow на 3 ОС × Node 18/20/22, тесты, покрытие, validate, секреты, 0 зависимостей', () => {
  const y = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  for (const os of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.match(y, new RegExp(os));
  for (const n of ['18', '20', '22']) assert.match(y, new RegExp("'" + n + "'"));
  assert.match(y, /npm test/);
  assert.match(y, /coverage/);
  assert.match(y, /plugin validate --strict/);
  assert.match(y, /gitleaks/);
  assert.match(y, /node --check/);
  assert.match(y, /fail-fast: false/);
});

test('покрытие: скрипт проверки порога 85% по lib/ есть и работает на синтетическом отчёте', () => {
  const s = join(ROOT, 'scripts', 'check-coverage.mjs');
  assert.ok(existsSync(s));
  const mk = (pct) => ['ℹ start of coverage report', 'ℹ file | line % | branch % | funcs % | uncovered lines', 'ℹ lib | | | |', `ℹ  a.mjs | ${pct} | 80 | 80 |`, `ℹ  b.mjs | ${pct} | 80 | 80 |`, 'ℹ tests | | | |', 'ℹ  h.mjs | 10 | 80 | 80 |', 'ℹ end of coverage report'].join('\n');
  const d = mkdtempSync(join(tmpdir(), 'leo-cov-'));
  writeFileSync(join(d, 'ok.txt'), mk(90));
  writeFileSync(join(d, 'bad.txt'), mk(70));
  assert.equal(spawnSync(process.execPath, [s, join(d, 'ok.txt')], { encoding: 'utf8' }).status, 0);
  assert.equal(spawnSync(process.execPath, [s, join(d, 'bad.txt')], { encoding: 'utf8' }).status, 1);
});

test('package.json: скрипты test и coverage', () => {
  const p = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.ok(p.scripts.test);
  assert.match(p.scripts.coverage, /--coverage/);
  assert.match(readFileSync(join(ROOT, 'scripts', 'run-tests.mjs'), 'utf8'), /experimental-test-coverage/);
  assert.match(p.scripts.check, /node --check|check-syntax/);
});

test('ci.yml читается как YAML-текст: нет табов, есть name и on', () => {
  const y = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(y, /\t/);
  assert.match(y, /^name: /m);
  assert.match(y, /^on:/m);
});
