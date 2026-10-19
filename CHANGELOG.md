# Changelog

All notable changes to everyhook are written here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Short agent names: commands accept `claude` (for `claude-code`), `gemini` (for `gemini-cli`), and `copilot` (for `copilot-cli`) in `--agent`, `explain`, `run`, `bench`, `install`, and `list`. Output and configuration files continue to use canonical long ids ([#1](https://github.com/nrzz/everyhook/issues/1)).

## [1.0.0] - 2026-10-17

- First release. A CLI that lets one hook run in Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor. Node 18 or newer, no dependencies.
- The contract: a hook is any executable (`.mjs`, `.js`, `.cjs`, `.ps1`, `.sh`, `.cmd`, `.bat`, or anything else as it is). It reads one JSON document on stdin (`agent`, `event`, `tool` with its `kind`, `prompt`, `cwd`, `session`, `transcript`, `native`) and may print `{ decision, reason, message, context }`.
- `run` is the adapter the agents call. It reads the agent's JSON, runs the hook and answers in the agent's own JSON with exit code 0: the form that delivered the reason on all four recorded binaries, and the only one that blocks on Codex CLI for Windows. A hook that cannot start, runs too long or prints something that is not an answer is ignored with a message, or denied with `--fail-closed`.
- `install` puts the hook into each agent's configuration with that agent's event names, matcher syntax and timeout unit, by editing the file's text after a backup. `uninstall` takes exactly those entries out and gives the file back byte for byte. `restore` puts a backup back. All three take `--dry-run`.
- `list` shows every hook of every agent, from every file each agent reads, with the problems it would trip over.
- `bench` puts a hook to the documents the agents sent (53 recorded from Claude Code 2.1.302, Codex CLI 0.163.0, Gemini CLI 0.64.0 and Copilot CLI 1.0.98, and 11 written from Cursor's reference) and prints what each agent would do with the answer, with the exact JSON.
- `explain` is the table of how the five agents differ, every cell marked `binary` or `docs`, with the files each agent reads on Windows, macOS and Linux.
- Three example hooks: `block-force-push`, `protect-env-files` and `log-tool-calls`.
- What the agents do is what the real binaries did: 52 raw hook outputs, the adapter at every event, project scope, and the case where everyhook itself is gone. They ran on Windows 11 and, on every push, on GitHub's Windows, macOS and Linux runners (`e2e.yml`). Cursor was not run.
- Zero tokens for the tool. A hook costs nothing unless it returns a `reason` or a `context`; the longest reason of the examples is 140 characters.

[1.0.0]: https://github.com/nrzz/everyhook/releases/tag/v1.0.0

[Unreleased]: https://github.com/nrzz/everyhook/compare/v1.0.0...HEAD
