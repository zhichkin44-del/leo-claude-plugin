# Changelog

All notable changes to Leo. Format: [Keep a Changelog](https://keepachangelog.com/), versions: [SemVer](https://semver.org/).

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
