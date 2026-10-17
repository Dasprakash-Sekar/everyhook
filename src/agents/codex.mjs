// Codex CLI (https://learn.chatgpt.com/docs/hooks.md). Hooks live in hooks.json or in [hooks] tables of config.toml, in CODEX_HOME and in
// <project>/.codex/; Codex runs a hook only after the person trusted its hash (/hooks), or for one run with --dangerously-bypass-hook-trust.
// On Windows Codex runs a hook command through `powershell.exe -NoProfile -Command`, which turns every non-zero exit code into 1: only JSON
// on stdout can block there. Verified on 0.163.0 (see fixtures/codex/ and fixtures/conformance/codex.json).
import { isObject, kindOf, makeTool, patchFiles, str } from "./common.mjs";

export const id = "codex";
export const name = "Codex CLI";

/** The tool names this agent sends, and the kind each is. apply_patch is `write` when the patch only adds files, else `edit`. */
export const TOOLS = [
  ["Bash", "shell"],
  ["PowerShell", "shell"],
  ["apply_patch", "edit"],
  ["Edit", "edit"],
  ["Write", "write"],
  ["view_image", "read"],
];
export const TOOL_PATTERNS = [[/^mcp__/, "mcp", "mcp__<server>__<tool>"]];

export const NATIVE = {
  "pre-tool": "PreToolUse",
  "post-tool": "PostToolUse",
  prompt: "UserPromptSubmit",
  "session-start": "SessionStart",
  "session-end": "SessionEnd",
  stop: "Stop",
};
export const ALIASES = Object.fromEntries(Object.entries(NATIVE).map(([e, n]) => [n, e]));

/** The contract's parts of one native document. */
export function normalize(event, n) {
  const parts = { cwd: str(n.cwd), session: str(n.session_id), transcript: str(n.transcript_path) };
  if (event === "pre-tool" || event === "post-tool") {
    const input = isObject(n.tool_input) ? n.tool_input : {};
    let kind = kindOf(TOOLS, TOOL_PATTERNS, n.tool_name);
    let pick = (i) => [str(i.path), str(i.file_path)].filter(Boolean).slice(0, 1);
    if (n.tool_name === "apply_patch") {
      const patch = patchFiles(str(input.command) ?? str(input.input) ?? "");
      if (patch.onlyAdds) kind = "write";
      pick = () => patch.files;
    }
    parts.tool = makeTool({ name: n.tool_name, input, response: event === "post-tool" ? n.tool_response : undefined, kind, pick });
  }
  if (event === "prompt") parts.prompt = str(n.prompt);
  return parts;
}

const hso = (eventName, fields) => ({ hookSpecificOutput: { hookEventName: eventName, ...fields } });
const systemMessage = (a) => ({ systemMessage: a.message });
const block = (a) => ({ decision: "block", reason: a.reason });

/** What each event can take (see claude-code.mjs). Codex parses `ask` for PreToolUse and marks the hook failed, so there is no ask form. */
export const FORMS = {
  "pre-tool": {
    deny: (a) => hso("PreToolUse", { permissionDecision: "deny", permissionDecisionReason: a.reason }),
    context: (a) => hso("PreToolUse", { additionalContext: a.context }),
    message: systemMessage,
  },
  "post-tool": { deny: block, context: (a) => hso("PostToolUse", { additionalContext: a.context }), message: systemMessage, effects: { deny: "feedback" } },
  prompt: { deny: block, context: (a) => hso("UserPromptSubmit", { additionalContext: a.context }), message: systemMessage },
  "session-start": { context: (a) => hso("SessionStart", { additionalContext: a.context }), message: systemMessage },
  "session-end": {},
  stop: { deny: block, message: systemMessage, effects: { deny: "continue" } },
};

export const commandOf = (h) => (isObject(h) && h.type !== "mcp_tool" && typeof h.command === "string" ? h.command : null);

/** How hooks.json keeps hooks: the same grouping as Claude Code's settings.json, with `hooks` at the top. */
export const LAYOUT = {
  shape: "grouped",
  root: ["hooks"],
  empty: () => ({}),
  handler: ({ command, timeout }) => ({ type: "command", command, timeout }),
  timeoutUnit: "s",
};
