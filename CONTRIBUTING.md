# Contributing to Prototype Annotator

Thank you for your interest in improving **Prototype Annotator**! Writing down clear scope and ground rules helps keep the plugin fast, zero-dependency, and pleasant to maintain.

## Project Scope & Design Principles

- **Zero runtime npm dependencies**: client code uses only Paseo's host-provided React Native / SDK modules (`@getpaseo/plugin`, `react`, `react-native`, `zod`), and server code uses Node built-ins plus `@getpaseo/plugin/server`. PRs that add heavy runtime npm trees will generally be declined unless there is no viable built-in alternative.
- **Zero listening ports**: all file delivery and mobile snapshot rendering must travel over Paseo's existing RPC channel or stdio pipes (`--remote-debugging-pipe`), never by binding local HTTP/WebSocket ports.
- **Cross-platform & bilingual (`en` + `zh-CN`)**: UI components must follow Paseo's React Native cross-platform rules, use `theme.colors` tokens, and keep `client/locales/en.json` and `client/locales/zh-CN.json` keys in sync.

## Reporting Bugs & Suggesting Features

- **Bugs**: open a GitHub issue with your Paseo version, daemon OS (`macOS` / `Linux` / `Windows`), client surface (`Desktop` / `Web` / `iOS` / `Android`), and a minimal `.html` snippet that reproduces the problem.
- **Features**: open an issue describing the workflow problem first before spending time on a large PR so we can align on scope.

## Pull Request Checklist

1. Install dev dependencies without lifecycle scripts:
   ```bash
   npm install --ignore-scripts
   ```
2. Run the verification suite locally and ensure everything passes:
   ```bash
   npm run verify
   ```
3. Add or update unit tests in `tests/prototype.test.ts` for bug fixes and new parsing/instrumentation behavior.
4. If user-facing behavior, permissions, or limits change, update `OVERVIEW.md` and `OVERVIEW.zh-CN.md` (remember Paseo's registry validator forbids plugin-install or `npm install` commands inside `OVERVIEW*.md`).

## Maintainer Cadence

This project is maintained alongside active product engineering. You can typically expect an initial response on issues and pull requests within **7 days**; if you haven't heard back after a week, feel free to leave a friendly ping on the thread.
