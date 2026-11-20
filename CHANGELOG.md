# Changelog

All notable changes to Leo. Format: [Keep a Changelog](https://keepachangelog.com/), versions: [SemVer](https://semver.org/).

## [0.3.0] - 2026-11-20

### Added
- English is the default language of all messages and of the Haiku prompt; Russian via `LEO_LANG=ru` or `"lang": "ru"` (all keys exist in both languages, checked by a test). Language falls back to the system locale.
- `leo doctor [--ping]`: Node >= 18, `claude` in PATH and its version, `--safe-mode` support, write access, `config.json`, hooks, sources, optional real test call with time and cost. Each problem says what to fix.
- `leo status`, `leo log [n]` (verdicts, blocks, cost, average time).
- Slash commands `/leo:show`, `/leo:status`, `/leo:doctor`, `/leo:off`, `/leo:on` (skills).
- `config.json` settings with a JSON schema: `mode` (block or advice), `minLength`, `triggers`, `model`, `maxCostPerDay`, `roles`, `ruleTtlDays`, `log`, `lang`, `profile`.
- README.md in English (main) and README.ru.md, including "What leaves your machine".

### Changed
- The Haiku prompt and block messages no longer contain the author's private vocabulary (director / owner / "not a programmer"); that vocabulary lives in the optional `profile: "director"` (Russian). Roles are now called reader and skeptic; the parser still accepts the old `owner` key.
- Secret mask is `[hidden]`.
- plugin.json and marketplace.json descriptions are in English; added `homepage`.

## [0.2.0] - 2026-11-20

### Fixed
- Secret filter no longer masks file paths. `<project-dir>\repos\norma-hr\.env`, `.env.example` and `docs/credentials-guide.md` stay readable; only the values are masked (`KEY=value` lines, `credentials: value`).
- The bare "password <word>" rule now fires only when the word contains a digit (no more `password manager` -> `password [hidden]`).

### Added
- More secret formats: Stripe (`sk_live_`, `rk_live_`), Google (`ya29.`), Slack app tokens (`xapp-`), SendGrid, Azure connection strings, GitHub `ghu_`/`ghr_`, AWS `ASIA`.
- English claim triggers for the final-answer check (done, finished, fixed, shipped, deployed, works, verified, tests pass...), besides the Russian ones.
- Files are created with mode 0600 (POSIX); `LEO_NO_LOG=1` or `{"log": false}` in `config.json` disables the journal.
- `scripts/scan-history.mjs`: dependency-free secret scan of the whole git history.
- 40+ secret samples (25 positive, 23 negative) and a regression test for the `.env` path.

### Changed
- stdin is read asynchronously (no busy-wait).

### Removed
- `docs/leo-docs-quotes.md` (copies of third-party documentation).
