// Gemini CLI (https://geminicli.com/docs/hooks/reference.md). Hooks live in the `hooks` key of settings.json (user, project, system): an
// object keyed by event name only, each event an array of matcher groups. Timeouts are milliseconds. Verified on 0.64.0 (see
// fixtures/gemini-cli/ and fixtures/conformance/gemini-cli.json).
import { isObject, kindOf, makeTool, str } from "./common.mjs";

export const id = "gemini-cli";
export const name = "Gemini CLI";

/** The tool names this agent sends, and the kind each is. */
export const TOOLS = [
  ["run_shell_command", "shell"],
  ["write_file", "write"],
  ["replace", "edit"],
  ["read_file", "read"],
  ["read_many_files", "read"],
];
export const TOOL_PATTERNS = [[/^mcp_/, "mcp", "mcp_<server>_<tool>"]];

export const NATIVE = {
  "pre-tool": "BeforeTool",
  "post-tool": "AfterTool",
  prompt: "BeforeAgent",
  "session-start": "SessionStart",
  "session-end": "SessionEnd",
  stop: "AfterAgent",
};
export const ALIASES = Object.fromEntries(Object.entries(NATIVE).map(([e, n]) => [n, e]));

const pathsOf = (i) => [str(i.file_path), str(i.absolute_path), str(i.path)].filter(Boolean).slice(0, 1);

/** The contract's parts of one native document. */
export function normalize(event, n) {
  const parts = { cwd: str(n.cwd), session: str(n.session_id), transcript: str(n.transcript_path) };
  if (event === "pre-tool" || event === "post-tool") {
    parts.tool = makeTool({ name: n.tool_name, input: n.tool_input, response: event === "post-tool" ? n.tool_response : undefined, kind: kindOf(TOOLS, TOOL_PATTERNS, n.tool_name), pick: pathsOf });
  }
  if (event === "prompt") parts.prompt = str(n.prompt);
  return parts;
}

const systemMessage = (a) => ({ systemMessage: a.message });
const deny = (a) => ({ decision: "deny", reason: a.reason });
const context = (a) => ({ hookSpecificOutput: { additionalContext: a.context } });

/**
 * What each event can take (see claude-code.mjs). Gemini CLI has no `ask`: a hook that answers `ask` ends a headless run with no output.
 * BeforeTool takes no added context (AfterTool does); `allow` has no effect, so it prints nothing.
 */
export const FORMS = {
  "pre-tool": { deny, message: systemMessage },
  "post-tool": { deny, context, message: systemMessage, effects: { deny: "feedback" } },
  prompt: { deny, context, message: systemMessage },
  "session-start": { context, message: systemMessage },
  "session-end": { message: systemMessage },
  stop: { deny, message: systemMessage, effects: { deny: "continue" } },
};

export const commandOf = (h) => (isObject(h) && typeof h.command === "string" ? h.command : null);

/** How settings.json keeps hooks. */
export const LAYOUT = {
  shape: "grouped",
  root: ["hooks"],
  empty: () => ({}),
  handler: ({ command, timeout, name: label }) => ({ type: "command", name: label || "everyhook", command, timeout: timeout * 1000 }),
  timeoutUnit: "ms",
};
