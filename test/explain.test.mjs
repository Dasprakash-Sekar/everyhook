// explain: the table of how the five agents differ, as text and JSON, for the whole table, one agent, and one agent at one event.
import { world, run } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { AGENTS, EVENTS } from "../src/contract.mjs";
import { ROWS } from "../src/conformance.mjs";
import { eventTable, pathsTable } from "../src/explain.mjs";

const explain = async (args) => run(["explain", ...args], { w: world("explain") });

test("every row has a title and a cell for every agent, each with words and a basis of binary or docs", () => {
  assert.ok(ROWS.length >= 12);
  const ids = new Set();
  for (const row of ROWS) {
    assert.ok(!ids.has(row.id), `row ${row.id} twice`);
    ids.add(row.id);
    assert.ok(row.title.length > 3);
    assert.deepEqual(Object.keys(row.cells), AGENTS, row.id);
    for (const a of AGENTS) {
      const c = row.cells[a];
      assert.ok(c.text.length > 8 && /[.)]$/.test(c.text) || c.text.length > 8, `${row.id}/${a}`);
      assert.ok(c.basis === "binary" || c.basis === "docs", `${row.id}/${a}: ${c.basis}`);
      assert.ok(c.basis === "docs" || c.case, `${row.id}/${a}: a binary cell names the case that shows it`);
    }
  }
});

test("Cursor's cells are all docs: it was not run", () => {
  for (const row of ROWS) assert.equal(row.cells.cursor.basis, "docs", row.id);
});

test("the whole table as text: a block per question, a line per agent with its basis", async () => {
  const r = await explain([]);
  assert.equal(r.code, 0);
  assert.match(r.out, /^How the five coding agents differ on hooks\. \[binary\] = a real run of the agent saw it, \[docs\] = its documentation says so\.\n/);
  for (const row of ROWS) assert.ok(r.out.includes(`${row.title}\n`), row.title);
  assert.match(r.out, /\n  codex {8}\[binary\] on Windows the call runs: Codex starts the command through powershell\.exe/);
  assert.match(r.out, /\n  cursor {7}\[docs\] {3}/);
  assert.ok(r.out.endsWith("for what everyhook prints for each answer.\n"));
});

test("one agent: its cells, its tool names and kinds, and its files on each system", async () => {
  const r = await explain(["codex"]);
  assert.match(r.out, /^Codex CLI \(codex\)\n/);
  assert.match(r.out, /Tool names and their kind:\n {2}Bash +shell\n {2}PowerShell +shell\n {2}apply_patch +edit/);
  assert.match(r.out, /mcp__<server>__<tool> +mcp\n {2}\(any other\) +other/);
  assert.match(r.out, /Windows\n {4}\* user +C:\\Users\\you\\\.codex\\hooks\.json\n/);
  assert.match(r.out, /macOS\n {4}\* user +\/Users\/you\/\.codex\/hooks\.json\n/);
  assert.match(r.out, /Linux\n {4}\* user +\/home\/you\/\.codex\/hooks\.json\n {6}user +\/home\/you\/\.codex\/config\.toml\n/);
  assert.match(r.out, /<project>\\\.codex\\hooks\.json/);
  assert.match(r.out, /Events: pre-tool = PreToolUse, post-tool = PostToolUse, prompt = UserPromptSubmit, session-start = SessionStart, session-end = SessionEnd, stop = Stop/);
  const copilot = (await explain(["copilot-cli"])).out;
  assert.match(copilot, /\.claude[\\/]settings\.json {2}\(a claude-code file this agent also reads\)/);
});

test("one agent at one event: what everyhook prints for each answer, with the effect and the notes", async () => {
  const r = await explain(["codex", "pre-tool"]);
  assert.match(r.out, /^Codex CLI, pre-tool \(PreToolUse\): before a tool runs; a hook can block it\n/);
  assert.match(r.out, /\n {2}deny {10}\{"hookSpecificOutput":\{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"<reason>"\},"systemMessage":"<message>"\}\n {16}the action is blocked\n/);
  assert.match(r.out, /\n {2}ask {11}\{"hookSpecificOutput":\{"hookEventName":"PreToolUse","permissionDecision":"deny"[^\n]*\n {16}the action is blocked; ask became deny: Codex CLI cannot ask at pre-tool\n/);
  assert.match(r.out, /\n {2}allow {9}\(nothing\)\n/);
  assert.match(r.out, /\nIt can take: deny, context, message\.\n$/);
  const cursor = (await explain(["cursor", "pre-tool"])).out;
  assert.match(cursor, /It can take: deny, allow, message\./);
});

test("eventTable has a row for each answer, and is what translate prints", () => {
  for (const agent of AGENTS) for (const event of EVENTS) {
    const t = eventTable(agent, event);
    assert.deepEqual(t.map((x) => x.answer), ["deny", "ask", "allow", "context", "message", "(no opinion)"]);
    for (const row of t) assert.ok(row.native === null || typeof row.native === "string");
  }
});

test("pathsTable: the files of an agent on each of three systems, with the one install writes marked", () => {
  for (const agent of AGENTS) {
    const p = pathsTable(agent);
    assert.deepEqual(Object.keys(p), ["win32", "darwin", "linux"]);
    for (const os of Object.keys(p)) assert.ok(p[os].filter((x) => x.install).length === 2, `${agent} ${os}: one user and one project file are written`);
    assert.ok(p.win32.every((x) => /^[A-Z]:\\|^<project>/.test(x.path)), agent);
  }
});

test("--json: the same table as data, narrowed to an agent and an event", async () => {
  const all = (await run(["explain", "--json"], { w: world("explain") })).json();
  assert.deepEqual(all.agents, AGENTS);
  assert.equal(all.rows.length, ROWS.length);
  assert.deepEqual(Object.keys(all.rows[0].cells), AGENTS);
  const one = (await run(["explain", "gemini-cli", "stop", "--json"], { w: world("explain") })).json();
  assert.deepEqual(one.agents, ["gemini-cli"]);
  assert.deepEqual(Object.keys(one.events), ["stop"]);
  assert.equal(one.events.stop.native, "AfterAgent");
  assert.deepEqual(one.rows[0].cells["gemini-cli"].basis, "binary");
  assert.deepEqual(one.tools.names.find((t) => t.name === "run_shell_command"), { name: "run_shell_command", kind: "shell" });
  assert.deepEqual(one.tools.patterns, [{ pattern: "mcp_<server>_<tool>", kind: "mcp" }]);
});
