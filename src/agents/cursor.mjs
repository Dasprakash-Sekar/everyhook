// Cursor (https://cursor.com/docs/agent/hooks). Hooks live in ~/.cursor/hooks.json and <project>/.cursor/hooks.json:
// { "version": 1, "hooks": { "<event>": [ { "command": ..., "timeout": seconds, "matcher": regex, "failClosed": bool } ] } }.
// Cursor is NOT installed on the machine where this was written and its CLI needs a login: everything here is documented, not recorded.
// The fixtures under fixtures/cursor/ are written from the reference and say so ("source": "documented").
import { isObject, kindOf, makeTool, str } from "./common.mjs";

export const id = "cursor";
export const name = "Cursor";

/** The tool names this agent sends, and the kind each is. preToolUse and postToolUse name the tool; the specific events below say it by their own name. */
export const TOOLS = [
  ["Shell", "shell"],
  ["Read", "read"],
  ["Write", "write"],
  ["Delete", "edit"],
];
export const TOOL_PATTERNS = [[/^MCP:/, "mcp", "MCP:<tool>"]];

export const NATIVE = {
  "pre-tool": "preToolUse",
  "post-tool": "postToolUse",
  prompt: "beforeSubmitPrompt",
  "session-start": "sessionStart",
  "session-end": "sessionEnd",
  stop: "stop",
};
/** Every native event name this agent accepts for a contract event: the generic tool events and the specific ones. */
export const ALIASES = {
  preToolUse: "pre-tool", beforeShellExecution: "pre-tool", beforeMCPExecution: "pre-tool", beforeReadFile: "pre-tool",
  postToolUse: "post-tool", afterShellExecution: "post-tool", afterMCPExecution: "post-tool", afterFileEdit: "post-tool",
  beforeSubmitPrompt: "prompt", sessionStart: "session-start", sessionEnd: "session-end", stop: "stop",
};

/** Events whose answer Cursor treats as a permission: invalid JSON blocks, and `ask` is honoured (preToolUse takes the field and ignores it). */
export const PERMISSION_EVENTS = ["preToolUse", "beforeShellExecution", "beforeMCPExecution", "beforeReadFile"];

const pathsOf = (i) => [str(i.file_path), str(i.path), str(i.target_file)].filter(Boolean).slice(0, 1);

/** The contract's parts of one native document: the generic tool events and the specific ones (shell, MCP, read, file edit). */
export function normalize(event, n) {
  const native = str(n.hook_event_name);
  const parts = { cwd: str(n.cwd) ?? (Array.isArray(n.workspace_roots) ? str(n.workspace_roots[0]) : undefined), session: str(n.conversation_id) ?? str(n.session_id), transcript: str(n.transcript_path) ?? undefined };
  if (event === "pre-tool" || event === "post-tool") {
    if (native === "beforeShellExecution" || native === "afterShellExecution") {
      parts.tool = makeTool({ name: native, input: { command: n.command, cwd: n.cwd }, response: n.output, kind: "shell" });
    } else if (native === "beforeMCPExecution" || native === "afterMCPExecution") {
      parts.tool = makeTool({ name: n.tool_name, input: n.tool_input, response: n.result_json, kind: "mcp" });
    } else if (native === "beforeReadFile") {
      parts.tool = makeTool({ name: native, input: { file_path: n.file_path }, kind: "read", pick: pathsOf });
    } else if (native === "afterFileEdit") {
      parts.tool = makeTool({ name: native, input: { file_path: n.file_path, edits: n.edits }, kind: "edit", pick: pathsOf });
    } else {
      parts.tool = makeTool({ name: n.tool_name, input: n.tool_input, response: event === "post-tool" ? n.tool_output : undefined, kind: kindOf(TOOLS, TOOL_PATTERNS, n.tool_name), pick: pathsOf });
    }
  }
  if (event === "prompt") parts.prompt = str(n.prompt);
  return parts;
}

const allow = () => ({ permission: "allow" });
const permission = {
  messageWith: "deny",
  deny: (a) => ({ permission: "deny", ...(a.message ? { user_message: a.message } : {}), agent_message: a.reason }),
  allow,
  neutral: allow,
};

/**
 * What each event can take (see claude-code.mjs). preToolUse takes `ask` in its schema and does not enforce it, so there is no ask form
 * for it; the specific events beforeShellExecution and beforeMCPExecution do enforce it (FORMS_ASK). A permission event that prints
 * nothing could be read as invalid JSON and block, so "no opinion" prints an allow, which loses to any deny or ask of another hook.
 */
export const FORMS = {
  "pre-tool": permission,
  "post-tool": { context: (a) => ({ additional_context: a.context }) },
  prompt: {
    messageWith: "deny",
    deny: (a) => ({ continue: false, user_message: a.message || a.reason }),
    allow: () => ({ continue: true }),
    neutral: () => ({ continue: true }),
  },
  "session-start": { context: (a) => ({ additional_context: a.context }) },
  "session-end": {},
  stop: { deny: (a) => ({ followup_message: a.reason }), effects: { deny: "continue" } },
};
export const FORMS_ASK = { ...permission, ask: (a) => ({ permission: "ask", ...(a.message ? { user_message: a.message } : {}), agent_message: a.reason }) };

/** The forms for one native event: beforeShellExecution and beforeMCPExecution honour `ask`. */
export function formsFor(event, nativeEvent) {
  if (event === "pre-tool" && (nativeEvent === "beforeShellExecution" || nativeEvent === "beforeMCPExecution")) return FORMS_ASK;
  return FORMS[event];
}

export const commandOf = (h) => (isObject(h) && typeof h.command === "string" ? h.command : null);

/** How hooks.json keeps hooks: a version, and events that hold handlers directly. */
export const LAYOUT = {
  shape: "flat",
  root: ["hooks"],
  empty: () => ({ version: 1 }),
  handler: ({ command, timeout, failClosed }) => ({ command, timeout, ...(failClosed ? { failClosed: true } : {}) }),
  timeoutUnit: "s",
};
