// Claude Code (https://code.claude.com/docs/en/hooks). Hooks live in the `hooks` key of settings.json (user, project, local): an event holds
// matcher groups, a group holds handlers. Verified on 2.1.302 (see fixtures/claude-code/ and fixtures/conformance/claude-code.json).
import { isObject, kindOf, makeTool, str } from "./common.mjs";

export const id = "claude-code";
export const name = "Claude Code";

/** The tool names this agent sends, and the kind each is. Names not here and not matching a pattern are `other`. */
export const TOOLS = [
  ["Bash", "shell"],
  ["PowerShell", "shell"],
  ["Edit", "edit"],
  ["MultiEdit", "edit"],
  ["NotebookEdit", "edit"],
  ["Write", "write"],
  ["Read", "read"],
  ["NotebookRead", "read"],
];
export const TOOL_PATTERNS = [[/^mcp__/, "mcp", "mcp__<server>__<tool>"]];

/** The native event each contract event is installed as. */
export const NATIVE = {
  "pre-tool": "PreToolUse",
  "post-tool": "PostToolUse",
  prompt: "UserPromptSubmit",
  "session-start": "SessionStart",
  "session-end": "SessionEnd",
  stop: "Stop",
};
/** Every native event name this agent accepts for a contract event (for list and for run). */
export const ALIASES = Object.fromEntries(Object.entries(NATIVE).map(([e, n]) => [n, e]));

const pathsOf = (input) => [str(input.file_path), str(input.notebook_path), str(input.path)].filter(Boolean).slice(0, 1);

/** The contract's parts of one native document. */
export function normalize(event, n) {
  const parts = { cwd: str(n.cwd), session: str(n.session_id), transcript: str(n.transcript_path) };
  if (event === "pre-tool" || event === "post-tool") {
    parts.tool = makeTool({ name: n.tool_name, input: n.tool_input, response: event === "post-tool" ? n.tool_response : undefined, kind: kindOf(TOOLS, TOOL_PATTERNS, n.tool_name), pick: pathsOf });
  }
  if (event === "prompt") parts.prompt = str(n.prompt);
  return parts;
}

const hso = (eventName, fields) => ({ hookSpecificOutput: { hookEventName: eventName, ...fields } });
const systemMessage = (a) => ({ systemMessage: a.message });
const block = (a) => ({ decision: "block", reason: a.reason });

/**
 * What each event can take, as functions from the answer to a piece of native JSON. A missing function means the agent has nothing for it
 * at that event. `effects` names what a deny does where it is not "blocked".
 */
export const FORMS = {
  "pre-tool": {
    deny: (a) => hso("PreToolUse", { permissionDecision: "deny", permissionDecisionReason: a.reason }),
    ask: (a) => hso("PreToolUse", { permissionDecision: "ask", permissionDecisionReason: a.reason }),
    allow: (a) => hso("PreToolUse", { permissionDecision: "allow", ...(a.reason ? { permissionDecisionReason: a.reason } : {}) }),
    context: (a) => hso("PreToolUse", { additionalContext: a.context }),
    message: systemMessage,
  },
  "post-tool": { deny: block, context: (a) => hso("PostToolUse", { additionalContext: a.context }), message: systemMessage, effects: { deny: "feedback" } },
  prompt: { deny: block, context: (a) => hso("UserPromptSubmit", { additionalContext: a.context }), message: systemMessage },
  "session-start": { context: (a) => hso("SessionStart", { additionalContext: a.context }), message: systemMessage },
  "session-end": {},
  stop: { deny: block, message: systemMessage, effects: { deny: "continue" } },
};

/** The command a handler runs, for the places that read a settings file. */
export const commandOf = (h) => (isObject(h) && typeof h.command === "string" ? h.command : null);

/** How the settings file keeps hooks: events hold matcher groups that hold handlers. */
export const LAYOUT = {
  shape: "grouped",
  root: ["hooks"],
  empty: () => ({}),
  handler: ({ command, timeout, failClosed }) => ({ type: "command", command, timeout, ...(failClosed ? { onFailure: "block" } : {}) }),
  timeoutUnit: "s",
};
