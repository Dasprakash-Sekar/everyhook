# Roadmap

What could come next. None of it is promised; all of it is open to contributors. Comment on an issue or start a [discussion](https://github.com/nrzz/everyhook/discussions) before a large change.

- Short agent names: `--agent claude`, `gemini` and `copilot` for `claude-code`, `gemini-cli` and `copilot-cli`, on every command that takes an agent, with the long names in every output. This is the open good first issue: [#1](https://github.com/nrzz/everyhook/issues/1).
- A portable matcher: `install --kind shell,edit` writing each agent's own matcher for those kinds of tool (`Bash`, `run_shell_command`, `bash|powershell`, `Shell`), so that one command guards the same tools everywhere. Today `--matcher` is in the agent's own syntax, and a matcher written for one agent matches nothing in another.
- More agents. OpenCode takes its hooks as a plugin (`tool.execute.before`) rather than a configuration entry, so the adapter would write a small plugin that calls `everyhook run`; Antigravity CLI keeps a `hooks.json` under `~/.gemini/config/`. Neither was run here; each needs its binary, a fake API for it and recorded documents before it goes in the table.
- Cursor from the binary. Everything about Cursor is documented, not recorded, because its CLI needs a login: record its documents, check that `ask` is enforced on `beforeShellExecution` and not on `preToolUse`, and find the keys of its Write tool at `preToolUse`, which the reference does not show.
- Failed tool calls. Claude Code reports a failed call as `PostToolUseFailure` (the recorded force push failed in the throwaway folder and produced one), and Copilot CLI has `postToolUseFailure`; a hook installed for `post-tool` sees neither. Map them to `post-tool` with the error as `tool.output`.
