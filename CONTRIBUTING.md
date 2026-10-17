# Contributing to everyhook

Thanks for helping. everyhook is a CLI for people who use more than one coding agent: it lets one hook run in Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor, installs it into each agent's configuration, and shows what each agent would do with it. It is part of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit) family of small, dependency-free tools. The bar for a change is the bar the code already meets: it is tested, it works on Windows, macOS and Linux, it changes a configuration file only after a backup and only by its own entries, and the claims it makes about an agent were put to the real binary.

## Start here

- **Good first issues:** [the issues labelled good first issue](https://github.com/nrzz/everyhook/issues?q=is%3Aopen+label%3A%22good+first+issue%22), and the ideas in [ROADMAP.md](ROADMAP.md).
- **Questions and ideas:** [Discussions](https://github.com/nrzz/everyhook/discussions).
- **Bugs:** [open an issue](https://github.com/nrzz/everyhook/issues/new/choose) with the version of the agent (`claude --version`, `codex --version`, `gemini --version`, `copilot --version`), the system, `node --version`, and the exact command and output. For a wrong claim about an agent, say what the agent did and attach the document it sent the hook (`EVERYHOOK_LOG` with `examples/log-tool-calls.mjs` records it) with anything private removed.

## Set up

There is nothing to install: the project has no dependencies.

```bash
git clone https://github.com/nrzz/everyhook
cd everyhook
npm test
```

- `node bin/everyhook.mjs --help` is the tool. `node bin/everyhook.mjs explain` is the table of how the agents differ.
- `E2E_CLAUDE=<claude> E2E_CODEX=<codex> E2E_GEMINI=<gemini> E2E_COPILOT=<copilot> node --test --test-concurrency=1 test/e2e-conformance.test.mjs test/e2e-adapter.test.mjs` also puts the tool's claims to the real agents (see below). Each variable is optional; an agent without one is skipped.
- Point `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME` and `GEMINI_CLI_HOME` at a temporary folder whenever you run the tool, the tests or an agent by hand; the tests do it for themselves. Never test against your real `~/.claude`, `~/.codex`, `~/.gemini`, `~/.copilot` or `~/.cursor`.

## Where things are

| Path | What it holds |
| --- | --- |
| `bin/everyhook.mjs` | the CLI entry |
| `src/cli.mjs` | the options, the help, the exit codes |
| `src/contract.mjs` | the agents, events and tool kinds; the document a hook reads; the check of its answer |
| `src/agents/*.mjs` | one adapter per agent: tool names and their kinds, the native event names, reading its JSON into the contract, what each answer becomes, the layout of its configuration |
| `src/translate.mjs`, `src/run.mjs` | turning an answer into an agent's JSON; the adapter that `run` and `bench` use |
| `src/hookproc.mjs` | running a hook; the only code that starts a program |
| `src/install.mjs`, `src/hooksdoc.mjs`, `src/jsonedit.mjs`, `src/write.mjs` | install, uninstall and restore; the hooks of a JSON file; editing JSON by its text; the only code that writes a file (backups, atomic writes) |
| `src/locations.mjs`, `src/cmdline.mjs`, `src/toml.mjs` | where each agent keeps hooks on each system; the command line install writes and reads back; the TOML reader for Codex's `config.toml` |
| `src/list.mjs`, `src/bench.mjs`, `src/fixtures.mjs`, `src/explain.mjs`, `src/conformance.mjs`, `src/report.mjs` | `list`, `bench`, the recorded documents, `explain` and the table behind it, the reports |
| `examples/` | three hooks: block-force-push, protect-env-files, log-tool-calls |
| `fixtures/<agent>/` | what each agent really sent a hook (Cursor's are written from its reference); `fixtures/conformance/` is what each binary did with the raw output of a hook |
| `test/*.test.mjs` | unit tests; `e2e-*.test.mjs` run the real agents |
| `test/agent-*.mjs`, `test/sandbox.mjs`, `test/session.mjs`, `test/adapter.mjs` | running a real agent against a fake API, one module per agent |
| `test/conformance.mjs`, `test/recording.mjs`, `test/record.mjs` | the cases put to each binary; recording fixtures and conformance answers (`RECORD_FIXTURES=1 node test/record.mjs fixtures` or `conformance`) |

## House rules

1. **No dependencies.** Node built-ins only, Node 18 or newer, ES modules (`.mjs`). A pull request that adds a package to `dependencies` will not be merged. Only `src/hookproc.mjs` may start a program, only `src/write.mjs` may write a file, and nothing may open a connection; a test fails otherwise.
2. **Every change comes with a test**, and `npm test` passes. CI runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18, and the real-agent checks on all three systems against the npm releases of the four agents. A change that only works on one system is not done. Paths with spaces and backslashes are handled and tested.
3. **The binary is right.** A statement about how an agent behaves is put to the real binary at zero tokens (a fake API on 127.0.0.1) before it goes in the README or in `explain` as `binary`. Where that was not possible it says `docs`, and the README's "Not verified" says so. Add the case to `test/conformance.mjs` (raw output) or `test/e2e-adapter.test.mjs` (through everyhook), run it, and record it with `test/record.mjs`. Do not change an expectation to make a test pass without running it against the binary.
4. **Token cost is a feature.** The tool runs outside every agent and costs nothing. A hook costs nothing unless it returns a `reason` or `context`; keep the reasons of the examples short.
5. **The settings files are the user's.** Whatever writes one backs it up first, changes only its own entries, leaves a file that is not valid JSON alone, offers `--dry-run`, and can put back the exact bytes.
6. **Never touch real user data in tests.** Use a temporary folder and point every home variable at it, in the same command, whenever you run anything that reads them. `test/helpers.mjs` does it for the test process the moment it loads.
7. **Plain language.** Short sentences in the README and in messages, no emoji, no superlatives. Exit codes: 0 ok, 1 findings or a refusal, 2 a usage error.
8. **Keep the README honest.** Its "What was verified, and how" section says what was run and what was not. If your change affects either, update it in the same pull request. A repository test holds the numbers in it to the test runner's.

## The real-agent checks

The `test/e2e-*.test.mjs` files start a fake API on 127.0.0.1 for each agent (Anthropic Messages for Claude Code, OpenAI Responses for Codex CLI, Gemini `generateContent` for Gemini CLI, OpenAI chat completions for Copilot CLI) and run the real binary against it with a throwaway home and config folders. The fake "model" does what a script says, one tool call per turn. No model is reached and nothing leaves your machine. The binary is started with `spawn` (asynchronously) and its standard input ignored; a synchronous start blocks the fake server, and a `-p` run waits for input on an open standard input.

## Pull requests

- One logical change per pull request, with its test. Commit messages in the imperative mood ("Turn ask into deny for Gemini CLI").
- Fill in the pull request template; CI must be green on every job.
- Plain, specific writing in docs, messages and comments.

## Releases (maintainers)

Bump the version in `src/version.mjs` and `package.json` (`npm test` fails until the two agree), add a section to [CHANGELOG.md](CHANGELOG.md), tag `vX.Y.Z` and publish a GitHub release with the changelog section as its notes.

## Conduct and security

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) describes, never in a public issue.
