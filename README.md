# everyhook

[![test](https://github.com/nrzz/everyhook/actions/workflows/test.yml/badge.svg)](https://github.com/nrzz/everyhook/actions/workflows/test.yml) [![e2e](https://github.com/nrzz/everyhook/actions/workflows/e2e.yml/badge.svg)](https://github.com/nrzz/everyhook/actions/workflows/e2e.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![node >= 18](https://img.shields.io/badge/node-%3E%3D18-339933.svg) ![dependencies: none](https://img.shields.io/badge/dependencies-none-brightgreen.svg) [![part of the Claude Code toolkit](https://img.shields.io/badge/Claude%20Code-toolkit-d97757.svg)](https://github.com/nrzz/claude-code-toolkit)

Stack Overflow's 2026 survey says the typical developer uses more than one coding agent (Claude Code 66%, GitHub Copilot 59% among agent users). Every one of them now has a hook system, and no two agree. A hook that stops `git push --force` reads JSON on stdin in all five, and that is where the likeness ends. The event is `PreToolUse` in Claude Code and Codex CLI, `BeforeTool` in Gemini CLI and `preToolUse` in Copilot CLI and Cursor. The refusal is spelled four ways. `ask` works in two of them. A timeout is in seconds in four and in milliseconds in one. Exit code 2 blocks in Claude Code, Gemini CLI (when stderr has text), Copilot CLI (without the reason) and Cursor, and does not block in Codex CLI on Windows, where PowerShell turns it into 1. Exit code 1 lets the call run in four of them and denies it in Copilot CLI.

everyhook is one contract for the hook and one adapter per agent. Write the hook once, `install` it into every agent, and `bench` it against the JSON each real agent sent. **Write a hook once. Run it in every coding agent.**

| | Claude Code | Codex CLI | Gemini CLI | Copilot CLI | Cursor |
| --- | --- | --- | --- | --- | --- |
| Configuration | `settings.json` `hooks` | `hooks.json`, or `[hooks]` in `config.toml`; trusted by hash | `settings.json` `hooks` | `hooks/*.json`, `.github/hooks/*.json`, `.claude/settings.json` too | `hooks.json` |
| Before a tool runs | `PreToolUse` | `PreToolUse` | `BeforeTool` | `preToolUse` | `preToolUse` |
| The refusal | `hookSpecificOutput.permissionDecision` | the same | `decision` | `permissionDecision` | `permission` |
| `ask` | works | not supported | not supported | works | not enforced on `preToolUse` |
| Exit code 2 | blocks | runs the call on Windows | blocks, if stderr has text | denies, without the reason | blocks |
| Exit code 1 | the call runs | the call runs | the call runs | denies | the call runs, unless the entry has `failClosed` |
| Timeout | seconds | seconds | milliseconds | seconds | seconds |

What each cell rests on is in [What was verified, and how](#what-was-verified-and-how) and in `everyhook explain`, which marks every statement `binary` (a real run saw it) or `docs` (the agent's reference says so). Nothing of Cursor was run.

## What you get

- `run`: the adapter. An agent starts it for every event; it reads the agent's own JSON, builds one document for your hook, runs the hook, and prints the agent's own JSON back. This is the command that `install` writes into every agent's configuration.
- `install` and `uninstall`: put the hook into each agent's configuration with that agent's event names, matcher and timeout unit, after a backup of the file, adding only its own entries by editing the file's text; take exactly those entries out again, leaving the file byte for byte what it was.
- `restore`: put back the newest backup of the files `install` writes.
- `list`: every hook of every agent on this machine and in this project, from every file each agent reads, with the problems it would trip over: a program that is not there, a timeout in the wrong unit, a misspelt event, a Copilot file with the wrong `version`, a Gemini `hooks` entry that is not an array, a Codex layer with hooks in both formats, a Claude hook that Copilot also runs.
- `bench`: the hook put to the documents the real agents sent (64 of them, recorded from Claude Code, Codex CLI, Gemini CLI and Copilot CLI, and written from the reference for Cursor): what the hook answered, what the agent would do with the answer, and the exact JSON it would get.
- `explain`: how the five agents differ, with the basis of every statement.
- Three example hooks in [`examples/`](examples/): `block-force-push.mjs`, `protect-env-files.mjs`, `log-tool-calls.mjs`.
- `--json` on every command, for scripts. Zero dependencies: Node 18 or newer and `node:` modules only.

## What it costs in tokens

| Part | Tokens | |
| --- | --- | --- |
| The tool: every command | 0 | It runs outside every agent, reads files and starts the hooks you name. Nothing is sent anywhere. |
| An installed hook | 0 | A hook costs nothing unless it returns a `reason` or a `context`: only those reach the model. A `message` is shown to the person. |
| The reason of an example hook | at most 35 tokens | The longest reason of the three examples is 140 characters (the one `block-force-push` gives for a force push that names no branch); the usual one, for a push to `main`, is 106, and `protect-env-files` gives about 100 with the name of the file in it. At four characters a token that is about 35 tokens at most: an estimate, not a count by any model tokenizer. A context is added at every event it is returned for, so keep it short: Claude Code keeps one over 10,000 characters in a file and shows the model only a preview, and Codex CLI does the same above about 2,500 tokens (`docs`). |

## Install

**From a terminal**, with Node 18 or newer. There is nothing to install and no dependency. `list` and `explain` only read, and run from anywhere:

```bash
npx -y github:nrzz/everyhook explain
```

```bash
npx -y github:nrzz/everyhook list
```

`bench` needs a hook file to run, such as the ones in `examples/` of a clone.

**`install` needs a copy that stays.** The entries it writes name the path of `bin/everyhook.mjs` and of your hook. `npx` runs a copy in npm's cache, which npm may delete (`install` says so when it sees that), so clone the repository, or install it for good, and use that copy:

```bash
git clone https://github.com/nrzz/everyhook
node everyhook/bin/everyhook.mjs install everyhook/examples/block-force-push.mjs --all
```

```bash
npm install -g github:nrzz/everyhook
everyhook install examples/block-force-push.mjs --all
```

`--all` is every agent. `--agent claude-code,codex` is two. Then start a new session of the agent. Codex CLI also wants you to trust the hook once (`/hooks`), see [What still needs you](#what-still-needs-you).

## Use

The examples are real runs on Windows 11 in a throwaway home folder (the user name and the folders are shortened to `~`, `<project>` and `<everyhook>`, the folder of the clone), with a `~/.claude/settings.json` that already held a `model` and a permission rule. The recorded documents are the ones in [`fixtures/`](fixtures/).

```text
Usage: everyhook <command> [options]

Write a hook once. Run it in every coding agent: Claude Code (claude-code), Codex CLI (codex), Gemini CLI (gemini-cli),
GitHub Copilot CLI (copilot-cli) and Cursor (cursor). A hook is any executable that reads one JSON document on stdin
and may print one JSON document on stdout; everyhook turns each agent's own JSON into that document and the answer back.

Run (the agents call this; it is what install writes into their configuration):
  run        --agent <agent> --event <event> [--fail-closed] [--timeout <seconds>] -- <hook> [args...]
             reads the agent's JSON on stdin, runs the hook with the contract's document, prints the agent's JSON
             (or nothing) on stdout. A hook that exits non-zero is a deny with its stderr as the reason (at stop, only
             exit code 2 is). A hook that cannot start, runs past --timeout (default 25) or prints something that is not
             an answer is ignored with a message, or, with --fail-closed, denied before a tool and on a prompt.
             EVERYHOOK_DEBUG=1 logs to stderr. With --json it prints the whole result instead.

Change (they edit the agents' configuration files after a backup, and take --dry-run):
  install    <hook> (--agent <a,b,...> | --all) [--event <e,f,...|all>] [--scope user|project] [--project <dir>]
             [--matcher <regex>] [--timeout <seconds>] [--fail-closed]
             adds the hook to each agent's configuration, with the agent's own event names and timeout unit; only its
             own entries are added. Events default to pre-tool. --matcher is in the agent's own syntax (tool events).
  uninstall  <hook> [--agent <a,b,...>] [--event <e,f,...>] [--scope user|project] [--project <dir>]
             takes out exactly the entries install wrote for that hook; the file is byte for byte what it was before
             install when nothing else in it changed
  restore    (--agent <a,b,...> | --all) [--scope user|project] [--project <dir>]
             puts back the newest backup of each file install writes (the file as it is now is backed up first)

Read (they change nothing):
  list       [--agent <a,b,...>] [--project <dir>]
             every hook of every agent, from every file each one reads, with the problems it would trip over
  bench      <hook> [--agent <a,b,...>] [--event <e,f,...>] [--fixture <file>] [--fail-closed] [--timeout <seconds>]
             [--project <dir>]
             runs the hook through run with the recorded JSON of each agent and event (fixtures/) and prints what each
             agent would do with the answer, and the exact JSON it would get
  explain    [agent] [event]
             how the five agents differ (config files, events, deny, ask, errors, timeouts, Windows), with the basis of
             every statement: binary (a real run saw it) or docs

Options:
  --json            one JSON document on stdout (every command)
  --dry-run         show what would change and write nothing (install, uninstall, restore)
  -h, --help        this text
  -v, --version     the version

Agents: claude-code, codex, gemini-cli, copilot-cli, cursor
Events: pre-tool, post-tool, prompt, session-start, session-end, stop
Exit codes: 0 ok; 1 findings, a refusal or a failed hook; 2 a usage error.
Environment: EVERYHOOK_DEBUG (log to stderr), CLAUDE_CONFIG_DIR, CODEX_HOME, GEMINI_CLI_HOME and COPILOT_HOME (where those
agents keep their files), EVERYHOOK_SYSTEM_DIR (replaces the folders of administrators' files that list reads).
It reads the agents' configuration files, writes only the files install, uninstall and restore name (after a backup), starts
only the hooks you name, and sends nothing anywhere.
```

`--help` (or `-h`) prints this text and `--version` (or `-v`) the version.

### The contract

A hook is any executable. `.mjs`, `.js` and `.cjs` files run with the Node that runs everyhook, `.ps1` with PowerShell, `.sh` with bash (Git Bash on Windows), `.cmd` and `.bat` with `cmd.exe` on Windows, anything else as it is. It reads one JSON document on stdin:

```json
{
  "everyhook": 1,
  "agent": "claude-code",
  "event": "pre-tool",
  "tool": { "name": "Bash", "kind": "shell", "command": "git push --force origin main", "input": { "command": "git push --force origin main" } },
  "cwd": "/home/me/shop", "session": "da9fe47e-3cbc-4787-9702-53d612119a79", "transcript": "/home/me/.claude/projects/.../da9fe47e.jsonl",
  "native": { "...": "what the agent sent, whole" }
}
```

and may print one JSON document on stdout:

```json
{ "decision": "deny", "reason": "Force-pushing the protected branch \"main\" is blocked.", "message": "Blocked by the force-push hook.", "context": "..." }
```

- `agent` is one of `claude-code`, `codex`, `gemini-cli`, `copilot-cli`, `cursor`. `event` is one of `pre-tool`, `post-tool`, `prompt`, `session-start`, `session-end`, `stop`.
- `tool` is there at `pre-tool` and `post-tool`. `name` is the agent's own tool name; `kind` is `shell`, `edit`, `write`, `read`, `mcp` or `other`; `command` is there for `shell`; `path` is there for `edit`, `write` and `read` (and `paths`, when a call touches several files: a Codex CLI patch can); `input` is the agent's tool input; `output` is there at `post-tool`. `prompt` is there at `prompt`. `native` is the agent's JSON as it arrived.
- Paths are the agent's own: Claude Code sends backslashes on Windows, and a check written with `/` never matches them. The folders of recorded documents are `<project>` and `<home>` in [`fixtures/`](fixtures/).
- `decision` is `allow`, `deny` or `ask`. `reason` goes to the model where the agent supports it, `message` goes to the person where it does, `context` is added context where the event allows it. No output, or exit 0 with nothing printed, is no opinion.
- **`allow` is an approval, not "no objection".** On Claude Code it skips the permission prompt (seen: in the default permission mode, in a headless run, `mkdir` was refused for want of approval, and the hook's `allow` let it through). Print nothing when you only look; `log-tool-calls` does.
- A hook that exits with a non-zero code is a deny, with its stderr as the reason (at `stop`, where a deny sends the agent back to work, only exit code 2 is: a hook that crashed must not do that). A hook that cannot start, runs past its time or prints something that is not one JSON object of that shape is ignored with a `message` to the person, and with `--fail-closed` it is a deny before a tool and on a prompt. The exit code of your hook never reaches the agent: `run` always answers in the agent's JSON, which is the one form that delivers the reason on all four recorded binaries, and the only one that works on Codex CLI for Windows.
- The hook runs in the folder the agent works in, with the environment the agent has plus `EVERYHOOK=1`, `EVERYHOOK_AGENT` and `EVERYHOOK_EVENT`. One exception was seen: when `GITHUB_SHA` is set (a GitHub Actions run), Gemini CLI starts hooks with a short list of variables (`PATH`, `HOME`, `TEMP`, `SHELL`, `GEMINI_*` and the like), so a variable such as `EVERYHOOK_PROTECTED_BRANCHES` or `EVERYHOOK_LOG` set on the agent does not reach the hook there; keep such settings in the hook itself when Gemini CLI runs in CI.

Where each event is, and what each agent calls it (the names `install` writes):

| Event | Claude Code | Codex CLI | Gemini CLI | Copilot CLI | Cursor |
| --- | --- | --- | --- | --- | --- |
| `pre-tool` | `PreToolUse` | `PreToolUse` | `BeforeTool` | `preToolUse` | `preToolUse` |
| `post-tool` | `PostToolUse` | `PostToolUse` | `AfterTool` | `postToolUse` | `postToolUse` |
| `prompt` | `UserPromptSubmit` | `UserPromptSubmit` | `BeforeAgent` | `userPromptSubmitted` | `beforeSubmitPrompt` |
| `session-start` | `SessionStart` | `SessionStart` | `SessionStart` | `sessionStart` | `sessionStart` |
| `session-end` | `SessionEnd` | `SessionEnd` | `SessionEnd` | `sessionEnd` | `sessionEnd` |
| `stop` | `Stop` | `Stop` | `AfterAgent` | `agentStop` | `stop` |

`run` also reads Copilot CLI's PascalCase payloads (the Claude-compatible spelling) and Cursor's `beforeShellExecution`, `beforeMCPExecution`, `beforeReadFile`, `afterShellExecution`, `afterMCPExecution` and `afterFileEdit` when you wire them by hand. The tool names and the kind each is (one table per agent, in `src/agents/<agent>.mjs`; any other name is `other`):

| Agent | `shell` | `edit` | `write` | `read` | `mcp` |
| --- | --- | --- | --- | --- | --- |
| Claude Code | `Bash`, `PowerShell` | `Edit`, `MultiEdit`, `NotebookEdit` | `Write` | `Read`, `NotebookRead` | `mcp__<server>__<tool>` |
| Codex CLI | `Bash`, `PowerShell` | `apply_patch`, `Edit` | `Write`; `apply_patch` when it only adds files | `view_image` | `mcp__<server>__<tool>` |
| Gemini CLI | `run_shell_command` | `replace` | `write_file` | `read_file`, `read_many_files` | `mcp_<server>_<tool>` |
| Copilot CLI | `bash`, `powershell`, `Bash` | `edit`, `str_replace_editor`, `apply_patch`, `Edit` | `create`, `Write` | `view`, `Read` | `mcp__<server>__<tool>` |
| Cursor | `Shell` | `Delete` | `Write` | `Read` | `MCP:<tool>` |

A hook of a dozen lines (it is also run by the tests, to see that this is what it does):

```js
// no-rm-rf.mjs: refuse "rm -rf /" and "rm -rf ~" in any agent
import fs from "node:fs";

const doc = JSON.parse(fs.readFileSync(0, "utf8"));
if (doc.tool && doc.tool.kind === "shell" && /\brm\s+-rf\s+(\/|~)(\s|$)/.test(doc.tool.command)) {
  process.stdout.write(JSON.stringify({ decision: "deny", reason: "rm -rf on / or ~ is blocked. Name the folder you mean." }));
}
```

### `run`

The agents call this; you call it to try a hook by hand. It reads the agent's JSON on stdin and prints the agent's JSON, or nothing:

```text
$ echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin main"},...}' | everyhook run --agent claude-code --event pre-tool -- examples/block-force-push.mjs
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force-pushing the protected branch \"main\" is blocked. Push without --force, or ask the person to allow it."}}
```

`--timeout <seconds>` is how long the hook may run (25 by default; `install` writes the agent's timeout minus 2). `--fail-closed` turns a failure of the hook into a deny before a tool and on a prompt. `EVERYHOOK_DEBUG=1` writes what happened to stderr (the document the hook got, what it answered, what was printed), and stdout stays the agent's. `--json` prints the whole result for a person. A command line that `run` cannot parse is exit 2 (a usage error).

### `install`

```text
$ everyhook install examples/block-force-push.mjs --all
everyhook install block-force-push.mjs (user scope)

claude-code  updated  ~\.claude\settings.json
  pre-tool       PreToolUse            deny blocks, ask asks, allow approves, context, message
  backup: ~\.claude\settings.json.bak-everyhook-20261017-173000
codex        created  ~\.codex\hooks.json
  pre-tool       PreToolUse            deny blocks, ask becomes deny, context, message
gemini-cli   created  ~\.gemini\settings.json
  pre-tool       BeforeTool            deny blocks, ask becomes deny, message
copilot-cli  created  ~\.copilot\hooks\everyhook.json
  pre-tool       preToolUse            deny blocks, ask asks, allow approves
cursor       created  ~\.cursor\hooks.json
  pre-tool       preToolUse            deny blocks, ask becomes deny, allow approves, message

Still to do:
  claude-code: Claude Code reads its settings when a session starts: start a new session.
  codex: Codex runs a hook only after you trust it: open /hooks in Codex and trust the everyhook entries (for one run, codex exec --dangerously-bypass-hook-trust).
  cursor: Cursor watches hooks.json and reloads it; if the hook does not fire, restart Cursor.
```

`install <hook> (--agent <a,b,...> | --all)` writes one file per agent and scope: `--scope user` (the default) the file in the home folder, `--scope project` the file of the folder you are in (`--project <dir>` names another). `--event pre-tool,stop` chooses the events (`all` is all six; the default is `pre-tool`), `--matcher <regex>` limits a tool event to some tools in the agent's own syntax (`Bash` for Claude Code and Codex CLI, `run_shell_command` for Gemini CLI, `bash|powershell` for Copilot CLI, `Shell` for Cursor), `--timeout <seconds>` is the agent's timeout (30 by default; in milliseconds for Gemini CLI, which `install` writes in its unit), and `--fail-closed` is written into the line and, where the agent has a switch for it, into the entry (`onFailure: "block"` for Claude Code 2.1.295 and newer, `failClosed` for Cursor); [What was verified, and how](#what-was-verified-and-how) shows what each agent does when everyhook itself is gone. Codex CLI allows a `SessionEnd` hook three seconds; `install` writes 3 and says so. What it writes for Claude Code (the other agents differ in event names, the timeout unit and the layout, which `everyhook explain <agent>` and the files themselves show):

```json
{
  "model": "opus",
  "permissions": { "allow": ["Bash(ls:*)"] },
  "hooks": {
    "PreToolUse": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"<everyhook>/bin/everyhook.mjs\" run --agent claude-code --event pre-tool --timeout 28 -- \"<everyhook>/examples/block-force-push.mjs\"",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

The line is `node "<everyhook>/bin/everyhook.mjs" run --agent <agent> --event <event> --timeout <seconds> -- "<hook>"`, with absolute paths, forward slashes on Windows (Git Bash, PowerShell and `cmd.exe` take them all) and double quotes. A path with a double quote, `$`, a backtick or `%` in it is refused, because shells quote those differently. Copilot CLI gets `exec: "node"` and `args`, which start the program with no shell at all.

`install` backs a file up as `<file>.bak-everyhook-<timestamp>` before it changes it, writes through a temporary file and a rename, adds the entries in the layout of the file (its indentation, its line endings, a missing final newline), and leaves every other byte alone. It replaces its own entries for the same hook, agent and event, so a second `install` changes nothing, and a changed option takes effect. A file that is not valid JSON, or whose `hooks` key has the wrong shape, is left alone and the reason is printed (exit 1); the other agents are still done. `--dry-run` writes nothing, not even a backup:

On a home folder where nothing is installed yet:

```text
$ everyhook install examples/block-force-push.mjs --agent claude-code,gemini-cli --dry-run
everyhook install block-force-push.mjs (user scope), dry run: nothing is written

claude-code  would update  ~\.claude\settings.json
  pre-tool       PreToolUse            deny blocks, ask asks, allow approves, context, message
gemini-cli   would create  ~\.gemini\settings.json
  pre-tool       BeforeTool            deny blocks, ask becomes deny, message

Still to do:
  claude-code: Claude Code reads its settings when a session starts: start a new session.
```

#### What still needs you

- **Codex CLI** runs a hook only after you trust its definition (`/hooks` in Codex), or for one run with `--dangerously-bypass-hook-trust`. A hook that is not trusted is skipped, and `codex exec` says nothing about it (seen: the force push ran, and no event of the run mentioned hooks).
- **Gemini CLI** fingerprints project hooks: it asks before it runs one it has not seen, and again when the entry changes (`docs`). A user-level hook needs nothing (seen).
- **Copilot CLI** loads project hooks only in a trusted folder (`docs`). It runs the hooks of an event in order and stops at the first deny (seen: a logging hook installed after `block-force-push` never saw the blocked call; installed before it, it did).
- **Cursor** watches its `hooks.json` and reloads it (documented).
- Every agent reads its settings when a session starts: start a new one.

### `uninstall`

```text
$ everyhook uninstall examples/block-force-push.mjs
everyhook uninstall block-force-push.mjs (user scope)

claude-code  removed 1 entry  ~\.claude\settings.json
  the file is back to its bytes from before install
  backup: ~\.claude\settings.json.bak-everyhook-20261017-173000-1
codex        deleted the file (it held only this entry)  ~\.codex\hooks.json
  backup: ~\.codex\hooks.json.bak-everyhook-20261017-173000
gemini-cli   deleted the file (it held only this entry)  ~\.gemini\settings.json
  backup: ~\.gemini\settings.json.bak-everyhook-20261017-173000
copilot-cli  deleted the file (it held only this entry)  ~\.copilot\hooks\everyhook.json
  backup: ~\.copilot\hooks\everyhook.json.bak-everyhook-20261017-173000
cursor       deleted the file (it held only this entry)  ~\.cursor\hooks.json
  backup: ~\.cursor\hooks.json.bak-everyhook-20261017-173000
```

`uninstall <hook>` finds the entries by their command line, so it takes out exactly what `install` wrote for that hook (`--event` narrows it, `--agent`, `--scope` and `--project` as for `install`) and nothing else, also when other hooks, yours or everyhook's, sit in the same event. It then looks for a backup that holds the very settings the file now holds, and writes that backup's bytes: the file is byte for byte what it was before `install` (tested over ten layouts: no file, `{}`, tabs and CRLF, one line, a byte-order mark, escapes, hooks of its own, and more). If the file changed in some other way since, those changes stay and only the entries go. A hooks file that `install` made and that held nothing else is deleted, after a backup.

### `restore`

`restore (--agent <a,b,...> | --all)` puts the newest `.bak-everyhook-*` backup of each file `install` writes back, and backs up the file as it is first, so that a `restore` can be undone by another. After `everyhook install examples/block-force-push.mjs --agent claude-code`:

```text
$ everyhook restore --agent claude-code --dry-run
everyhook restore (user scope), dry run: nothing is written

claude-code  would put back settings.json.bak-everyhook-20261017-173000  ~\.claude\settings.json
```

and without `--dry-run`:

```text
$ everyhook restore --agent claude-code
everyhook restore (user scope)

claude-code  put back settings.json.bak-everyhook-20261017-173000  ~\.claude\settings.json
  the file as it was is saved as settings.json.bak-everyhook-20261017-173000-1
```

Use `uninstall` to take a hook out; use `restore` when a file is wrong for a reason `uninstall` does not know.

### `list`

```text
$ everyhook list --agent claude-code,codex
claude-code
  user  ~\.claude\settings.json
    PreToolUse            timeout 30 s  [everyhook]
      node "<everyhook>/bin/everyhook.mjs" run --agent claude-code --event pre-tool --timeout 28 -- "<everyhook>/examples/block-force-push.mjs"

codex
  user  ~\.codex\hooks.json
    PreToolUse            timeout 30 s  [everyhook]
      node "<everyhook>/bin/everyhook.mjs" run --agent codex --event pre-tool --timeout 28 -- "<everyhook>/examples/block-force-push.mjs"

2 hooks in 2 files, 2 by everyhook; 0 problems
```

`list` reads every file each agent reads, for this machine and for the project (`--project <dir>`, the folder you are in by default): the user, project and local files, the managed and administrators' files, Copilot CLI's whole `hooks` folder and its inline `hooks` keys, and Codex CLI's `config.toml`. Each entry shows its event, matcher, timeout (with its unit), command and type, and whether everyhook wrote it. Exit 1 when there is a problem. The problems:

| Problem | Where |
| --- | --- |
| a program that is not there (a command's program or the script an interpreter is given; only simple commands are checked) | every entry |
| an event name the agent does not document (names are case sensitive and an unknown one is ignored); the right spelling when it is a case slip | every entry |
| a timeout in the wrong unit: 30 for Gemini CLI is 30 milliseconds; 30000 for the others is more than an hour | every entry |
| a matcher that is not a regular expression | every entry |
| a hook of a type Gemini CLI does not run (it runs `command` only) | Gemini CLI |
| a `hooks` entry that is not an array: Gemini CLI prints "Invalid configuration" ("Expected array") for the file at every start | Gemini CLI |
| a hooks file whose `version` is there and is not 1: Copilot CLI ignores the file, without a word (a file with no `version` ran) | Copilot CLI |
| an entry with no command | every entry |
| hooks in `hooks.json` and in `config.toml` of one layer: Codex merges them and warns at every start | Codex CLI |
| a hook in the project's `.claude/settings.json` or `settings.local.json`: Copilot CLI reads those files too and will run it | Claude Code |
| a file that is not JSON (or not TOML this reader knows) | every file |
| everyhook or the hook of an entry everyhook wrote that is not there any more | entries by everyhook |

### `bench`

```text
$ everyhook bench examples/block-force-push.mjs --agent claude-code,codex --event pre-tool
everyhook bench block-force-push.mjs

claude-code 2.1.302  recorded 2026-10-17, win32 x64, Windows 11 Home Single Language 10.0.26300
  pre-tool     edit                   no opinion     nothing changes
      (nothing printed)
  pre-tool     read                   no opinion     nothing changes
      (nothing printed)
  pre-tool     shell-force-push       deny           the action is blocked
      {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force-pushing the protected branch \"main\" is blocked. Push without --force, or ask the person to allow it."}}
  pre-tool     shell-harmless         no opinion     nothing changes
      (nothing printed)
  pre-tool     write-env              no opinion     nothing changes
      (nothing printed)

codex 0.163.0  recorded 2026-10-17, win32 x64, Windows 11 Home Single Language 10.0.26300
  pre-tool     edit                   no opinion     nothing changes
      (nothing printed)
  pre-tool     shell-force-push       deny           the action is blocked
      {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Force-pushing the protected branch \"main\" is blocked. Push without --force, or ask the person to allow it."}}
  pre-tool     shell-harmless         no opinion     nothing changes
      (nothing printed)
  pre-tool     write-env              no opinion     nothing changes
      (nothing printed)
```

`bench <hook>` runs the hook, through the same code `run` uses, with each recorded document of each agent and event in [`fixtures/`](fixtures/): `--agent` and `--event` choose them, `--fixture <file>` puts the hook to a file of your own in the same format, and `--fail-closed` shows what the failures would be. For each it prints what the hook answered (`deny`, `ask`, `allow`, `no opinion`, `exit 3 (deny)`, `timeout`, `invalid output`...), what the agent would do with the answer (`the action is blocked`, `the person is asked`, `the action is approved`, `the agent is sent back to work with the reason`, `nothing changes`; with `ask became deny` and the like in brackets; `fail open` or `fail closed` for a failure), and the exact JSON. Every fixture records the agent, its version, the system and the date; Cursor's say `documented, not recorded`:

```text
$ everyhook bench examples/block-force-push.mjs --agent cursor --event pre-tool
everyhook bench block-force-push.mjs

cursor  documented, not recorded
  pre-tool     mcp                                   no opinion     nothing changes
      {"permission":"allow"}
  pre-tool     read-env                              no opinion     nothing changes
      {"permission":"allow"}
  pre-tool     shell-force-push-beforeShellExecution deny           the action is blocked
      {"permission":"deny","agent_message":"Force-pushing the protected branch \"main\" is blocked. Push without --force, or ask the person to allow it."}
  pre-tool     shell-force-push                      deny           the action is blocked
      {"permission":"deny","agent_message":"Force-pushing the protected branch \"main\" is blocked. Push without --force, or ask the person to allow it."}
  pre-tool     shell-harmless                        no opinion     nothing changes
      {"permission":"allow"}
```

Exit 1 when a hook fails for some document (it cannot start, runs too long, prints something that is not an answer). Cursor prints `{"permission":"allow"}` for "no opinion", because its reference says a permission hook whose answer is not valid JSON blocks, and an allow loses to a deny or an ask of any other hook.

### `explain`

```text
$ everyhook explain codex pre-tool
Codex CLI, pre-tool (PreToolUse): before a tool runs; a hook can block it

What everyhook prints for each answer of the hook:
  deny          {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"},"systemMessage":"<message>"}
                the action is blocked
  ask           {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"}}
                the action is blocked; ask became deny: Codex CLI cannot ask at pre-tool
  allow         (nothing)
                nothing changes; allow has no effect: Codex CLI has no approval to give at pre-tool
  context       {"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"<context>"}}
                context is added
  message       {"systemMessage":"<message>"}
                a message is shown to the person
  (no opinion)  (nothing)
                nothing changes

It can take: deny, context, message.
```

`explain` alone is the table of how the five agents differ, a block per question and a line per agent with its basis (`[binary]` or `[docs]`). `explain <agent>` is one agent's column, its tool names and kinds, and the files it reads hooks from on Windows, macOS and Linux. `explain <agent> <event>` is the table above: what is printed for each kind of answer, and what the agent does with it. `--json` gives all of it as data.

### The examples

- **`block-force-push.mjs`** denies `git push --force`, `-f` (also inside a cluster such as `-fu`), a `+refspec`, and `--all` or `--mirror` with a force, to the protected branches `main` and `master` (`EVERYHOOK_PROTECTED_BRANCHES`, a comma-separated list with `*`, replaces them). It reads compound commands (`&&`, `;`, `|`, quotes, `git -C dir push`), looks up the current branch with git when a force push names none, and denies it when it cannot tell. `--force-with-lease` is not blocked.
- **`protect-env-files.mjs`** denies edits and writes (kinds `edit` and `write`, so Codex CLI's `apply_patch` too, with every file of a patch) to `.env` and `.env.*`, except `.env.example`, `.env.sample` and `.env.template`; `EVERYHOOK_PROTECT` adds files, folders (everything under them) and patterns (`*` inside a name, `**` for any number of folders), separated like `PATH`. A shell redirect into `.env` is out of its reach. Gemini CLI 0.64.0 refuses to read or write a file whose name starts with `.env` with its own file tools, before any hook (it answers `Path not in workspace`), so its recorded write is `app.env`; its shell tool still reaches those files, and a hook on it is how you cover that.
- **`log-tool-calls.mjs`** appends the document of every event as one JSON line to the file `EVERYHOOK_LOG` names, and prints nothing: no opinion, so the agent's permission rules stay in charge. Texts over 8,000 characters are cut (`EVERYHOOK_LOG_FULL=1` keeps them). The recorded fixtures were made with it.

### The JSON documents

Every command prints one document with `--json`. The keys, in the order they are printed (a `?` marks a key that is not always there; `<agent>`, `<event>` and `<system>` stand for the names):

```text
run        { ok, agent, event, nativeEvent, document, hook { status, exit, ms, stdout, stderr, error }, answer { decision?, reason?, message?, context? }, failure { kind, detail }, native { stdout, exit }, effect, notes }
install    { ok, dryRun, hook, scope, results [ { agent, scope, file, action, backup, refused, entries [ { event, native, matcher, timeout, can } ], notes } ], needs }
uninstall  { ok, dryRun, hook, scope, removed, results [ { agent, scope, file, action, removed, backup, restoredFrom, refused, notes } ] }
restore    { ok, dryRun, scope, results [ { agent, scope, file, from, others, restored, reason, wouldRestore?, savedCurrent? } ] }
list       { ok, project, counts { files, entries, ours, problems }, files [ { agent, scope, file, format, status, problems } ], entries [ { agent, scope, file, event, contractEvent, matcher, type, command, timeout { value, unit, seconds }, ours, hook, alsoRunBy, problems } ] }
bench      { ok, hook, failClosed, results [ { agent, version, source, os, date, event, variant, summary, answer, effect, outcome, notes, native { stdout, exit }, hook { status, exit, ms, stderr } } ] }
explain    { ok, agents, rows [ { id, title, cells { <agent> { text, basis, case?, outcome? } } } ], agent?, name?, native? { <event> }, tools? { names [ { name, kind } ], patterns [ { pattern, kind } ] }, paths? { <system> [ { scope, path, format, install, crossTool } ] }, events? { <event> { native, info, answers [ { answer, native, effect, notes } ] } } }
error      { ok, error }
```

`ok` is false when the command found something to report (a problem in `list`, a refusal, a hook that failed in `bench`) and the exit code is 1; a usage error is the `error` document and exit code 2. A refusal (a file that is not JSON, a `hooks` key of the wrong shape) is the command's own document with `ok: false` and the reason in `refused` for that file. In `run`, `failure.kind` is `input` (the agent's JSON could not be read), `start` (the hook could not be started), `timeout`, `invalid` (the hook printed something that is not an answer) or `exit` (a non-zero exit at `stop`); `effect` is what the agent does with the printed answer: `blocked`, `asked`, `allowed`, `feedback`, `continue`, `context`, `message` or `none`.

## How it works

It reads, on your machine only, the files below, and starts the hooks you name. What it says about an agent is what [What was verified, and how](#what-was-verified-and-how) names; where an `explain` cell says `docs`, it comes from the agent's reference and the binary was not put to it.

- **The adapter.** An agent starts `node everyhook.mjs run --agent <agent> --event <event> -- <hook>` and writes its own JSON on stdin. everyhook reads it into the contract's document (`src/agents/<agent>.mjs`: tool names and kinds, the fields, the payload spellings), runs the hook with the document on stdin, reads what it printed, and turns the answer into what that agent understands at that event (`src/translate.mjs`, with the table of what each event can take in the agent's module). What the answer cannot be (an `ask` for Codex CLI, a `deny` at an event that cannot refuse, a `context` where the agent takes none) is turned into the nearest thing it can, or dropped, and `bench` and `explain` say which. The table of all 180 cases (5 agents, 6 events, 6 answers) is [`test/translate-table.mjs`](test/translate-table.mjs).
- **Why the answer is JSON on stdout with exit 0, and not exit code 2.** Of the four binaries, exit code 2 did not block on Codex CLI on Windows (it starts a hook through PowerShell with `-NoProfile -Command`, which turns every non-zero code into 1), Copilot CLI denied without the reason, and Gemini CLI blocked only when stderr had text; Claude Code did what its reference says everywhere, and Codex CLI did on Linux and macOS (with a reason on stderr). The agent's own deny JSON delivered the reason on all four. everyhook uses it; a hook can still use `exit 2`, and everyhook turns it into the JSON.
- **The shell that runs the command on Windows** (recorded from the hook's parent process): Claude Code, with Git Bash installed, `bash.exe -c "<command>"`; Codex CLI `powershell.exe -NoProfile -Command "<command>"` (`pwsh.exe` where PowerShell 7 is installed, as on GitHub's Windows runner); Gemini CLI `powershell.exe -NoProfile -NonInteractive -Command "<command>; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }"`, which keeps exit codes; Copilot CLI `powershell.exe -nop -nol -c "<command>"` for the `powershell` field (`pwsh.exe` on the runner; `exec` + `args` need no shell). The line `install` writes works in Git Bash, PowerShell and `cmd.exe`.
- **The files.** `install` writes one file per agent and scope; `list` reads these and more (the managed ones, Copilot CLI's whole `hooks` folder, Codex CLI's `config.toml`). `<project>` is the folder you work in:

| Agent | User file (install writes it) | Project file (install writes it) |
| --- | --- | --- |
| Claude Code | `~/.claude/settings.json` (`CLAUDE_CONFIG_DIR`) | `<project>/.claude/settings.json` |
| Codex CLI | `~/.codex/hooks.json` (`CODEX_HOME`) | `<project>/.codex/hooks.json` |
| Gemini CLI | `~/.gemini/settings.json` (`GEMINI_CLI_HOME` replaces `~`) | `<project>/.gemini/settings.json` |
| Copilot CLI | `~/.copilot/hooks/everyhook.json` (`COPILOT_HOME`) | `<project>/.github/hooks/everyhook.json` |
| Cursor | `~/.cursor/hooks.json` | `<project>/.cursor/hooks.json` |

On Windows `~` is `%USERPROFILE%`. `everyhook explain <agent>` prints every path on each system.

- **What it starts.** The hooks you name (and, on Windows, `taskkill` to stop a hook that ran past its time with the programs it started). Only `src/hookproc.mjs` starts a program.
- **What it writes.** The files above, after a backup, by editing their text; and nothing else. Only `src/write.mjs` writes a file.

### Privacy

It reads the agents' configuration files listed above, on your machine, and the hooks and recorded documents you point it at. It writes only with `install`, `uninstall` and `restore` (the one file per agent and scope, after a backup next to it), and starts only the hooks you name. It has no network code, no telemetry and no account: nothing is sent to anyone. Tests hold that to the code: nothing under `src/` or `bin/` imports anything but a `node:` module or opens a connection, only `src/hookproc.mjs` starts a program, and only `src/write.mjs` writes a file. The hooks you install do what they do; `log-tool-calls` writes the file you name. `list` shows the commands your hooks run, with your paths in them: remove those before you paste a report into an issue. The recorded fixtures are made in throwaway folders, hold `<project>`, `<home>` and `<tmp>` in place of their paths, and a test fails if one holds the name of whoever recorded it. See also [SECURITY.md](SECURITY.md).

## What was verified, and how

What this README says an agent does is what the agent's real binary did, unless the sentence says `docs`. The binaries were Claude Code 2.1.302, Codex CLI 0.163.0, Gemini CLI 0.64.0 and GitHub Copilot CLI 1.0.98, on Windows 11 (10.0.26300) with Node 24.19.0 on 17 October 2026; and on every push, on GitHub's Windows, macOS and Linux runners, with the newest version npm has of each (`e2e.yml`).

**No token is spent and no login is needed.** Each agent runs against a small fake of its model API on 127.0.0.1 that answers from a script, one tool call per turn: the Messages API for Claude Code, the Responses API for Codex CLI, `generateContent` for Gemini CLI and the chat completions API for Copilot CLI. The agent runs in a throwaway home folder, with the variables that point it at its configuration (`HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `COPILOT_HOME`, `GEMINI_CLI_HOME`) set to it, so nothing of yours is read or written. What happened is read back from the agent's own tool results (did the model see the reason, or the output of the command), from the requests the agent made, and from a log that a hook writes.

| Agent | Version | Raw outputs put to it | Documents recorded from it | Also put to it |
| --- | --- | --- | --- | --- |
| Claude Code | 2.1.302 | 13 | 13 | `allow` in the default permission mode |
| Codex CLI | 0.163.0 | 13 | 12 | a hook that is not trusted |
| Gemini CLI | 0.64.0 | 14 | 14 | a short environment under `GITHUB_SHA`, a `hooks` entry that is not an array |
| Copilot CLI | 1.0.98 | 12 | 14 | a hook file with `"version": 2` |
| Cursor | not run | none | 11 written from the reference | nothing |

Each of the four was also put through everyhook: `install` and `uninstall`, every answer at a tool event, `--fail-closed`, a refused prompt, session start and stop, `--scope project`, and a missing everyhook. The sections below give the results.

### What the four binaries do with a hook's raw output

A recording hook stands where everyhook would, with no everyhook in the loop, and prints what the case says: 13 cases for Claude Code and Codex CLI, 14 for Gemini CLI and 12 for Copilot CLI, 52 in all. `ran` means the tool ran; `blocked` means it did not and the model was not told why; `blocked+reason` means it did not and the model saw the hook's reason; `ended` means the run ended without answering; `context` and `none` say whether added context reached the model. This is what `explain` marks `binary`, and the reason everyhook answers in the agent's own JSON with exit code 0.

| The hook printed | Claude Code 2.1.302 | Codex CLI 0.163.0 | Gemini CLI 0.64.0 | Copilot CLI 1.0.98 |
| --- | --- | --- | --- | --- |
| nothing, exit 0 | ran | ran | ran | ran |
| exit 2, reason on stderr | blocked+reason | ran on Windows, blocked+reason on Linux and macOS | blocked+reason | blocked |
| exit 2, nothing on stderr | blocked | ran | ran | blocked |
| exit 1, reason on stderr | ran | ran | ran | blocked |
| exit 3, reason on stderr | ran | ran | blocked+reason | blocked |
| `{not json` | ran | ran | ran | ran |
| plain text, not JSON | ran | ran | ran | ran |
| nothing for 30 seconds, timeout 10 | ran | ran | ran | ran |
| the agent's own deny JSON | blocked+reason | blocked+reason | blocked+reason | blocked+reason |
| a deny JSON with no reason | n/a | n/a | blocked | blocked |
| the older `decision: block` JSON | blocked+reason | blocked+reason | blocked+reason | n/a |
| the agent's own allow JSON | ran | ran | ran | ran |
| the agent's own ask JSON | blocked+reason | ran | ended | blocked+reason |
| added context at pre-tool | context | context | none | n/a |

The cells are the recordings in [`fixtures/conformance/`](fixtures/conformance/), made on Windows; Linux and macOS are what GitHub's runners show on every push, and Codex CLI's exit code 2 with a reason is the one cell that differs there. A hook past its timeout was stopped at the timeout in all four, and the call ran. Claude Code's `allow` approves a call that its permission rules would have stopped (seen in the default permission mode, in a headless run: `mkdir` with no hook was refused for want of approval, and ran when the hook printed `allow`). The shell that starts a hook command on Windows, read from the hook's parent process: Claude Code `bash.exe -c` (Git Bash), Codex CLI `powershell.exe -NoProfile -Command` (`pwsh.exe` where PowerShell 7 is installed, as on GitHub's runner), Gemini CLI `powershell.exe -NoProfile -NonInteractive -Command` with a relay of the exit code (`pwsh.exe -NoProfile -Command` on the runner), Copilot CLI `powershell.exe -nop -nol -c` (and `pwsh.exe` on the runner).

### What the four binaries do through everyhook

For each binary: `install` put `examples/block-force-push.mjs` and `examples/log-tool-calls.mjs` into the throwaway home, the script made the agent call its shell tool with `git push --force origin main` and then with a harmless command, and the checks read the agent's own results and the documents the logging hook wrote. The force push never ran and the model was given the reason; the harmless command ran; the hook was given a document with the command, the same for the four agents; the output of the harmless command was in the `post-tool` document; and after `uninstall` every file was byte for byte what it was before. Then every answer a hook can give at a tool event, put through `run` (the same for all four agents):

| The hook's answer at pre-tool | What every agent did |
| --- | --- |
| `deny` with a reason | blocked+reason |
| `ask` | blocked+reason |
| `allow` | ran |
| `context` | ran |
| exit code 2 | blocked+reason |
| exit code 1 | blocked+reason |
| output that is not JSON | ran |
| a hook that runs too long | ran |
| no output | ran |

`ask` is a deny where the agent cannot ask (Codex CLI, Gemini CLI), and in a headless run, where there is no one to ask, on Claude Code and Copilot CLI too. With `--fail-closed`, a hook that printed text that is not JSON and a hook that ran too long were both blocked, with a reason that names the cause; without it, both ran. What reached the model:

| | Claude Code | Codex CLI | Gemini CLI | Copilot CLI |
| --- | --- | --- | --- | --- |
| context returned at pre-tool | yes | yes | no | no |
| the reason of a deny at post-tool | yes | yes | yes | no |
| context returned at post-tool | yes | yes | yes | yes |
| a prompt that a hook refused | never sent | never sent | never sent | sent anyway |

`install --scope project` wrote the file of the project (`.claude/settings.json`, `.codex/hooks.json`, `.gemini/settings.json`, `.github/hooks/everyhook.json`), wrote nothing to the home folder, and each agent ran the hook from it, before and after the call (Codex CLI with `--dangerously-bypass-hook-trust`, Gemini CLI in a folder it was told to trust).

`--matcher`, in each agent's own syntax (`Bash`, `Bash`, `run_shell_command`, `bash|powershell`), limited the hook to the shell tool: the file write that followed ran, and the hook never saw it. `protect-env-files` blocked a write and an edit of a protected path through each agent's own write and edit tools, with the reason in front of the model, and left another file alone that it wrote and another that it edited (on Gemini CLI the protected files were the ones listed in `EVERYHOOK_PROTECT`, because Gemini CLI refuses to write a `.env*` file by itself, before any hook).

When everyhook itself cannot start (its files were moved or deleted, and the entries still name them), the four agents differ, and `--fail-closed` changes the result only on Claude Code, which has a field for it:

| everyhook cannot start | Claude Code | Codex CLI | Gemini CLI | Copilot CLI |
| --- | --- | --- | --- | --- |
| the entry as `install` writes it | the call runs | the call runs | the call runs | the call is denied |
| installed with `--fail-closed` | the call is denied | the call runs | the call runs | the call is denied |

At `session-start` the context a hook returned was in the first request to the model, in all four. A `stop` hook that denied once sent the agent back to work with the reason as the next prompt, and the second `stop` document carried the agent's flag that it had been sent back already. Codex CLI does not run a hook that is not trusted, and `codex exec` says nothing about it: the force push ran, and no event of the run mentioned hooks. Copilot CLI runs the hooks of an event in order and stops at the first deny, so a logging hook installed after `block-force-push` never saw the blocked call. When `GITHUB_SHA` is set, Gemini CLI starts a hook with a short environment (see [The contract](#the-contract)).

Two problems that `list` reports were put to the binaries that have them. Gemini CLI printed `Invalid configuration` and `Expected array` for a `hooks` entry that was an object, and went on with the run. Copilot CLI ignored a hook file with `"version": 2` without a word, and ran files with `"version": 1` and with no `version`.

### The recorded documents

[`fixtures/`](fixtures/) holds 53 documents that the four binaries sent a hook (a force push, a harmless command, an edit, a write to an environment file and a read, before and after the tool; a prompt; the start and the end of a session; a stop), each with the agent, its version, the system and the date, and 11 for Cursor that are written from its reference and say `"source": "documented"` (`bench` prints `documented, not recorded` for them). A test fails if one holds the name of whoever recorded it. `RECORD_FIXTURES=1 E2E_CLAUDE=... node test/record.mjs fixtures` records them again.

### The tests and CI

**301 automated tests** (`npm test`; that is what `node --test` reports, less each of the 15 helper files that it lists as a test and that does nothing without its variable). 49 of them put the code to the real binaries and are skipped unless `E2E_CLAUDE`, `E2E_CODEX`, `E2E_GEMINI` and `E2E_COPILOT` name them; the others need nothing but Node, and a few skip themselves where a system lacks something (the right to make symlinks, on Windows). They cover every module, the editing of JSON by text with a fuzz round trip of 400 cases, ten layouts that `uninstall` must give back to the byte, and the 180 cases of the translation table (5 agents, 6 events, 6 answers).

`test.yml` runs the suite on Windows, macOS and Linux with Node 20, 22 and 24, and on Linux with Node 18. `e2e.yml` installs the four agents from npm on each of the three systems and runs the real-binary checks; it runs on every push and every week, so that a new version of an agent that changes any cell above fails there first. An agent that cannot be installed skips its checks with the reason and does not fail the run.

## Not verified

- **Cursor, all of it.** No Cursor binary was run: its CLI needs a login, which this work did not use. Every Cursor statement is `docs`, its 11 fixtures are written from the reference, and `bench` and `explain` say so. The reference does not show the keys of Cursor's Write tool at `preToolUse`, so there is no fixture for it.
- **Anything that needs a person.** Codex CLI's trust screen (`/hooks`), Gemini CLI's question about a changed project hook and Copilot CLI's question about a folder it does not trust were not driven. The checks ran `codex exec` untrusted (the hook does not run) and with `--dangerously-bypass-hook-trust`. An `ask` that a person answers was not seen either: every run was headless, where Claude Code and Copilot CLI deny it with the reason.
- **Hooks from places `install` does not write.** Copilot CLI policy and plugin hooks, and the managed and enterprise files of every agent. `list` reads the managed files and the tests put it to made-up ones; no agent was run with any of them.
- **Hook types other than `command`.** Claude Code documents `http`, `mcp_tool`, `prompt` and `agent` hooks too. everyhook installs and lists `command` hooks.
- **Events outside the six** (`PermissionRequest`, `Notification`, `SubagentStop`, `PreCompact` and the rest), and the failure events (see [ROADMAP.md](ROADMAP.md)).
- **Cursor's `failClosed`.** `--fail-closed` writes it into a Cursor entry, as the reference describes, and no Cursor binary saw it. The flag was seen working on the four binaries: `run` denies when the hook fails, and Claude Code's `onFailure: "block"` stops the call when everyhook cannot start (the table above).
- **Versions.** Only the four named. `e2e.yml` installs the newest of each on every push and every week, so a change shows up there first, as a failing check, and not here.
- **Linux and macOS fixtures.** The recorded documents and answers are from Windows. Linux and macOS are checked on GitHub's runners against the same expectations (one differs, and is in the table), but nothing was recorded there, and the paths in a document (`C:\Users\...` on Windows) differ.
- **Hooks run by a real agent as `.ps1`, `.sh`, `.cmd` or `.bat`.** The unit tests run each through `run`, where the system has the program; a real agent was only given `.mjs` hooks.
- **Everything else a real agent was not given.** Paths with characters outside ASCII, two sessions of one agent at once, and a hook that prints more than 10 MiB (everyhook stops it with an error; the unit tests cover that).

## Files

| File | What it is |
| --- | --- |
| `bin/everyhook.mjs` | the entry point; all the work is in `src/cli.mjs` |
| `src/cli.mjs` | the options, the help text, the exit codes, and the seven commands |
| `src/contract.mjs` | the agents, the events and the kinds of tool; the document a hook reads and the check of the answer it prints |
| `src/run.mjs` | the adapter: the agent's JSON in, the document to the hook, the answer back as the agent's JSON |
| `src/translate.mjs` | an answer in the contract's words, turned into what one agent understands at one event |
| `src/hookproc.mjs` | starts a hook (the only code that starts a program) and stops it, with what it started, at its timeout |
| `src/agents/index.mjs` | the five agents by id |
| `src/agents/common.mjs` | what the agent modules share: reading a tool call, the parts of an answer |
| `src/agents/claude-code.mjs` | Claude Code: tool names and kinds, the payload, what each event takes, the layout of its file |
| `src/agents/codex.mjs` | Codex CLI: the same, with `apply_patch` read file by file |
| `src/agents/gemini-cli.mjs` | Gemini CLI: the same, with timeouts in milliseconds |
| `src/agents/copilot-cli.mjs` | GitHub Copilot CLI: the same, with both payload spellings and `exec` + `args` |
| `src/agents/cursor.mjs` | Cursor: the same, from its reference only |
| `src/install.mjs` | `install`, `uninstall` and `restore`: what to write, and how to take exactly that out again |
| `src/hooksdoc.mjs` | reads, adds and removes hook entries in an agent's JSON, in the layout of that agent |
| `src/jsonedit.mjs` | changes a JSON file by editing its text, so that nothing else in it moves |
| `src/write.mjs` | the only code that writes: a backup, a temporary file and a rename |
| `src/cmdline.mjs` | the command line `install` writes, and the reading of it back |
| `src/locations.mjs` | where each agent keeps its hooks, on each system |
| `src/list.mjs` | `list`: every hook of every agent, with the problems |
| `src/toml.mjs` | a reader for the TOML of Codex CLI's `config.toml` |
| `src/bench.mjs` | `bench`: a hook put to the recorded documents |
| `src/fixtures.mjs` | reads and filters the recorded documents |
| `src/explain.mjs` | `explain`: the text and the JSON |
| `src/conformance.mjs` | the rows of the `explain` table, each cell with its basis |
| `src/report.mjs` | the words and the JSON of every command's report |
| `src/version.mjs` | the version and the repository address |
| `examples/block-force-push.mjs` | denies a force push to a protected branch |
| `examples/protect-env-files.mjs` | denies edits and writes to `.env` files and to paths you list |
| `examples/log-tool-calls.mjs` | appends one JSON line per event to a file, and prints nothing |
| `fixtures/<agent>/<event>.<variant>.json` | what each agent sent a hook, with its version, the system and the date |
| `fixtures/conformance/<agent>.json` | what each binary did with each raw output, with the same details |
| `test/*.test.mjs` | the 22 files of tests, one per module, and the checks of this README |
| `test/e2e-adapter.test.mjs` | everyhook put to the four real binaries |
| `test/e2e-conformance.test.mjs` | the raw outputs put to the four real binaries |
| `test/helpers.mjs` | throwaway worlds, so that no test reads or writes your configuration |
| `test/sandbox.mjs` | what the four agent sandboxes share: a fake API server, a scrubbed environment, a launcher |
| `test/agent-claude.mjs` | Claude Code against a fake Messages API |
| `test/agent-codex.mjs` | Codex CLI against a fake Responses API |
| `test/agent-gemini.mjs` | Gemini CLI against a fake `generateContent` API |
| `test/agent-copilot.mjs` | Copilot CLI against a fake chat completions API |
| `test/session.mjs` | one session of any of the four agents in a world |
| `test/adapter.mjs` | the sessions of the adapter checks, and the expected results of the tables above |
| `test/conformance.mjs` | the raw-output cases and what each binary is expected to do with them |
| `test/record-hook.mjs` | the hook that logs what an agent sent and prints what a case says |
| `test/answer-hook.mjs` | the everyhook hook that gives the answer its input asks for |
| `test/recording.mjs` | records the documents each agent sends a hook |
| `test/record.mjs` | records the fixtures and the conformance answers (`RECORD_FIXTURES=1`) |
| `test/cursor-docs.mjs` | Cursor's documents, written from its reference |
| `test/translate-table.mjs` | the 180 rows of the translation table |
| `.github/workflows/test.yml` | the suite on Windows, macOS and Linux |
| `.github/workflows/e2e.yml` | the real-binary checks on Windows, macOS and Linux |
| `ROADMAP.md` | what could come next, and the open good first issue |
| `CHANGELOG.md` | what changed in each release |
| `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md`, `CODE_OF_CONDUCT.md` | how to take part, report a vulnerability, ask for help, and behave |

## Contributing

Bug reports, ideas and pull requests are welcome; start with [CONTRIBUTING.md](CONTRIBUTING.md) and the [good first issue](https://github.com/nrzz/everyhook/issues/1). The rules: no dependencies, every change with a test, every statement about an agent put to the real binary (or marked `docs`), the settings files are the user's, and nothing wastes anyone's tokens. `npm test` needs nothing but Node. To run the real-binary checks too, set `E2E_CLAUDE`, `E2E_CODEX`, `E2E_GEMINI` and `E2E_COPILOT` to the commands or the full paths of the binaries; they run against a fake API and spend no token.

## Also by the same author

everyhook is by the author of the [Claude Code toolkit](https://github.com/nrzz/claude-code-toolkit), nineteen tools for Claude Code; the two closest to this one are [claude-hook-bench](https://github.com/nrzz/claude-hook-bench), which runs every Claude Code hook with the JSON Claude Code sends and shows what each one does, and [claude-code-guardrails](https://github.com/nrzz/claude-code-guardrails), safety presets that stop risky commands and edits.

## License

[MIT](LICENSE)
