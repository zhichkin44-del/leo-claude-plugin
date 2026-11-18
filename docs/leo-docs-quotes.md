# Leo: цитаты из живой документации Claude Code

Снято 14.11.2026 с https://code.claude.com/docs/en/hooks, /plugins-reference, /plugin-marketplaces, /cli-reference (Claude Code 2.1.322). Цитаты короткие, дословные; всё остальное — пересказ.

## Хуки: общее
- Вход приходит JSON в stdin; общие поля: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`.
- Выход: «Success: your hook exits 0», «Blocking error: your hook exits 2»; любой другой код — «Non-blocking error». JSON считается JSON-ом, только если stdout — «one JSON object … with nothing around it but whitespace».
- Вывод exit 0 + plain text: «Claude Code adds a SessionStart hook's plain-text stdout to Claude's context» (то же для UserPromptSubmit).
- `additionalContext` кладётся в `hookSpecificOutput` вместе с `hookEventName`. «If a value exceeds 10,000 characters, Claude Code writes the text to a file … and passes Claude the file path with a preview of up to the first 2,000 characters» → Leo держит вывод ≤ 40 строк и < 9000 знаков.
- Совет доки: писать «as factual statements rather than imperative system instructions» — иначе защита от инъекций может показать текст пользователю, а не применить. → тексты Leo — «факты и напоминание», не приказы.
- `timeout` (сек): по умолчанию 600 для command; на UserPromptSubmit — 30.
- Формы запуска: «exec form» (`command` + `args`, без shell) и shell form. «On Windows, exec form requires `command` to resolve to a real executable such as a `.exe`» — `node` подходит. Мы используем exec form: `"command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/hooks/…"]`.
- В процесс хука экспортируются `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `CLAUDE_PROJECT_DIR`.

## SessionStart
- matcher: `startup`, `resume`, `clear`, `compact` («Auto or manual compaction»), `fork`.
- Вход: `source` (`"compact"` после сжатия, `"resume"` при возобновлении).
- «SessionStart runs on every session, so keep these hooks fast.»; «Claude's first response still waits for the hooks to finish».
- Вывод: `hookSpecificOutput.additionalContext`, либо просто текст в stdout.

## UserPromptSubmit (Leo его не использует с 14.11 — слово Саши: правило по слову из текста не появляется; подсказку даёт Haiku на Stop)
- Вход: поле `prompt`. Хук срабатывает и на не-человеческие подсказки: «A session-scoped scheduled task firing, including a /loop iteration», «A background subagent reporting back», «A message another session sends to your main conversation». → Leo отсекает сообщения-не-от-Саши (теги `<task-notification>`, `<side-sessions-event>`, `<system-reminder>`, `<ci-monitor-event>`) и слишком длинные тексты.
- Таймаут по умолчанию 30 с; «a UserPromptSubmit … hook that reaches its timeout is canceled … The prompt still reaches Claude».
- Контекст: `hookSpecificOutput.additionalContext`.

## Stop
- Вход: `stop_hook_active` («true when Claude Code is already continuing as a result of a stop hook»), `last_assistant_message` («the text content of Claude's final response»), `background_tasks`, `session_crons`.
- «Claude Code applies an 8-consecutive-continuation cap».
- Блок: `{"decision":"block","reason":"…"}`; «`reason` Required when `decision` is `"block"`». Или exit 2 + stderr. «Does not run if the stoppage occurred due to a user interrupt.»
- Есть мягкий вариант `hookSpecificOutput.additionalContext` («Non-error feedback») — разговор продолжается без «ошибки хука». Leo использует `decision: block` (как велено).

## PreCompact (важно для PR #9/#10)
- Вход: `trigger` (`manual`/`auto`), `custom_instructions`.
- «When a PreCompact hook exits 0 and doesn't block, Claude Code uses its stdout as instructions for the compaction summary. Keep that stdout under 10,000 characters.»
- Это **опровергает** блокер №1 PR #9 («stdout PreCompact в сводку не попадает»): по живой доке попадает — как инструкция для сводки. Leo этим не пользуется (ему хватает SessionStart), но README старого проекта утверждал верно.

## Плагин
- `.claude-plugin/plugin.json`: обязательно только `name` (kebab-case); `version`, `description`, `author{name}`, `homepage` (должен быть URL), `license`, `keywords`.
- `hooks/hooks.json` лежит в корне плагина (не в `.claude-plugin/`), «A hooks file wraps the event map in a top-level "hooks" key».
- «`${CLAUDE_PLUGIN_ROOT}` changes when the plugin updates, so don't write state there.» `${CLAUDE_PLUGIN_DATA}` = `~/.claude/plugins/data/<id>/`, «Claude Code deletes the `${CLAUDE_PLUGIN_DATA}` directory when you uninstall the plugin». → состояние Leo лежит в `~/.claude/leo/` (переживает удаление и обновление), переопределяется `LEO_HOME`.
- Маркетплейс: `.claude-plugin/marketplace.json` — обязательны `name`, `owner`, `plugins[]` (`name`, `source`); относительный путь `source` — от корня маркетплейса.
- Установка: `claude plugin marketplace add <owner>/<repo>`, `claude plugin install <name>@<marketplace>`; в сессии `/plugin marketplace add …`. Отключить: `claude plugin disable`; удалить: `claude plugin marketplace remove <name>` («removes the marketplace and uninstalls its plugins»). Локальная проверка: `claude plugin validate <dir>`.

## CLI для вызова Haiku из хука
- `--model haiku`, `-p`, `--output-format json`, `--no-session-persistence`, `--max-turns`, `--disallowedTools "*"` («removes every tool»).
- `--safe-mode`: «Start with all customizations disabled … plugins, hooks … do not load. Authentication, model selection … work normally» — внутренний вызов Haiku не запускает хуки Leo (нет петли) и не тянет CLAUDE.md.
- Замер (Windows): через `claude.cmd` с `shell:true` — 22 с; напрямую `claude.exe` — 7 с (ответ 2–4 с, ≈ $0.0002–0.0006). → Leo ищет `claude.exe` (рядом с `claude.cmd` в `node_modules/@anthropic-ai/claude-code/bin/`), потом `claude` в PATH, shell — последний запасной путь.

## Транскрипт (для «последних сообщений Саши»)
- Поле `transcript_path` приходит во всех хуках; «The transcript file is written asynchronously and may lag the in-memory conversation» — поэтому ответ директора берётся из `last_assistant_message`, а из транскрипта — только предыдущие сообщения Саши.
- Формат строки jsonl (снято с живой сессии 14.11, Claude Code 2.1.321): `{"type":"user","isSidechain":false,"message":{"role":"user","content":"…"|[{"type":"text",…}|{"type":"tool_result",…}]}}`; рядом идут служебные типы (`attachment`, `system`, `api-request-blob` и др.) — они пропускаются. Служебные «user»-сообщения начинаются с `<system-reminder>`, `<task-notification>` и т. п. — тоже пропускаются. Формат недокументирован → при любом сбое Leo получает `[]` и просто проверяет без сообщений Саши.
