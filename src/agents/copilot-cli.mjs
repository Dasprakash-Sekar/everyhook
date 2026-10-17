// GitHub Copilot CLI (https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference). Hooks live in
// <COPILOT_HOME>/hooks/*.json and <project>/.github/hooks/*.json: { "version": 1, "hooks": { "<event>": [ handler ] } }. Copilot also reads
// .claude/settings.json of the project. A handler is `bash`/`powershell` command lines, or `exec` + `args` that run with no shell. The
// payloads come in two spellings, camelCase (event names such as preToolUse) and snake_case (PascalCase event names, Claude's spelling);
// everyhook installs camelCase and reads both. Verified on 1.0.98 (see fixtures/copilot-cli/ and fixtures/conformance/copilot-cli.json).
import { isObject, kindOf, makeTool, str } from "./common.mjs";

export const id = "copilot-cli";
export const name = "GitHub Copilot CLI";

/** The tool names this agent sends, and the kind each is. */
export const TOOLS = [
  ["bash", "shell"],
  ["powershell", "shell"],
  ["Bash", "shell"],
  ["create", "write"],
  ["Write", "write"],
  ["edit", "edit"],
  ["str_replace_editor", "edit"],
  ["apply_patch", "edit"],
  ["Edit", "edit"],
  ["view", "read"],
  ["Read", "read"],
];
export const TOOL_PATTERNS = [[/^mcp__/, "mcp", "mcp__<server>__<tool>"]];

export const NATIVE = {
  "pre-tool": "preToolUse",
  "post-tool": "postToolUse",
  prompt: "userPromptSubmitted",
  "session-start": "sessionStart",
  "session-end": "sessionEnd",
  stop: "agentStop",
};
/** Both spellings of every event: camelCase, and the PascalCase names of the Claude-compatible payload. */
export const ALIASES = {
  preToolUse: "pre-tool", PreToolUse: "pre-tool",
  postToolUse: "post-tool", PostToolUse: "post-tool",
  userPromptSubmitted: "prompt", UserPromptSubmit: "prompt",
  sessionStart: "session-start", SessionStart: "session-start",
  sessionEnd: "session-end", SessionEnd: "session-end",
  agentStop: "stop", Stop: "stop",
};

const pathsOf = (i) => [str(i.path), str(i.file_path)].filter(Boolean).slice(0, 1);

/** The contract's parts of one native document, in either spelling. */
export function normalize(event, n) {
  const parts = {
    cwd: str(n.cwd),
    session: str(n.sessionId) ?? str(n.session_id),
    transcript: str(n.transcriptPath) ?? str(n.transcript_path),
  };
  if (event === "pre-tool" || event === "post-tool") {
    const name = n.toolName ?? n.tool_name;
    const result = n.toolResult ?? n.tool_result;
    parts.tool = makeTool({ name, input: n.toolArgs ?? n.tool_input, response: event === "post-tool" ? result : undefined, kind: kindOf(TOOLS, TOOL_PATTERNS, name), pick: pathsOf });
  }
  if (event === "prompt") parts.prompt = str(n.prompt);
  return parts;
}

/**
 * What each event can take (see claude-code.mjs). Copilot drops the output of a userPromptSubmitted command hook, takes no message to the
 * person, and has no way to refuse at postToolUse or sessionStart.
 */
export const FORMS = {
  "pre-tool": {
    deny: (a) => ({ permissionDecision: "deny", permissionDecisionReason: a.reason }),
    ask: (a) => ({ permissionDecision: "ask", permissionDecisionReason: a.reason }),
    allow: (a) => ({ permissionDecision: "allow", ...(a.reason ? { permissionDecisionReason: a.reason } : {}) }),
  },
  "post-tool": { context: (a) => ({ additionalContext: a.context }) },
  prompt: {},
  "session-start": { context: (a) => ({ additionalContext: a.context }) },
  "session-end": {},
  stop: { deny: (a) => ({ decision: "block", reason: a.reason }), effects: { deny: "continue" } },
};

/** What a handler runs, as one command line (exec + args are joined, a bash or powershell line is taken as it is). */
export function commandOf(h) {
  if (!isObject(h)) return null;
  if (typeof h.exec === "string") return [h.exec, ...(Array.isArray(h.args) ? h.args : [])].map((a) => (/[\s"]/.test(String(a)) ? `"${String(a).replace(/"/g, '\\"')}"` : String(a))).join(" ");
  return str(h.powershell) ?? str(h.bash) ?? str(h.command) ?? null;
}

/** How a hooks file keeps hooks: a version, and events that hold handlers directly. */
export const LAYOUT = {
  shape: "flat",
  root: ["hooks"],
  empty: () => ({ version: 1 }),
  handler: ({ exec, args, timeout }) => ({ type: "command", exec, args, timeoutSec: timeout }),
  timeoutUnit: "s",
};
