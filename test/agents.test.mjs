// The five adapters read the documents the real agents sent (fixtures/): the kind of each tool, its command, its path, its output, the
// prompt, the folder and the session; and the tables of tool names.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { MODULES, agentModule, contractEventOf, formsOf } from "../src/agents/index.mjs";
import { isObject, kindOf, makeTool, mergeParts, outputText, patchFiles } from "../src/agents/common.mjs";
import { AGENTS, EVENTS, KINDS, buildDocument } from "../src/contract.mjs";
import { loadFixtures } from "../src/fixtures.mjs";

const docOf = (f) => buildDocument(f.agent, f.event, MODULES[f.agent].normalize(f.event, f.stdin), f.stdin);
const all = loadFixtures().map((r) => r.fixture);

test("every fixture becomes a document with the contract's fields, the native JSON whole, and a folder, a session", () => {
  assert.ok(all.length >= 50, `${all.length} fixtures`);
  for (const f of all) {
    const d = docOf(f);
    const where = `${f.agent}/${f.event}.${f.variant}`;
    assert.equal(d.everyhook, 1, where);
    assert.equal(d.agent, f.agent, where);
    assert.equal(d.event, f.event, where);
    assert.deepEqual(d.native, f.stdin, where);
    assert.equal(typeof d.session, "string", `${where}: session`);
    assert.ok(typeof d.cwd === "string" && d.cwd.length > 0, `${where}: cwd`);
    if (f.event === "pre-tool" || f.event === "post-tool") {
      assert.ok(KINDS.includes(d.tool.kind), where);
      assert.equal(typeof d.tool.name, "string", where);
      assert.ok(isObject(d.tool.input), `${where}: input`);
    } else assert.equal(d.tool, undefined, `${where}: no tool at ${f.event}`);
  }
});

const recorded = (agent, event, variant) => docOf(all.find((f) => f.agent === agent && f.event === event && f.variant === variant));

test("Claude Code: Bash is shell with a command, Write and Edit and Read carry file_path, the result is stdout and stderr", () => {
  const sh = recorded("claude-code", "pre-tool", "shell-force-push").tool;
  assert.deepEqual([sh.name, sh.kind, sh.command], ["Bash", "shell", "git push --force origin main"]);
  assert.equal(sh.output, undefined, "no output before the tool runs");
  const post = recorded("claude-code", "post-tool", "shell-harmless").tool;
  assert.equal(post.output, "harmless");
  const w = recorded("claude-code", "pre-tool", "write-env").tool;
  assert.deepEqual([w.name, w.kind], ["Write", "write"]);
  assert.ok(/[\\/]\.env$/.test(w.path) && w.path.startsWith("<project>"), w.path);
  assert.deepEqual([recorded("claude-code", "pre-tool", "edit").tool.name, recorded("claude-code", "pre-tool", "edit").tool.kind], ["Edit", "edit"]);
  assert.deepEqual([recorded("claude-code", "pre-tool", "read").tool.name, recorded("claude-code", "pre-tool", "read").tool.kind], ["Read", "read"]);
  assert.equal(recorded("claude-code", "prompt", "prompt").prompt, "PROBE-MAIN hello");
  assert.equal(recorded("claude-code", "post-tool", "write-env").tool.output.includes("\"type\":\"create\""), true, "an object result is its JSON");
});

test("Codex CLI: Bash is shell; apply_patch is edit, or write when it only adds files, with the files of the patch in paths", () => {
  const sh = recorded("codex", "pre-tool", "shell-harmless").tool;
  assert.deepEqual([sh.name, sh.kind, sh.command], ["Bash", "shell", "echo harmless"]);
  const w = recorded("codex", "pre-tool", "write-env").tool;
  assert.deepEqual([w.name, w.kind], ["apply_patch", "write"]);
  assert.ok(/[\\/]\.env$/.test(w.path), w.path);
  assert.equal(w.paths, undefined, "one file: no paths");
  const e = recorded("codex", "pre-tool", "edit").tool;
  assert.deepEqual([e.name, e.kind], ["apply_patch", "edit"]);
  assert.ok(/notes\.txt$/.test(e.path), e.path);
  assert.equal(typeof recorded("codex", "post-tool", "shell-harmless").tool.output, "string");
  assert.equal(recorded("codex", "prompt", "prompt").prompt, "hello");
});

test("Codex CLI: a patch that touches several files names them all in paths, and moving a file counts as an edit", () => {
  const n = { cwd: "/p", session_id: "s", tool_name: "apply_patch", tool_input: { command: "*** Begin Patch\n*** Add File: a.txt\n+x\n*** Add File: b/.env\n+y\n*** End Patch\n" } };
  const add = MODULES.codex.normalize("pre-tool", n).tool;
  assert.deepEqual([add.kind, add.path, add.paths], ["write", "a.txt", ["a.txt", "b/.env"]]);
  const mixed = MODULES.codex.normalize("pre-tool", { ...n, tool_input: { command: "*** Begin Patch\n*** Add File: a.txt\n+x\n*** Update File: c.txt\n@@\n-a\n+b\n*** Delete File: d.txt\n*** End Patch\n" } }).tool;
  assert.deepEqual([mixed.kind, mixed.paths], ["edit", ["a.txt", "c.txt", "d.txt"]]);
  const moved = MODULES.codex.normalize("pre-tool", { ...n, tool_input: { command: "*** Begin Patch\n*** Update File: old.txt\n*** Move to: new.txt\n*** End Patch\n" } }).tool;
  assert.deepEqual(moved.paths, ["old.txt", "new.txt"]);
  assert.deepEqual(patchFiles("nothing here"), { files: [], onlyAdds: false });
});

test("Gemini CLI: run_shell_command, write_file, replace and read_file; the result is llmContent", () => {
  assert.deepEqual([recorded("gemini-cli", "pre-tool", "shell-force-push").tool.name, recorded("gemini-cli", "pre-tool", "shell-force-push").tool.kind, recorded("gemini-cli", "pre-tool", "shell-force-push").tool.command], ["run_shell_command", "shell", "git push --force origin main"]);
  assert.deepEqual([recorded("gemini-cli", "pre-tool", "write").tool.name, recorded("gemini-cli", "pre-tool", "write").tool.kind], ["write_file", "write"]);
  assert.deepEqual([recorded("gemini-cli", "pre-tool", "edit").tool.name, recorded("gemini-cli", "pre-tool", "edit").tool.kind], ["replace", "edit"]);
  assert.deepEqual([recorded("gemini-cli", "pre-tool", "read").tool.name, recorded("gemini-cli", "pre-tool", "read").tool.kind], ["read_file", "read"]);
  assert.match(recorded("gemini-cli", "post-tool", "shell-harmless").tool.output, /harmless/);
  assert.equal(recorded("gemini-cli", "prompt", "prompt").prompt, "hello");
});

test("Copilot CLI: bash or powershell, create, edit and view; camelCase fields and the Claude-compatible snake_case ones", () => {
  const sh = recorded("copilot-cli", "pre-tool", "shell-force-push").tool;
  assert.ok(["bash", "powershell"].includes(sh.name));
  assert.deepEqual([sh.kind, sh.command], ["shell", "git push --force origin main"]);
  assert.deepEqual([recorded("copilot-cli", "pre-tool", "write-env").tool.name, recorded("copilot-cli", "pre-tool", "write-env").tool.kind], ["create", "write"]);
  assert.deepEqual([recorded("copilot-cli", "pre-tool", "edit").tool.name, recorded("copilot-cli", "pre-tool", "edit").tool.kind], ["edit", "edit"]);
  assert.deepEqual([recorded("copilot-cli", "pre-tool", "read").tool.name, recorded("copilot-cli", "pre-tool", "read").tool.kind], ["view", "read"]);
  assert.match(recorded("copilot-cli", "post-tool", "shell-harmless").tool.output, /harmless/);
  assert.equal(recorded("copilot-cli", "prompt", "prompt").prompt, "hello");
  const snake = MODULES["copilot-cli"].normalize("pre-tool", { hook_event_name: "PreToolUse", session_id: "s1", cwd: "/p", tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: "/t" });
  assert.deepEqual([snake.tool.name, snake.tool.kind, snake.tool.command, snake.session, snake.transcript], ["Bash", "shell", "ls", "s1", "/t"]);
});

test("Cursor: the generic tool events and the specific ones (shell, MCP, read file, file edit)", () => {
  const sh = recorded("cursor", "pre-tool", "shell-force-push").tool;
  assert.deepEqual([sh.name, sh.kind, sh.command], ["Shell", "shell", "git push --force origin main"]);
  const bse = recorded("cursor", "pre-tool", "shell-force-push-beforeShellExecution").tool;
  assert.deepEqual([bse.name, bse.kind, bse.command], ["beforeShellExecution", "shell", "git push --force origin main"]);
  const rd = recorded("cursor", "pre-tool", "read-env").tool;
  assert.deepEqual([rd.kind, rd.path], ["read", "<project>/.env"]);
  const mcp = recorded("cursor", "pre-tool", "mcp").tool;
  assert.deepEqual([mcp.name, mcp.kind, mcp.input], ["list_issues", "mcp", { team: "core" }], "the JSON string of the input is parsed");
  const edit = recorded("cursor", "post-tool", "edit").tool;
  assert.deepEqual([edit.kind, edit.path], ["edit", "<project>/notes.txt"]);
  assert.equal(recorded("cursor", "post-tool", "shell-harmless").tool.output.includes("harmless"), true);
  assert.equal(recorded("cursor", "prompt", "prompt").prompt, "hello");
  assert.equal(recorded("cursor", "pre-tool", "shell-harmless").cwd, "<project>");
  assert.equal(MODULES.cursor.normalize("pre-tool", { hook_event_name: "preToolUse", tool_name: "Shell", workspace_roots: ["/w"] }).cwd, "/w", "the first workspace root when there is no cwd");
});

test("kindOf: exact names first, then the patterns, then other", () => {
  const cc = MODULES["claude-code"];
  assert.equal(kindOf(cc.TOOLS, cc.TOOL_PATTERNS, "Bash"), "shell");
  assert.equal(kindOf(cc.TOOLS, cc.TOOL_PATTERNS, "mcp__github__get_issue"), "mcp");
  assert.equal(kindOf(cc.TOOLS, cc.TOOL_PATTERNS, "Glob"), "other");
  assert.equal(kindOf(MODULES["gemini-cli"].TOOLS, MODULES["gemini-cli"].TOOL_PATTERNS, "mcp_github_get_issue"), "mcp");
  assert.equal(kindOf(MODULES.cursor.TOOLS, MODULES.cursor.TOOL_PATTERNS, "MCP:list_issues"), "mcp");
  for (const a of AGENTS) for (const [name, kind] of MODULES[a].TOOLS) assert.ok(KINDS.includes(kind), `${a}: ${name} is ${kind}`);
});

test("every agent module has the six events, a layout, forms for each event, and aliases back to the contract's events", () => {
  for (const a of AGENTS) {
    const m = agentModule(a);
    assert.deepEqual(Object.keys(m.NATIVE).sort(), [...EVENTS].sort(), a);
    for (const e of EVENTS) {
      assert.equal(contractEventOf(m, m.NATIVE[e]), e, `${a}: ${m.NATIVE[e]} maps back`);
      assert.ok(m.FORMS[e], `${a}: forms for ${e}`);
      assert.ok(formsOf(m, e) === m.FORMS[e] || a === "cursor");
    }
    assert.ok(["grouped", "flat"].includes(m.LAYOUT.shape));
    assert.ok(["s", "ms"].includes(m.LAYOUT.timeoutUnit));
    assert.equal(typeof m.LAYOUT.handler({ command: "c", exec: "node", args: [], timeout: 5 }), "object");
  }
  assert.equal(agentModule("nobody"), null);
  assert.equal(agentModule("constructor"), null, "only the five");
  assert.equal(contractEventOf(MODULES["copilot-cli"], "PreToolUse"), "pre-tool", "the PascalCase spelling too");
  assert.equal(contractEventOf(MODULES["copilot-cli"], "nothing"), null);
});

test("the timeout unit of each layout: seconds everywhere, milliseconds for Gemini CLI", () => {
  const h = (a) => MODULES[a].LAYOUT.handler({ command: "c", exec: "node", args: ["x"], timeout: 30 });
  assert.equal(h("claude-code").timeout, 30);
  assert.equal(h("codex").timeout, 30);
  assert.equal(h("gemini-cli").timeout, 30000);
  assert.equal(h("copilot-cli").timeoutSec, 30);
  assert.equal(h("cursor").timeout, 30);
  assert.deepEqual(h("copilot-cli").args, ["x"]);
  assert.equal(MODULES["claude-code"].LAYOUT.handler({ command: "c", timeout: 1, failClosed: true }).onFailure, "block");
  assert.equal(MODULES.cursor.LAYOUT.handler({ command: "c", timeout: 1, failClosed: true }).failClosed, true);
});

test("common helpers: outputText, makeTool, mergeParts", () => {
  assert.equal(outputText("x"), "x");
  assert.equal(outputText({ stdout: "a", stderr: "b" }), "a\nb");
  assert.equal(outputText({ stdout: "a", stderr: "" }), "a");
  assert.equal(outputText({ llmContent: "L", returnDisplay: "D" }), "L");
  assert.equal(outputText({ resultType: "success", textResultForLlm: "T" }), "T");
  assert.equal(outputText({ a: 1 }), '{"a":1}');
  assert.equal(outputText(undefined), undefined);
  assert.throws(() => makeTool({ name: "x", kind: "nope" }), /unknown kind/);
  assert.deepEqual(makeTool({ name: "Edit", input: { file_path: "/a" }, kind: "edit", pick: (i) => [i.file_path] }), { name: "Edit", kind: "edit", path: "/a", input: { file_path: "/a" } });
  assert.deepEqual(makeTool({ name: "x", input: "not an object", kind: "other" }), { name: "x", kind: "other", input: {} });
  assert.deepEqual(mergeParts({ a: { b: 1 } }, null, { a: { c: 2 }, d: 3 }), { a: { b: 1, c: 2 }, d: 3 });
});
