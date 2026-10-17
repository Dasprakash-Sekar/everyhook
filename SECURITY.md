# Security policy

## Supported versions

Security fixes go into the latest release on `main`.

## Reporting a vulnerability

Please do not report a vulnerability in a public issue. Use GitHub's private reporting: [https://github.com/nrzz/everyhook/security/advisories/new](https://github.com/nrzz/everyhook/security/advisories/new), or the contact in the [nrzz security policy](https://github.com/nrzz/.github/blob/main/SECURITY.md). You can expect a first answer within 72 hours, and credit in the release notes if you want it.

## What this tool does, and does not do

It has no telemetry or account and sends nothing to anyone. It has no network code at all: a test fails if any file under `src/` or `bin/` imports a module that opens a connection.

**It reads.** The files in which the five agents keep hooks, on your machine: `settings.json` of Claude Code (`~/.claude`, or `CLAUDE_CONFIG_DIR`, the project's `.claude/settings.json` and `settings.local.json`, and the managed settings file); `hooks.json` and `config.toml` of Codex CLI (`~/.codex` or `CODEX_HOME`, and the project's `.codex/`); `settings.json` of Gemini CLI (`~/.gemini`, `GEMINI_CLI_HOME`, the project's `.gemini/`, and the system settings); the hooks files of GitHub Copilot CLI (`~/.copilot/hooks/`, the project's `.github/hooks/`, `.github/copilot/settings.json`, `~/.copilot/settings.json`, the project's `.claude/settings.json`, and the policy folder); and `hooks.json` of Cursor (`~/.cursor`, the project's `.cursor/`, and the enterprise file). `list` shows the hooks in them and the commands they run, so its output can contain whatever those commands contain: remove paths and tokens before you paste it into an issue. It reads the hook you name, to start it, and the recorded documents in `fixtures/`.

**It starts programs in one place: `src/hookproc.mjs`, and only the hook you name.** A hook runs with your rights, as it does when an agent starts it: `.mjs`, `.js` and `.cjs` files with the Node that runs everyhook, `.ps1` files with PowerShell, `.sh` files with bash, `.cmd` and `.bat` files with `cmd.exe` on Windows, anything else as it is. everyhook does not sandbox a hook, and it cannot make an untrusted hook safe: an installed hook is code that the agent runs at every event it is installed for. On Windows it also starts `taskkill` to stop a hook that ran past its time together with the programs it started. `bench` runs the hook you name once for each recorded document, with that document on its standard input; the documents are in the repository.

**It writes in three commands only: `install`, `uninstall` and `restore`,** and only the one configuration file per agent and scope that each command names (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.gemini/settings.json`, `~/.copilot/hooks/everyhook.json`, `~/.cursor/hooks.json`, or the same files of a project). Before it changes a file it copies it next to it as `<file>.bak-everyhook-<timestamp>`; it writes through a temporary file and a rename; it adds or removes only its own entries, found by their command line, by editing the text of the file so that nothing else in it moves; it leaves a file that is not valid JSON, or whose `hooks` key has the wrong shape, alone and says why; `--dry-run` writes nothing, not even a backup. A hooks file that everyhook made and that only held its entries is deleted when they are removed, after a backup. It never writes a managed or administrator's file, the settings of an agent beyond its `hooks` key, a hook, or anything outside the folders above. Tests run in throwaway folders.

**The entries it writes run `node` with the paths of everyhook and of your hook.** Those paths are absolute. A path with a double quote, `$`, a backtick or `%` in it is refused, because shells quote those differently. A project file with such entries is yours: do not commit it for a team.

A hook that fails is, by default, ignored with a message to you (fail open): that is how the agents themselves treat most hook failures. `--fail-closed` turns a failure of the hook (it cannot start, it runs too long, it prints something that is not an answer) into a deny before a tool runs and on a prompt. everyhook is a convenience for writing hooks once; it is not a security boundary. Codex CLI's reference says the same of hooks in general: a useful guardrail, not a complete enforcement boundary.

Wrong behaviour of an agent that the README states is a bug and not a vulnerability: report it as an issue.
