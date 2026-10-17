// The README, held to the code: its sections, the commands and options it names, the usage block, the numbers it quotes, the tables (tool
// names, events, what the real binaries did, what every agent did through everyhook), the JSON shapes, the examples (they are what the
// code prints), the Files table, and the hook it shows.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, run, world } from "./helpers.mjs";
import { AGENTS, EVENTS } from "../src/contract.mjs";
import { MODULES } from "../src/agents/index.mjs";
import { HELP } from "../src/cli.mjs";
import { casesFor, EXPECT, expected } from "./conformance.mjs";
import { GONE, REACHED, TOOL_CASES } from "./adapter.mjs";
import { pathsTable } from "../src/explain.mjs";
import { TABLE } from "./translate-table.mjs";

const file = (...p) => path.join(ROOT, ...p);
const readText = (...p) => fs.readFileSync(file(...p), "utf8").replace(/\r\n/g, "\n");
const readme = readText("README.md");
const section = (from, to) => readme.slice(readme.indexOf(`\n${from}\n`), to ? readme.indexOf(`\n${to}\n`) : undefined);
const cellsOf = (line) => line.split("|").slice(1, -1).map((c) => c.trim());
const tableAfter = (heading, header) => {
  const start = readme.indexOf(heading);
  assert.ok(start >= 0, `${heading} is in the README`);
  const at = readme.indexOf(header, start);
  assert.ok(at >= 0, `the table "${header}" follows ${heading}`);
  const lines = readme.slice(at).split("\n");
  const rows = [];
  for (const l of lines.slice(2)) { if (!l.startsWith("|")) break; rows.push(cellsOf(l)); }
  return { header: cellsOf(lines[0]), rows };
};

const README_SECTIONS = ["## What you get", "## What it costs in tokens", "## Install", "## Use", "## How it works", "## What was verified, and how", "## Not verified", "## Files", "## Contributing", "## Also by the same author", "## License"];

test("the README has the sections the house keeps, in order, and the Privacy heading under How it works", () => {
  let at = -1;
  for (const h of README_SECTIONS) {
    const i = readme.indexOf(`\n${h}\n`);
    assert.ok(i > at, `${h} is there, after the one before it`);
    at = i;
  }
  assert.match(readme, /^# everyhook\n/);
  assert.ok(readme.indexOf("\n### Privacy\n") > readme.indexOf("\n## How it works\n") && readme.indexOf("\n### Privacy\n") < readme.indexOf("\n## What was verified, and how\n"), "### Privacy sits under How it works");
  const use = section("## Use", "## How it works");
  for (const cmd of ["run", "install", "uninstall", "restore", "list", "bench", "explain"]) assert.ok(use.includes(`\n### \`${cmd}\`\n`), `a heading for ${cmd}`);
  assert.ok(use.includes("\n### The contract\n") && use.includes("\n### The examples\n") && use.includes("\n### The JSON documents\n"));
});

test("the README names every command and option the CLI has, the install lines, the numbers of the opening paragraph and the promise", () => {
  const flags = [...new Set(HELP.match(/--[a-z][a-z-]*/g))];
  assert.ok(flags.length >= 12, flags.join(" "));
  for (const f of flags) assert.ok(readme.includes(`\`${f}`), `${f} is named in the README`);
  for (const c of ["run", "install", "uninstall", "restore", "list", "bench", "explain"]) assert.ok(readme.includes(`everyhook ${c}`), `everyhook ${c}`);
  for (const l of ["npx -y github:nrzz/everyhook explain", "git clone https://github.com/nrzz/everyhook", "npm install -g github:nrzz/everyhook", "node everyhook/bin/everyhook.mjs install everyhook/examples/block-force-push.mjs --all", "everyhook install examples/block-force-push.mjs --all"]) assert.ok(readme.includes(l), l);
  const opening = readme.slice(0, readme.indexOf("\n## What you get\n"));
  for (const n of ["Stack Overflow's 2026 survey", "Claude Code 66%", "GitHub Copilot 59%", "**Write a hook once. Run it in every coding agent.**"]) assert.ok(opening.includes(n), n);
  assert.ok(!/\p{Extended_Pictographic}/u.test(readme), "no emoji");
  assert.ok(!/\b(simply|easily|blazing|seamless|powerful|amazing|revolutionary)\b/i.test(readme), "plain words");
  assert.ok(!readme.includes("—"), "no long dashes");
});

test("the links in the README that point into the repository go to files that are there, and the links to its own headings to headings that are there", () => {
  for (const m of readme.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) assert.ok(fs.existsSync(file(m[1].split("#")[0])), `${m[1]} is linked and exists`);
  const slug = (h) => h.toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");
  const slugs = new Set([...readme.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1].replace(/`/g, ""))));
  for (const m of readme.matchAll(/\]\(#([^)\s]+)\)/g)) assert.ok(slugs.has(m[1]), `#${m[1]} is a heading`);
  for (const url of ["https://github.com/nrzz/claude-code-toolkit", "https://github.com/nrzz/claude-hook-bench", "https://github.com/nrzz/claude-code-guardrails", "https://github.com/nrzz/everyhook/issues/1"]) assert.ok(readme.includes(url), url);
  assert.ok(readme.includes("nineteen tools for Claude Code"));
});

test("the usage block of the README is the help text of the CLI, and nothing is left to fill in", async () => {
  const w = world("readme-help");
  const help = (await run(["--help"], { w })).out;
  const usage = help.slice(help.indexOf("Usage: everyhook")).trimEnd();
  assert.equal(usage, HELP.slice(HELP.indexOf("Usage: everyhook")).trimEnd());
  assert.ok(readme.includes(usage), "the README's usage block is out of date: paste the output of everyhook --help from its Usage line");
  assert.ok(!readme.includes("@@"), "a placeholder is still in the README");
});

// ---- the numbers --------------------------------------------------------------------------------------------------------------------

const countFiles = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".json")).length;

test("the numbers the README quotes are the numbers of the files and tables: documents, cases, the translation table", () => {
  const recorded = ["claude-code", "codex", "gemini-cli", "copilot-cli"].map((a) => countFiles(file("fixtures", a)));
  const documented = countFiles(file("fixtures", "cursor"));
  const recordedTotal = recorded.reduce((a, b) => a + b, 0);
  assert.ok(readme.includes(`${recordedTotal} documents that the four binaries sent a hook`), `${recordedTotal} recorded documents`);
  assert.ok(readme.includes(`${documented} for Cursor that are written from its reference`), `${documented} documented documents`);
  assert.ok(readme.includes(`${recordedTotal + documented} of them`), "the total of documents in What you get");
  const cases = AGENTS.filter((a) => a !== "cursor").map((a) => casesFor(a).length);
  const total = cases.reduce((a, b) => a + b, 0);
  assert.ok(readme.includes(`${cases[0]} cases for Claude Code and Codex CLI, ${cases[2]} for Gemini CLI and ${cases[3]} for Copilot CLI, ${total} in all`), `the cases: ${cases.join(", ")}, ${total}`);
  assert.equal(cases[0], cases[1]);
  assert.equal(TABLE.length, AGENTS.length * EVENTS.length * 6, "the table is every agent, event and answer");
  assert.ok(readme.includes(`the ${TABLE.length} cases of the translation table (5 agents, 6 events, 6 answers)`));
  const install = readText("test", "install.test.mjs");
  const states = install.slice(install.indexOf("const PRE_STATES = {"), install.indexOf("\n};", install.indexOf("const PRE_STATES = {")));
  assert.equal([...states.matchAll(/^ {2}"[^"]+": /gm)].length, 10, "ten layouts");
  assert.ok(readme.includes("ten layouts that `uninstall` must give back to the byte"));
  assert.ok(readText("test", "jsonedit.test.mjs").includes("assert.equal(checked, 400)") && readme.includes("fuzz round trip of 400 cases"));
  const files = fs.readdirSync(file("test")).filter((n) => n.endsWith(".test.mjs")).length;
  assert.ok(readme.includes(`the ${files} files of tests`), `${files} files of tests`);
});

test("the number of tests the README states is the runner's total minus the helper files that node --test lists as tests", { skip: process.env.README_COUNTING && "this is the run that counts" }, () => {
  const env = { ...process.env, README_COUNTING: "1" };
  for (const k of ["E2E_CLAUDE", "E2E_CODEX", "E2E_GEMINI", "E2E_COPILOT", "NODE_TEST_CONTEXT", "RECORD_FIXTURES"]) delete env[k];
  const count = (args) => {
    const r = spawnSync(process.execPath, ["--test", ...args], { cwd: ROOT, env, encoding: "utf8", timeout: 600000, windowsHide: true });
    const num = (name) => Number((new RegExp(`^(?:# |ℹ )${name} (\\d+)$`, "m").exec(r.stdout) || [])[1]);
    return { tests: num("tests"), skipped: num("skipped"), fail: num("fail"), out: r.stdout };
  };
  const all = count([]);
  assert.ok(all.tests > 100, `the runner reported ${all.tests} tests:\n${all.out.slice(-600)}`);
  assert.equal(all.fail, 0, "no test fails in the run that counts");
  const helpers = fs.readdirSync(file("test")).filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs")).length;
  const counted = all.tests - helpers;
  const stated = /\*\*(\d+) automated tests\*\*/.exec(readme);
  assert.ok(stated, "the README says how many automated tests there are");
  assert.equal(Number(stated[1]), counted, `the runner reported ${all.tests}, of which ${helpers} are helper files: ${counted} tests`);
  assert.ok(readme.includes(`each of the ${helpers} helper files`), `the README names the ${helpers} helper files`);
  const e2e = count(["test/e2e-adapter.test.mjs", "test/e2e-conformance.test.mjs"]);
  assert.equal(e2e.skipped, e2e.tests, "without the agents' binaries every real-binary check is skipped");
  assert.ok(readme.includes(`${e2e.tests} of them put the code to the real binaries`), `${e2e.tests} real-binary checks`);
});

test("the cost of the example hooks: the reasons are the lengths the README gives, and under 200 characters", () => {
  const w = world("readme-cost");
  const ask = (example, doc) => {
    const r = spawnSync(process.execPath, [file("examples", example)], { input: JSON.stringify({ everyhook: 1, agent: "claude-code", event: "pre-tool", cwd: w.work, ...doc }), encoding: "utf8", cwd: w.work, env: w.env, windowsHide: true });
    return JSON.parse(r.stdout).reason;
  };
  const shell = (command) => ({ tool: { name: "Bash", kind: "shell", command, input: { command } } });
  const reasons = [
    ask("block-force-push.mjs", shell("git push --force origin main")),
    ask("block-force-push.mjs", shell("git push --force origin master")),
    ask("block-force-push.mjs", shell("git push --all --force")),
    ask("block-force-push.mjs", shell("git push --force")),
    ask("protect-env-files.mjs", { tool: { name: "Write", kind: "write", path: path.join(w.work, ".env.production.local"), input: {} } }),
    ask("protect-env-files.mjs", { tool: { name: "Edit", kind: "edit", path: path.join(w.work, ".env"), input: {} } }),
  ];
  assert.equal(reasons[0].length, 106, "a push to main");
  const longest = Math.max(...reasons.map((r) => r.length));
  assert.equal(longest, reasons[3].length, "the longest is the push that names no branch");
  assert.ok(longest < 200 && readme.includes(`is ${longest} characters`) && readme.includes("for a push to `main`, is 106"), `the longest reason is ${longest} characters`);
  assert.ok(readme.includes(`about ${Math.round(longest / 4)} tokens at most`) && readme.includes(`| at most ${Math.round(longest / 4)} tokens |`), "the estimate is the characters divided by four");
  for (const r of reasons.slice(4)) assert.ok(r.length >= 80 && r.length <= 110, `${r.length}: about 100 characters for a protected file`);
});

// ---- the tables ---------------------------------------------------------------------------------------------------------------------

test("the intro table: the names of the event before a tool, and what exit code 1 does, are what the code and the recordings say", () => {
  const { header, rows } = tableAfter("\n| | Claude Code |", "| | Claude Code |");
  assert.deepEqual(header, ["", "Claude Code", "Codex CLI", "Gemini CLI", "Copilot CLI", "Cursor"]);
  const row = (label) => rows.find((r) => r[0] === label);
  assert.deepEqual(row("Before a tool runs").slice(1), AGENTS.map((a) => `\`${MODULES[a].NATIVE["pre-tool"]}\``));
  const words = { ran: "the call runs", blocked: "denies" };
  const exit1 = row("Exit code 1");
  ["claude-code", "codex", "gemini-cli", "copilot-cli"].forEach((a, i) => assert.equal(exit1[i + 1], words[expected(a, "exit1", "win32")], a));
  assert.ok(exit1[5].startsWith("the call runs"), "Cursor runs the call unless failClosed (docs)");
  assert.ok(row("Timeout").slice(1).join() === "seconds,seconds,milliseconds,seconds,seconds");
});

test("the table of tool names is the TOOLS and TOOL_PATTERNS of the agent modules", () => {
  const { header, rows } = tableAfter("\n| Agent | `shell` |", "| Agent | `shell` |");
  const kinds = header.slice(1).map((h) => h.replace(/`/g, ""));
  assert.deepEqual(kinds, ["shell", "edit", "write", "read", "mcp"]);
  const names = { "Claude Code": "claude-code", "Codex CLI": "codex", "Gemini CLI": "gemini-cli", "Copilot CLI": "copilot-cli", Cursor: "cursor" };
  assert.deepEqual(rows.map((r) => names[r[0]]), AGENTS);
  for (const r of rows) {
    const mod = MODULES[names[r[0]]];
    kinds.forEach((kind, i) => {
      const cell = r[i + 1];
      const tokens = [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
      const want = [...mod.TOOLS.filter(([, k]) => k === kind).map(([n]) => n), ...mod.TOOL_PATTERNS.filter(([, k]) => k === kind).map(([, , shown]) => shown)];
      const extra = names[r[0]] === "codex" && kind === "write" ? ["apply_patch"] : [];
      assert.deepEqual([...tokens].sort(), [...want, ...extra].sort(), `${r[0]} ${kind}`);
    });
  }
  assert.ok(MODULES.codex.TOOLS.some(([n, k]) => n === "apply_patch" && k === "edit"), "Codex apply_patch is an edit unless it only adds files");
});

test("the table of events is the NATIVE names of the agent modules", () => {
  const { header, rows } = tableAfter("\n| Event | Claude Code |", "| Event | Claude Code |");
  assert.deepEqual(header, ["Event", "Claude Code", "Codex CLI", "Gemini CLI", "Copilot CLI", "Cursor"]);
  assert.deepEqual(rows.map((r) => r[0]), EVENTS.map((e) => `\`${e}\``));
  for (const r of rows) assert.deepEqual(r.slice(1), AGENTS.map((a) => `\`${MODULES[a].NATIVE[r[0].replace(/`/g, "")]}\``), r[0]);
});

const RAW_ROWS = [
  ["nothing, exit 0", { all: "empty" }],
  ["exit 2, reason on stderr", { all: "exit2" }],
  ["exit 2, nothing on stderr", { all: "exit2n" }],
  ["exit 1, reason on stderr", { all: "exit1" }],
  ["exit 3, reason on stderr", { all: "exit3" }],
  ["`{not json`", { all: "invalid" }],
  ["plain text, not JSON", { all: "plain" }],
  ["nothing for 30 seconds, timeout 10", { all: "timeout" }],
  ["the agent's own deny JSON", { all: "deny-json" }],
  ["a deny JSON with no reason", { "gemini-cli": "deny-noreason", "copilot-cli": "deny-noreason" }],
  ["the older `decision: block` JSON", { "claude-code": "legacy-block", codex: "legacy-block", "gemini-cli": "block-json" }],
  ["the agent's own allow JSON", { all: "allow-json" }],
  ["the agent's own ask JSON", { all: "ask-json" }],
  ["added context at pre-tool", { "claude-code": "ctx", codex: "ctx", "gemini-cli": "ctx" }],
];

test("the table of what the four binaries did with a raw output is the recordings, with the one difference between systems in its cell", () => {
  const four = ["claude-code", "codex", "gemini-cli", "copilot-cli"];
  const { header, rows } = tableAfter("\n| The hook printed |", "| The hook printed |");
  assert.deepEqual(header, ["The hook printed", "Claude Code 2.1.302", "Codex CLI 0.163.0", "Gemini CLI 0.64.0", "Copilot CLI 1.0.98"]);
  const rec = (a) => JSON.parse(readText("fixtures", "conformance", `${a}.json`));
  four.forEach((a, i) => assert.equal(header[i + 1].split(" ").pop(), rec(a).agentVersion, `${a}: the version of the recording`));
  assert.deepEqual(rows.map((r) => r[0]), RAW_ROWS.map(([label]) => label));
  const used = Object.fromEntries(four.map((a) => [a, []]));
  RAW_ROWS.forEach(([label, map], r) => {
    four.forEach((a, i) => {
      const id = map.all || map[a];
      let want = "n/a";
      if (id) {
        assert.ok(casesFor(a).some((c) => c.id === id), `${a} has the case ${id}`);
        used[a].push(id);
        const win = expected(a, id, "win32");
        const other = expected(a, id, "linux");
        assert.equal(expected(a, id, "darwin"), other, "Linux and macOS agree");
        assert.equal(rec(a).cases[id].outcome, win, `${a} ${id}: the recording on Windows`);
        want = win === other ? win : `${win} on Windows, ${other} on Linux and macOS`;
      } else assert.ok(!map.all, "a row for all four agents");
      assert.equal(rows[r][i + 1], want, `${label} / ${a}`);
    });
  });
  for (const a of four) assert.deepEqual([...used[a]].sort(), casesFor(a).map((c) => c.id).sort(), `${a}: every case is in the table`);
  const differing = four.flatMap((a) => Object.keys(EXPECT[a]).filter((id) => expected(a, id, "win32") !== expected(a, id, "linux")).map((id) => `${a}/${id}`));
  assert.deepEqual(differing, ["codex/exit2"], "the one case that differs between systems");
});

test("the table of what every agent did through everyhook is TOOL_CASES, and the table of what reached the model is REACHED", () => {
  const LABELS = { deny: "`deny` with a reason", ask: "`ask`", allow: "`allow`", context: "`context`", exit2: "exit code 2", exit1: "exit code 1", invalid: "output that is not JSON", slow: "a hook that runs too long", none: "no output" };
  const t = tableAfter("\n| The hook's answer at pre-tool |", "| The hook's answer at pre-tool |");
  assert.deepEqual(t.rows, TOOL_CASES.map(([kind, outcome]) => [LABELS[kind], outcome]));
  const r = tableAfter("\n| | Claude Code | Codex CLI | Gemini CLI | Copilot CLI |\n| --- | --- | --- | --- | --- |\n| context returned at pre-tool", "| | Claude Code | Codex CLI | Gemini CLI | Copilot CLI |");
  const yes = (v) => (v ? "yes" : "no");
  const four = ["claude-code", "codex", "gemini-cli", "copilot-cli"];
  assert.deepEqual(r.rows, [
    ["context returned at pre-tool", ...four.map((a) => yes(REACHED[a].preContext))],
    ["the reason of a deny at post-tool", ...four.map((a) => yes(REACHED[a].postDeny))],
    ["context returned at post-tool", ...four.map((a) => yes(REACHED[a].postContext))],
    ["a prompt that a hook refused", ...four.map((a) => (REACHED[a].promptBlocked ? "never sent" : "sent anyway"))],
  ]);
});

test("the table of what the agents did when everyhook could not start is GONE", () => {
  const word = { ran: "the call runs", blocked: "the call is denied" };
  const four = ["claude-code", "codex", "gemini-cli", "copilot-cli"];
  const t = tableAfter("\n| everyhook cannot start |", "| everyhook cannot start |");
  assert.deepEqual(t.header, ["everyhook cannot start", "Claude Code", "Codex CLI", "Gemini CLI", "Copilot CLI"]);
  assert.deepEqual(t.rows, [
    ["the entry as `install` writes it", ...four.map((a) => word[GONE[a].open])],
    ["installed with `--fail-closed`", ...four.map((a) => word[GONE[a].closed])],
  ]);
});

test("the table of the files install writes is what the locations of each agent say", () => {
  const { header, rows } = tableAfter("\n| Agent | User file (install writes it) |", "| Agent | User file (install writes it) |");
  assert.deepEqual(header, ["Agent", "User file (install writes it)", "Project file (install writes it)"]);
  const names = { "Claude Code": "claude-code", "Codex CLI": "codex", "Gemini CLI": "gemini-cli", "Copilot CLI": "copilot-cli", Cursor: "cursor" };
  assert.deepEqual(rows.map((r) => names[r[0]]), AGENTS);
  for (const r of rows) {
    const mine = pathsTable(names[r[0]]).linux.filter((p) => p.install);
    const user = mine.find((p) => p.scope === "user").path.replace("/home/you", "~");
    const project = mine.find((p) => p.scope === "project").path;
    assert.equal(/`([^`]+)`/.exec(r[1])[1], user, `${r[0]}: the user file`);
    assert.equal(/`([^`]+)`/.exec(r[2])[1], project, `${r[0]}: the project file`);
  }
});

// ---- the JSON documents -------------------------------------------------------------------------------------------------------------

/** The shape lines of the README: name { field, field?, field { ... }, field [ { ... } ], <key> ... }. */
function parseShape(text) {
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const object = () => {
    if (text[i] !== "{") throw new Error(`a { expected at: ${text.slice(i, i + 40)}`);
    i++;
    const fields = {};
    for (;;) {
      ws();
      if (text[i] === "}") { i++; return { kind: "object", fields }; }
      if (text[i] === ",") { i++; continue; }
      const m = /^(<[a-z]+>|[A-Za-z_][A-Za-z0-9_]*)(\?)?/.exec(text.slice(i));
      if (!m) throw new Error(`a field name expected at: ${text.slice(i, i + 40)}`);
      i += m[0].length; ws();
      let node = { kind: "leaf" };
      if (text[i] === "{") node = object();
      else if (text[i] === "[") {
        i++; ws();
        const item = object(); ws();
        if (text[i] !== "]") throw new Error(`] expected at: ${text.slice(i, i + 40)}`);
        i++;
        node = { kind: "list", item };
      }
      fields[m[1]] = { optional: Boolean(m[2]), node };
    }
  };
  ws();
  return object();
}

/** Holds the documents to a shape: every key of a document is in the shape, every key of the shape that is not optional is in some document. */
function holdTo(node, samples, where, errors) {
  if (node.kind === "object") {
    const objects = samples.filter((v) => v && typeof v === "object" && !Array.isArray(v));
    const named = Object.keys(node.fields).filter((k) => !k.startsWith("<"));
    const wildcard = Object.keys(node.fields).find((k) => k.startsWith("<"));
    const seen = new Set();
    for (const o of objects) for (const k of Object.keys(o)) { seen.add(k); if (!named.includes(k) && !wildcard) errors.push(`${where}: "${k}" is in a document and not in the README shape`); }
    for (const name of named) {
      const spec = node.fields[name];
      if (!spec.optional && !seen.has(name)) errors.push(`${where}: "${name}" is in the README shape and in no document (mark it with ? if it is optional)`);
      if (spec.node.kind !== "leaf") holdTo(spec.node, objects.map((o) => o[name]).filter((v) => v !== undefined && v !== null), `${where}.${name}`, errors);
    }
    if (wildcard && node.fields[wildcard].node.kind !== "leaf") {
      const rest = objects.flatMap((o) => Object.entries(o).filter(([k]) => !named.includes(k)).map(([, v]) => v));
      holdTo(node.fields[wildcard].node, rest, `${where}.${wildcard}`, errors);
    }
  } else if (node.kind === "list") {
    holdTo(node.item, samples.filter(Array.isArray).flat(), `${where}[]`, errors);
  }
}

const EXAMPLE = file("examples", "block-force-push.mjs");

async function documents() {
  const docs = { run: [], install: [], uninstall: [], restore: [], list: [], bench: [], explain: [], error: [] };
  const j = async (cmd, args, w, stdin) => (await run([cmd, "--json", ...args], { w, stdin })).json();
  // run: an answer, a hook that exits, output that is not an answer (also fail closed), a hook with no opinion, Cursor, a hook that is not there
  {
    const w = world("shape-run");
    const claude = JSON.stringify({ session_id: "s1", cwd: w.work, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
    const gemini = JSON.stringify({ hook_event_name: "BeforeTool", tool_name: "run_shell_command", tool_input: { command: "ls" }, cwd: w.work });
    const cursor = JSON.stringify({ hook_event_name: "preToolUse", tool_name: "Shell", tool_input: { command: "ls" }, cwd: w.work });
    const deny = w.hook("deny.mjs", 'import fs from "node:fs"; fs.readFileSync(0); process.stdout.write(JSON.stringify({ decision: "deny", reason: "R", message: "M", context: "C" }));');
    const exits = w.hook("exit.mjs", 'import fs from "node:fs"; fs.readFileSync(0); process.stderr.write("because"); process.exitCode = 3;');
    const bad = w.hook("bad.mjs", 'import fs from "node:fs"; fs.readFileSync(0); process.stdout.write("garbage");');
    const none = w.hook("none.mjs", 'import fs from "node:fs"; fs.readFileSync(0);');
    for (const [hook, agent, stdin, extra] of [[deny, "claude-code", claude, []], [exits, "claude-code", claude, []], [bad, "codex", claude, []], [bad, "codex", claude, ["--fail-closed"]], [none, "gemini-cli", gemini, []], [deny, "cursor", cursor, []], [path.join(w.hooks, "missing.mjs"), "claude-code", claude, []]]) {
      docs.run.push(await j("run", ["--agent", agent, "--event", "pre-tool", ...extra, "--", hook], w, stdin));
    }
    docs.run.push(await j("run", ["--agent", "claude-code", "--event", "pre-tool", "--", none], w, "not json"));
    const stop = JSON.stringify({ session_id: "s1", cwd: w.work, hook_event_name: "Stop", stop_hook_active: false });
    docs.run.push(await j("run", ["--agent", "claude-code", "--event", "stop", "--", exits], w, stop));
  }
  // install, uninstall, restore, list: a settings file that exists, one that is not JSON, dry runs, a second install
  {
    const w = world("shape-install");
    w.write(path.join(w.claude, "settings.json"), '{\n  "model": "opus"\n}\n');
    w.write(path.join(w.gemini, "settings.json"), "{ not json");
    docs.install.push(await j("install", [EXAMPLE, "--all", "--event", "pre-tool,stop"], w));
    docs.install.push(await j("install", [EXAMPLE, "--all", "--dry-run"], w));
    docs.install.push(await j("install", [EXAMPLE, "--agent", "claude-code", "--fail-closed", "--matcher", "Bash"], w));
    docs.list.push(await j("list", [], w));
    docs.uninstall.push(await j("uninstall", [EXAMPLE, "--dry-run"], w));
    docs.uninstall.push(await j("uninstall", [EXAMPLE], w));
    docs.restore.push(await j("restore", ["--all", "--dry-run"], w));
    docs.restore.push(await j("restore", ["--all"], w));
    docs.restore.push(await j("restore", ["--agent", "cursor"], w));
  }
  {
    const w = world("shape-list");
    w.write(path.join(w.claude, "settings.json"), JSON.stringify({ hooks: { PreTooluse: [{ matcher: "(", hooks: [{ type: "command", command: "nonexistent-program-xyz --a", timeout: 99999 }] }] } }));
    w.write(path.join(w.copilot, "hooks", "a.json"), JSON.stringify({ version: 2, hooks: { preToolUse: [{ type: "command", bash: "echo" }] } }));
    w.write(path.join(w.gemini, "settings.json"), JSON.stringify({ hooks: { BeforeTool: { x: 1 } } }));
    w.write(path.join(w.codex, "hooks.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo" }] }] } }));
    w.write(path.join(w.codex, "config.toml"), '[[hooks.PreToolUse]]\n[[hooks.PreToolUse.hooks]]\ntype = "command"\ncommand = "echo"\n');
    w.write(path.join(w.work, ".claude", "settings.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo" }] }] } }));
    w.write(path.join(w.cursor, "hooks.json"), "{ bad");
    docs.list.push(await j("list", [], w));
  }
  {
    const w = world("shape-bench");
    docs.bench.push(await j("bench", [EXAMPLE], w));
    const bad = w.hook("bad.mjs", 'import fs from "node:fs"; fs.readFileSync(0); process.stdout.write("garbage");');
    docs.bench.push(await j("bench", [bad, "--fail-closed", "--agent", "codex,cursor"], w));
    for (const args of [[], ["codex"], ["codex", "pre-tool"], ["cursor", "stop"]]) docs.explain.push(await j("explain", args, w));
    docs.error.push(await j("nope", [], w));
    docs.error.push(await j("install", [], w));
  }
  return docs;
}

test("the JSON documents: the keys the README lists are the keys of the documents, in the order they are printed", async () => {
  const text = section("### The JSON documents", "## How it works");
  const shapes = {};
  for (const m of text.matchAll(/^(run|install|uninstall|restore|list|bench|explain|error) {2,}(\{.*\})$/gm)) shapes[m[1]] = parseShape(m[2]);
  const docs = await documents();
  assert.deepEqual(Object.keys(shapes), Object.keys(docs), "a shape for every command");
  const errors = [];
  for (const [cmd, shape] of Object.entries(shapes)) {
    assert.ok(docs[cmd].length >= 1, cmd);
    holdTo(shape, docs[cmd], cmd, errors);
    const order = Object.keys(shape.fields);
    for (const d of docs[cmd]) assert.deepEqual(Object.keys(d).filter((k) => order.includes(k)), order.filter((k) => k in d), `${cmd}: the keys in the order of the README`);
  }
  assert.deepEqual(errors, []);
  assert.ok(docs.run.some((d) => d.failure && d.failure.kind === "input") && docs.run.some((d) => d.failure && d.failure.kind === "start") && docs.run.some((d) => d.failure && d.failure.kind === "invalid") && docs.run.some((d) => d.failure && d.failure.kind === "exit"), "the failure kinds the README lists were seen");
  for (const kind of ["input", "start", "timeout", "invalid", "exit"]) assert.ok(text.includes(`\`${kind}\``), kind);
  assert.ok(docs.install.some((d) => d.ok === false && d.results.some((r) => r.refused)), "a refusal is the command's own document with ok false");
});

// ---- the examples -------------------------------------------------------------------------------------------------------------------

const SETTINGS = '{\n  "model": "opus",\n  "permissions": { "allow": ["Bash(ls:*)"] }\n}\n';
const forward = (s) => s.replace(/\\/g, "/");

/** What a command printed, with this machine's folders turned into the names the README uses, and the stamps of backups turned into <stamp>. */
function shorten(text, w) {
  let t = text;
  for (const p of [ROOT, forward(ROOT)]) t = t.split(p).join("<everyhook>");
  for (const p of [w.home, forward(w.home)]) t = t.split(p).join("~");
  for (const p of [w.work, forward(w.work)]) t = t.split(p).join("<project>");
  return forward(t).replace(/\d{8}-\d{6}/g, "<stamp>").trimEnd();
}

function blockOf(firstLine) {
  for (const m of readme.matchAll(/```text\n([\s\S]*?)\n```/g)) if (m[1].split("\n")[0] === firstLine) return m[1].split("\n").slice(1).join("\n");
  assert.fail(`no block of the README starts with: ${firstLine}`);
}

const CLAUDE_DOC = (cwd) => JSON.stringify({ session_id: "s1", cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git push --force origin main" } });

const EXAMPLES = [
  { line: "$ everyhook install examples/block-force-push.mjs --all", args: () => ["install", EXAMPLE, "--all"] },
  { line: "$ everyhook install examples/block-force-push.mjs --agent claude-code,gemini-cli --dry-run", args: () => ["install", EXAMPLE, "--agent", "claude-code,gemini-cli", "--dry-run"] },
  { line: "$ everyhook uninstall examples/block-force-push.mjs", args: () => ["uninstall", EXAMPLE], before: [["install", EXAMPLE, "--all"]] },
  { line: "$ everyhook list --agent claude-code,codex", args: () => ["list", "--agent", "claude-code,codex"], before: [["install", EXAMPLE, "--all"]] },
  { line: "$ everyhook restore --agent claude-code --dry-run", args: () => ["restore", "--agent", "claude-code", "--dry-run"], before: [["install", EXAMPLE, "--agent", "claude-code"]] },
  { line: "$ everyhook restore --agent claude-code", args: () => ["restore", "--agent", "claude-code"], before: [["install", EXAMPLE, "--agent", "claude-code"]] },
  { line: "$ everyhook bench examples/block-force-push.mjs --agent claude-code,codex --event pre-tool", args: () => ["bench", EXAMPLE, "--agent", "claude-code,codex", "--event", "pre-tool"] },
  { line: "$ everyhook bench examples/block-force-push.mjs --agent cursor --event pre-tool", args: () => ["bench", EXAMPLE, "--agent", "cursor", "--event", "pre-tool"] },
  { line: "$ everyhook explain codex pre-tool", args: () => ["explain", "codex", "pre-tool"] },
  { line: "$ echo '{\"hook_event_name\":\"PreToolUse\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"git push --force origin main\"},...}' | everyhook run --agent claude-code --event pre-tool -- examples/block-force-push.mjs", args: () => ["run", "--agent", "claude-code", "--event", "pre-tool", "--", EXAMPLE], stdin: (w) => CLAUDE_DOC(w.work) },
];

for (const ex of EXAMPLES) {
  test(`the README shows what the code prints: ${ex.line.slice(0, 90)}`, async () => {
    const w = world("readme-ex");
    w.write(path.join(w.claude, "settings.json"), SETTINGS);
    for (const args of ex.before || []) {
      const r = await run(args, { w });
      assert.equal(r.code, 0, r.all);
    }
    const r = await run(ex.args(), { w, stdin: ex.stdin ? ex.stdin(w) : undefined });
    assert.equal(r.code, 0, r.all);
    assert.equal(shorten(r.out + r.err, w), forward(blockOf(ex.line)).replace(/\d{8}-\d{6}/g, "<stamp>").trimEnd());
  });
}

test("the settings file the README shows after install is the file install wrote", async () => {
  const w = world("readme-settings");
  w.write(path.join(w.claude, "settings.json"), SETTINGS);
  const r = await run(["install", EXAMPLE, "--agent", "claude-code"], { w });
  assert.equal(r.code, 0, r.all);
  const block = [...readme.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]).find((b) => b.includes('"model": "opus"'));
  assert.ok(block, "the README shows the settings file");
  const written = fs.readFileSync(path.join(w.claude, "settings.json"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(shorten(written, w), forward(block), "the file, with the folder of the clone as <everyhook>");
});

test("the hook the README shows runs, and does what it says", async () => {
  const w = world("readme-hook");
  const code = /```js\n(\/\/ no-rm-rf\.mjs[\s\S]*?)\n```/.exec(readme);
  assert.ok(code, "the README shows no-rm-rf.mjs");
  const hook = w.hook("no-rm-rf.mjs", `${code[1]}\n`);
  const ask = async (command) => (await run(["run", "--agent", "claude-code", "--event", "pre-tool", "--", hook], { w, stdin: JSON.stringify({ session_id: "s", cwd: w.work, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } }) })).out;
  const denied = JSON.parse(await ask("rm -rf /"));
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.match(denied.hookSpecificOutput.permissionDecisionReason, /rm -rf on \/ or ~ is blocked/);
  assert.equal(JSON.parse(await ask("rm -rf ~")).hookSpecificOutput.permissionDecision, "deny");
  assert.equal(await ask("rm -rf ./build"), "", "a folder with a name is left alone");
  assert.equal(await ask("rm -rf /tmp/x"), "");
  assert.equal(await ask("ls"), "");
  const codex = await run(["run", "--agent", "codex", "--event", "pre-tool", "--", hook], { w, stdin: JSON.stringify({ session_id: "s", cwd: w.work, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf /" } }) });
  assert.equal(JSON.parse(codex.out).hookSpecificOutput.permissionDecision, "deny");
});

// ---- the Files table ----------------------------------------------------------------------------------------------------------------

test("the Files table lists every file of bin, src and examples, every helper of test, and nothing that is not there", () => {
  const { rows } = tableAfter("\n## Files\n", "| File | What it is |");
  const listed = rows.flatMap((r) => [...r[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
  const walk = (dir) => fs.readdirSync(file(dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const actual = [...walk("bin"), ...walk("src"), ...walk("examples"), ...walk(".github/workflows"), ...fs.readdirSync(file("test")).filter((n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs")).map((n) => `test/${n}`), "test/e2e-adapter.test.mjs", "test/e2e-conformance.test.mjs", "ROADMAP.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "SUPPORT.md", "CODE_OF_CONDUCT.md"];
  for (const f of actual) assert.ok(listed.includes(f), `${f} is in the Files table`);
  for (const f of listed) if (!/[*<]/.test(f)) assert.ok(fs.existsSync(file(f)), `${f} is in the Files table and exists`);
  assert.equal(new Set(listed).size, listed.length, "no file is listed twice");
});
