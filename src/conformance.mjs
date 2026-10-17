// How the five agents differ, as data: one row per question, one cell per agent, each cell with its basis.
//   basis "binary"  a real run of the agent saw it (test/e2e-conformance.test.mjs and test/e2e-adapter.test.mjs put every such cell to the
//                   binary again; the recorded answers are in fixtures/conformance/<agent>.json, with the version, the system and the date)
//   basis "docs"    the agent's documentation says so and no run has seen it
// A cell with a `case` is held to the case of that name in test/conformance.mjs; its `outcome` is what the run must report there. Where a
// binary cell says "(docs)" in its text, that part of the sentence is from the reference and the rest was seen.
import { AGENTS } from "./contract.mjs";
import { MODULES } from "./agents/index.mjs";

const cell = (text, basis = "docs", extra = {}) => ({ text, basis, ...extra });

/** The rows, in the order explain prints them. Each cell has { text, basis, case?, outcome? }. */
export const ROWS = [
  {
    id: "config",
    title: "The files install writes (seen: the agent ran the hook from them)",
    cells: {
      "claude-code": cell("~/.claude/settings.json (or CLAUDE_CONFIG_DIR) and <project>/.claude/settings.json, key hooks. Events hold matcher groups that hold handlers.", "binary", { case: "install.user" }),
      codex: cell("hooks.json in CODEX_HOME (~/.codex) and in <project>/.codex/. A hook runs only after the person trusted its hash (/hooks), or for one run with --dangerously-bypass-hook-trust.", "binary", { case: "install.user" }),
      "gemini-cli": cell("~/.gemini/settings.json (GEMINI_CLI_HOME replaces ~) and <project>/.gemini/settings.json, key hooks: an object with event names only, each an array.", "binary", { case: "install.user" }),
      "copilot-cli": cell("JSON files in <COPILOT_HOME>/hooks/ (~/.copilot/hooks/) and <project>/.github/hooks/: { \"version\": 1, \"hooks\": { event: [handler] } }.", "binary", { case: "install.user" }),
      cursor: cell("~/.cursor/hooks.json and <project>/.cursor/hooks.json: { \"version\": 1, \"hooks\": { event: [{ command }] } }.", "docs"),
    },
  },
  {
    id: "configMore",
    title: "Other places the agent reads hooks from",
    cells: {
      "claude-code": cell(".claude/settings.local.json, and managed settings.", "docs"),
      codex: cell("[hooks] tables of config.toml, in the same folders.", "docs"),
      "gemini-cli": cell("the system settings. Project hooks are fingerprinted: it asks before it runs one it has not seen, and again when the entry changes.", "docs"),
      "copilot-cli": cell("policy files, the hooks key of .github/copilot/settings.json, and .claude/settings.json of the project.", "docs"),
      cursor: cell("enterprise paths.", "docs"),
    },
  },
  {
    id: "events",
    title: "Event names (pre-tool, post-tool, prompt, session-start, session-end, stop)",
    cells: Object.fromEntries(AGENTS.map((a) => [a, cell(["pre-tool", "post-tool", "prompt", "session-start", "session-end", "stop"].map((e) => MODULES[a].NATIVE[e]).join(", "), a === "cursor" ? "docs" : "binary", a === "cursor" ? {} : { case: "events" })])),
  },
  {
    id: "matcherShell",
    title: "A matcher that selects the shell tool (install --matcher)",
    cells: {
      "claude-code": cell("--matcher Bash", "binary", { case: "matcher-shell" }),
      codex: cell("--matcher Bash", "binary", { case: "matcher-shell" }),
      "gemini-cli": cell("--matcher run_shell_command", "binary", { case: "matcher-shell" }),
      "copilot-cli": cell("--matcher 'bash|powershell' (the shell tool is powershell on Windows and bash elsewhere).", "binary", { case: "matcher-shell" }),
      cursor: cell("--matcher Shell", "docs"),
    },
  },
  {
    id: "matcher",
    title: "Matcher syntax (tool events)",
    cells: {
      "claude-code": cell("exact names joined by | or a JavaScript regular expression, unanchored; * or empty matches all. Tool names: Bash, Edit, Write, mcp__server__tool.", "docs"),
      codex: cell("a regular expression on the tool name: Bash, apply_patch (also Edit and Write), mcp__server__tool; * or empty matches all.", "docs"),
      "gemini-cli": cell("a regular expression on the tool name: run_shell_command, write_file, replace, mcp_server_tool; * or empty matches all.", "docs"),
      "copilot-cli": cell("a regular expression anchored as ^(?:pattern)$ on the tool name: bash, powershell, edit, create, view. With the PascalCase event names Claude's matcher rules apply.", "docs"),
      cursor: cell("a regular expression on the tool type: Shell, Read, Write, Delete, Task, MCP:<tool>; * or empty matches all.", "docs"),
    },
  },
  {
    id: "deny",
    title: "How everyhook denies a tool call",
    cells: {
      "claude-code": cell("JSON on stdout, exit 0: hookSpecificOutput.permissionDecision deny with the reason. The model sees the reason.", "binary", { case: "deny-json", outcome: "blocked+reason" }),
      codex: cell("JSON on stdout, exit 0: hookSpecificOutput.permissionDecision deny with the reason. The model sees the reason.", "binary", { case: "deny-json", outcome: "blocked+reason" }),
      "gemini-cli": cell("JSON on stdout, exit 0: decision deny with the reason. The model sees the reason.", "binary", { case: "deny-json", outcome: "blocked+reason" }),
      "copilot-cli": cell("JSON on stdout, exit 0: permissionDecision deny with permissionDecisionReason. The model sees the reason.", "binary", { case: "deny-json", outcome: "blocked+reason" }),
      cursor: cell("JSON on stdout, exit 0: permission deny, user_message for the person and agent_message for the agent.", "docs"),
    },
  },
  {
    id: "exit2",
    title: "A hook that exits with code 2 (everyhook never relies on it)",
    cells: {
      "claude-code": cell("blocks; stderr is the reason the model sees.", "binary", { case: "exit2", outcome: "blocked+reason" }),
      codex: cell("on Windows the call runs: Codex starts the command through PowerShell -NoProfile -Command, which turns every non-zero exit code into 1. On Linux and macOS it blocks, with stderr as the reason; code 2 with nothing on stderr runs the call.", "binary", { case: "exit2", outcome: "ran" }),
      "gemini-cli": cell("blocks, and stderr is the reason, but only when stderr is not empty; code 2 with no stderr text runs the call.", "binary", { case: "exit2", outcome: "blocked+reason" }),
      "copilot-cli": cell("denies, but the model does not see stderr: it sees only that the hook errored.", "binary", { case: "exit2", outcome: "blocked" }),
      cursor: cell("blocks (equivalent to permission deny).", "docs"),
    },
  },
  {
    id: "exit1",
    title: "Another non-zero exit code (1, 3)",
    cells: {
      "claude-code": cell("the call runs; fail open.", "binary", { case: "exit1", outcome: "ran" }),
      codex: cell("the call runs; fail open.", "binary", { case: "exit1", outcome: "ran" }),
      "gemini-cli": cell("code 1 runs the call. Code 3 blocks, with stderr as the reason (when stderr has text).", "binary", { case: "exit3", outcome: "blocked+reason" }),
      "copilot-cli": cell("any non-zero exit denies a preToolUse call (hook errored); fail closed.", "binary", { case: "exit1", outcome: "blocked" }),
      cursor: cell("the call runs unless the entry has failClosed: true.", "docs"),
    },
  },
  {
    id: "ask",
    title: "ask (the person is asked to confirm)",
    cells: {
      "claude-code": cell("permissionDecision ask. In a headless run (-p) there is no one to ask and the call is denied with the reason; an interactive session asks the person (docs).", "binary", { case: "ask-json", outcome: "blocked+reason" }),
      codex: cell("not supported: the hook is marked failed and the call runs. everyhook turns ask into deny.", "binary", { case: "ask-json", outcome: "ran" }),
      "gemini-cli": cell("not supported: a hook that answers ask ends a headless run with no output. everyhook turns ask into deny.", "binary", { case: "ask-json", outcome: "ended" }),
      "copilot-cli": cell("permissionDecision ask. Where no one can answer (a headless run) the call is denied with the reason; an interactive session asks the person (docs).", "binary", { case: "ask-json", outcome: "blocked+reason" }),
      cursor: cell("not enforced on preToolUse (the schema takes it), enforced on beforeShellExecution and beforeMCPExecution. everyhook turns ask into deny on preToolUse.", "docs"),
    },
  },
  {
    id: "invalid",
    title: "Output that is not JSON (invalid JSON, plain text)",
    cells: {
      "claude-code": cell("the call runs; fail open.", "binary", { case: "invalid", outcome: "ran" }),
      codex: cell("the call runs; fail open.", "binary", { case: "invalid", outcome: "ran" }),
      "gemini-cli": cell("the call runs; fail open.", "binary", { case: "invalid", outcome: "ran" }),
      "copilot-cli": cell("the call runs; fail open.", "binary", { case: "invalid", outcome: "ran" }),
      cursor: cell("a permission hook that prints invalid JSON, or a response that does not match the schema, blocks.", "docs"),
    },
  },
  {
    id: "timeout",
    title: "A hook that runs past its timeout",
    cells: {
      "claude-code": cell("the hook is stopped and the call runs; fail open.", "binary", { case: "timeout", outcome: "ran" }),
      codex: cell("the hook is stopped and the call runs; fail open.", "binary", { case: "timeout", outcome: "ran" }),
      "gemini-cli": cell("the hook is stopped and the call runs; fail open.", "binary", { case: "timeout", outcome: "ran" }),
      "copilot-cli": cell("the hook is stopped and the call runs; fail open, even for preToolUse.", "binary", { case: "timeout", outcome: "ran" }),
      cursor: cell("the call runs unless the entry has failClosed: true.", "docs"),
    },
  },
  {
    id: "timeoutField",
    title: "Timeout field and its unit",
    cells: {
      "claude-code": cell("timeout, seconds.", "binary", { case: "timeout-unit" }),
      codex: cell("timeout, seconds.", "binary", { case: "timeout-unit" }),
      "gemini-cli": cell("timeout, milliseconds.", "binary", { case: "timeout-unit" }),
      "copilot-cli": cell("timeoutSec, seconds.", "binary", { case: "timeout-unit" }),
      cursor: cell("timeout, seconds.", "docs"),
    },
  },
  {
    id: "timeoutDefault",
    title: "Timeout when the entry has none",
    cells: {
      "claude-code": cell("600 seconds; 30 for UserPromptSubmit.", "docs"),
      codex: cell("600 seconds; 1 second for SessionEnd, which allows at most 3.", "docs"),
      "gemini-cli": cell("60000 milliseconds.", "docs"),
      "copilot-cli": cell("30 seconds.", "docs"),
      cursor: cell("a default of the platform.", "docs"),
    },
  },
  {
    id: "windows",
    title: "Which shell runs the command on Windows",
    cells: {
      "claude-code": cell("Git Bash: bash.exe -c \"<command>\". Without Git Bash, PowerShell (docs). One command field.", "binary", { case: "windows-shell" }),
      codex: cell("PowerShell: powershell.exe -NoProfile -Command \"<command>\", or pwsh.exe when PowerShell 7 is installed. Exit codes other than 0 become 1. commandWindows replaces the command on Windows (docs).", "binary", { case: "windows-shell" }),
      "gemini-cli": cell("PowerShell: powershell.exe -NoProfile -NonInteractive -Command \"<command>; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }\", which keeps exit codes (pwsh.exe -NoProfile -Command with the same relay where PowerShell 7 is installed).", "binary", { case: "windows-shell" }),
      "copilot-cli": cell("the powershell field on Windows (powershell.exe -nop -nol -c, or pwsh.exe when PowerShell 7 is installed) and bash elsewhere, or exec + args, which start the program with no shell (docs).", "binary", { case: "windows-shell" }),
      cursor: cell("one command field.", "docs"),
    },
  },
  {
    id: "environment",
    title: "The environment the hook gets",
    cells: {
      "claude-code": cell("the agent's own: a variable set on the agent reaches the hook.", "binary", { case: "env" }),
      codex: cell("the agent's own: a variable set on the agent reaches the hook.", "binary", { case: "env" }),
      "gemini-cli": cell("the agent's own, except when GITHUB_SHA is set or SURFACE is Github (a GitHub Actions run): then only a short list (PATH, HOME, TEMP, SHELL, GEMINI_* and the like), and EVERYHOOK_PROTECTED_BRANCHES, EVERYHOOK_LOG or any variable of your own does not reach the hook.", "binary", { case: "env-github" }),
      "copilot-cli": cell("the agent's own: a variable set on the agent reaches the hook.", "binary", { case: "env" }),
      cursor: cell("not documented.", "docs"),
    },
  },
  {
    id: "allow",
    title: "allow",
    cells: {
      "claude-code": cell("skips the permission prompt (deny and ask rules still apply, docs). Print nothing when you only want to look.", "binary", { case: "allow-json", outcome: "approved" }),
      codex: cell("no effect for a plain allow (it is for updatedInput); everyhook prints nothing.", "docs"),
      "gemini-cli": cell("no effect; everyhook prints nothing.", "docs"),
      "copilot-cli": cell("permissionDecision allow; the call runs.", "binary", { case: "allow-json", outcome: "ran" }),
      cursor: cell("permission allow; it loses to any deny or ask of another hook.", "docs"),
    },
  },
  {
    id: "context",
    title: "context (added to what the model sees)",
    cells: {
      "claude-code": cell("seen at pre-tool, post-tool and session-start; the reference adds prompt (hookSpecificOutput.additionalContext).", "binary", { case: "context", outcome: "context" }),
      codex: cell("seen at pre-tool, post-tool and session-start; the reference adds prompt (hookSpecificOutput.additionalContext).", "binary", { case: "context", outcome: "context" }),
      "gemini-cli": cell("seen at post-tool and session-start, and not at pre-tool; the reference adds prompt (hookSpecificOutput.additionalContext).", "binary", { case: "context", outcome: "none" }),
      "copilot-cli": cell("seen at post-tool and session-start, and not at pre-tool (additionalContext).", "binary", { case: "adapter-context" }),
      cursor: cell("post-tool and session-start (additional_context).", "docs"),
    },
  },
  {
    id: "message",
    title: "message (shown to the person)",
    cells: {
      "claude-code": cell("systemMessage.", "docs"),
      codex: cell("systemMessage.", "docs"),
      "gemini-cli": cell("systemMessage.", "docs"),
      "copilot-cli": cell("none: dropped.", "docs"),
      cursor: cell("user_message, with a deny.", "docs"),
    },
  },
];
