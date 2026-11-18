# Leo — плагин Claude Code: память после сжатия и проверка итоговых ответов

Leo подключается к главной сессии Claude Code двумя хуками и решает две задачи: после сжатия контекста возвращает в сессию главное (рабочие окна, что ждёт решения, правила дня, невыполненные обещания), а перед итоговым ответом владельцу просит Claude Haiku проверить его в двух ролях — «владелец» и «скептик». Без внешних зависимостей, без фоновых процессов, хука на каждое сообщение нет.

*EN: Leo is a Claude Code plugin with two hooks. After context compaction it restores the working state (open sessions, pending decisions, today's rules, unfulfilled promises). Before a final answer reaches the user it runs one tool-free, single-turn Claude Haiku call that plays a "reader" and a "skeptic" and blocks the answer on a serious finding. Node.js only, no dependencies, 57 tests.*

## Схема

```
SessionStart (compact|resume) ──► hooks/session-start.mjs ──► lib/restore.mjs ──► ≤ 40 строк в контекст
                                      источники: STATUS.md, HANDOFF-*.md, индекс памяти, state.json

Stop (итоговый ответ) ──► hooks/stop.mjs ──► lib/skeptic.mjs ──► claude -p (Haiku, без инструментов, 1 ход, таймаут)
                              │                                        │
                              │   фильтр секретов (lib/secrets.mjs) ◄──┘ вердикт JSON
                              ▼
                  серьёзная находка → decision: block + причина
                  подсказка о новом правиле → additionalContext
                  иначе → тишина
```

| Хук | Что происходит |
|---|---|
| `SessionStart`, matcher `compact\|resume` | Возвращает в контекст не больше 40 строк. Источники настраиваются (см. ниже), нет файла — источник молча пропускается. |
| `Stop` | Если ответ — итог (от 600 знаков или от 120 со словами «сделано / слито / готово…»), один вызов Haiku: роль «владелец» (понятно ли, коротко ли, нет ли жаргона), роль «скептик» (нет ли непроверенных утверждений и пропущенных обещаний) и вопрос, не дал ли владелец нового устойчивого указания. Слов-триггеров в коде нет — решает модель, при сомнении молчит. |

Вызов Haiku изолирован: `claude -p --safe-mode --model haiku --output-format json --no-session-persistence --disallowedTools "*" --max-turns 1`, запрос идёт через stdin, таймаут 45 с. `--safe-mode` отключает хуки и плагины в этом вызове, поэтому Leo не запускает сам себя. Всё, что пишется в файлы или уходит в Haiku, проходит фильтр секретов. Любая ошибка хука — запись в журнал и тихий выход с кодом 0; не больше одного вызова Haiku на ответ и одного круга блокировки.

## Запуск одной командой

Нужны Node.js 18+ и `claude` в PATH.

```bash
claude plugin marketplace add zhichkin44-del/leo-claude-plugin && claude plugin install leo@leo-marketplace
```

Хуки подхватываются при новом запуске сессии. Проверка: `claude plugin list`, затем `node "<папка плагина>/bin/leo.mjs" show` — покажет, что Leo вернул бы после сжатия.

Выключить, не удаляя: `node "<папка плагина>/bin/leo.mjs" off` (обратно — `on`). Полностью: `claude plugin uninstall leo@leo-marketplace`.

## Настройка

Состояние лежит в `~/.claude/leo/` (папка меняется через `LEO_HOME`): `state.json`, журнал `leo.log` (вердикт, число находок, время, цена каждого вызова), файл-выключатель `off`.

Источники для возврата после сжатия задаются в `~/.claude/leo/config.json`:

```json
{ "sources": { "status": "/путь/STATUS.md", "handoffDir": "/путь/к/папке", "memoryIndex": "/путь/MEMORY.md" } }
```

или переменными `LEO_STATUS`, `LEO_HANDOFF_DIR`, `LEO_MEMORY_INDEX`. Прочее: `LEO_OFF=1` (хуки молчат), `LEO_HAIKU_TIMEOUT_MS` (по умолчанию 45000), `LEO_CLAUDE` (путь к `claude`).

Записи ведёт сама сессия через CLI:

```bash
node "<папка плагина>/bin/leo.mjs" window set <имя> <статус> "<заметка>"
node "<папка плагина>/bin/leo.mjs" wait add "<что ждёт решения>"
node "<папка плагина>/bin/leo.mjs" promise add "<обещано>"   # и: promise done <id>
node "<папка плагина>/bin/leo.mjs" rule add "<правило дня>"   # и: rule drop <id>
```

## Тесты

```bash
npm test
```

Результат запуска 18.11.2026 (Node.js, `node --test`): **57 тестов, 56 прошли, 0 упали, 1 пропущен** — пропущена проверка `claude plugin validate`, она выполняется только при установленном `claude`. Вместо настоящего `claude` тесты используют подставной `tests/fake-claude.mjs`. Покрыто: петля `stop_hook_active`, таймаут, кривой вход (пусто, `null`, массив, неверные типы), битый `state.json`, фильтр секретов, лимит 40 строк, служебные сообщения в транскрипте, отсутствие слов-триггеров в коде.

## Ограничения

- Haiku вызывается через установленный `claude`, поэтому нужны его вход в аккаунт и доступ к сети; задержка проверки 8–11 с на итоговый ответ (замер на Windows, прямой запуск `claude.exe`; через `claude.cmd` около 22 с).
- Проверка вероятностная: модель может пропустить находку или придраться зря. Одна серьёзная находка даёт один круг блокировки, дальше ответ уходит.
- Источники для возврата после сжатия по умолчанию не заданы — без настройки работают только записи Leo (`state.json`).
- Тесты прогнаны на Windows; на других системах не запускались.

## Лицензия

MIT
