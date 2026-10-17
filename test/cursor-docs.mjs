// Cursor's documents, written from its reference (https://cursor.com/docs/agent/hooks, read on 17 October 2026): the fields the reference
// names for each hook, with example values. Cursor is not installed on the machine where everyhook was written and its CLI needs a login,
// so none of this was recorded from the binary; every fixture made from it says "source": "documented". The reference does not show the
// input of Cursor's Write tool at preToolUse, so there is no fixture for it.
const base = (event) => ({
  conversation_id: "conv-0001",
  generation_id: "gen-0001",
  model: "claude-opus-4-7-thinking-max",
  model_id: "claude-opus-4-7",
  model_params: [{ id: "thinking", value: "true" }, { id: "context", value: "1m" }, { id: "effort", value: "max" }],
  hook_event_name: event,
  cursor_version: "1.7.2",
  workspace_roots: ["<project>"],
  user_email: null,
  transcript_path: null,
});

const shell = (command) => ({ ...base("preToolUse"), tool_name: "Shell", tool_input: { command, working_directory: "<project>" }, tool_use_id: "abc123", cwd: "<project>", agent_message: "Running a command." });

/** [event, variant, nativeEvent, summary, stdin] for every documented fixture. */
export const CURSOR_FIXTURES = [
  ["session-start", "startup", "sessionStart", "a conversation starts", { ...base("sessionStart"), session_id: "conv-0001", is_background_agent: false, composer_mode: "agent" }],
  ["prompt", "prompt", "beforeSubmitPrompt", "hello", { ...base("beforeSubmitPrompt"), prompt: "hello", attachments: [] }],
  ["pre-tool", "shell-force-push", "preToolUse", "git push --force origin main", shell("git push --force origin main")],
  ["pre-tool", "shell-harmless", "preToolUse", "echo harmless", shell("echo harmless")],
  ["pre-tool", "shell-force-push-beforeShellExecution", "beforeShellExecution", "git push --force origin main", { ...base("beforeShellExecution"), command: "git push --force origin main", cwd: "<project>", sandbox: false }],
  ["pre-tool", "read-env", "beforeReadFile", "<project>/.env", { ...base("beforeReadFile"), file_path: "<project>/.env", content: "SECRET=1\n", attachments: [] }],
  ["pre-tool", "mcp", "beforeMCPExecution", "linear: list_issues", { ...base("beforeMCPExecution"), tool_name: "list_issues", tool_input: "{\"team\":\"core\"}", mcp_server_name: "linear", command: "npx -y linear-mcp" }],
  ["post-tool", "shell-harmless", "postToolUse", "echo harmless", { ...base("postToolUse"), tool_name: "Shell", tool_input: { command: "echo harmless" }, tool_output: "{\"exitCode\":0,\"stdout\":\"harmless\"}", tool_use_id: "abc123", cwd: "<project>", duration: 5432 }],
  ["post-tool", "edit", "afterFileEdit", "<project>/notes.txt", { ...base("afterFileEdit"), file_path: "<project>/notes.txt", edits: [{ old_string: "old line", new_string: "new line" }] }],
  ["stop", "end-turn", "stop", "the agent loop ends", { ...base("stop"), status: "completed", loop_count: 0 }],
  ["session-end", "exit", "sessionEnd", "a conversation ends", { ...base("sessionEnd"), session_id: "conv-0001", reason: "completed", duration_ms: 45000, is_background_agent: false, final_status: "completed" }],
];
