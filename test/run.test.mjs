// The adapter end to end without an agent: a document of an agent in, a hook run, the agent's answer out. What a hook gets, what each kind
// of answer becomes, and what every way a hook can go wrong becomes (an exit code, a timeout, output that is not an answer).
import { world, run, runCli, ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execute } from "../src/run.mjs";
import { loadFixtures, fillPlaceholders } from "../src/fixtures.mjs";

const native = (agent, event, variant) => {
  const f = loadFixtures().map((r) => r.fixture).find((x) => x.agent === agent && x.event === event && x.variant === variant);
  return JSON.stringify(fillPlaceholders(f.stdin, { project: process.cwd(), home: process.cwd() }));
};
const CLAUDE_SHELL = native("claude-code", "pre-tool", "shell-harmless");

/** A hook that prints what the test says; `body` runs with `doc` (the document) and `fs` in scope. */
const hook = (w, name, body) => w.hook(name, `import fs from "node:fs"; const doc = JSON.parse(fs.readFileSync(0, "utf8")); ${body}`);
const exec = (w, h, over = {}) => execute({ agent: "claude-code", event: "pre-tool", hook: h, nativeText: CLAUDE_SHELL, env: w.env, ...over });

test("the hook gets the contract's document on stdin, and the variables that say who is asking", async () => {
  const w = world("run");
  const out = path.join(w.base, "seen.json");
  const h = hook(w, "seen.mjs", `fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify({ doc, env: { a: process.env.EVERYHOOK, agent: process.env.EVERYHOOK_AGENT, event: process.env.EVERYHOOK_EVENT } }));`);
  await exec(w, h);
  const seen = JSON.parse(w.read(out));
  assert.equal(seen.doc.everyhook, 1);
  assert.equal(seen.doc.agent, "claude-code");
  assert.equal(seen.doc.event, "pre-tool");
  assert.deepEqual([seen.doc.tool.name, seen.doc.tool.kind, seen.doc.tool.command], ["Bash", "shell", "echo harmless"]);
  assert.deepEqual(seen.doc.native, JSON.parse(CLAUDE_SHELL));
  assert.deepEqual(seen.env, { a: "1", agent: "claude-code", event: "pre-tool" });
});

test("the hook runs in the folder the agent works in", async () => {
  const w = world("run");
  const out = path.join(w.base, "cwd.txt");
  const h = hook(w, "cwd.mjs", `fs.writeFileSync(${JSON.stringify(out)}, process.cwd());`);
  const doc = JSON.parse(CLAUDE_SHELL);
  doc.cwd = w.work;
  await exec(w, h, { nativeText: JSON.stringify(doc) });
  assert.equal(w.read(out).toLowerCase(), w.work.toLowerCase());
});

test("no output, or exit 0 with nothing printed, is no opinion: nothing is printed for the agent", async () => {
  const w = world("run");
  for (const body of ["", "process.stdout.write('  \\n');"]) {
    const r = await exec(w, hook(w, "quiet.mjs", body));
    assert.equal(r.native.stdout, null);
    assert.equal(r.effect, "none");
    assert.deepEqual(r.answer, {});
    assert.equal(r.failure, null);
  }
});

test("each answer of the hook becomes the agent's JSON", async () => {
  const w = world("run");
  const answer = async (obj, over) => exec(w, hook(w, "answer.mjs", `process.stdout.write(JSON.stringify(${JSON.stringify(obj)}));`), over);
  const deny = await answer({ decision: "deny", reason: "No force pushes." });
  assert.deepEqual(JSON.parse(deny.native.stdout), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "No force pushes." } });
  assert.equal(deny.effect, "blocked");
  const ctx = await answer({ context: "The branch is protected." }, { event: "post-tool", nativeText: native("claude-code", "post-tool", "shell-harmless") });
  assert.deepEqual(JSON.parse(ctx.native.stdout), { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "The branch is protected." } });
  const ask = await answer({ decision: "ask", reason: "Sure?" }, { agent: "codex", nativeText: native("codex", "pre-tool", "shell-harmless") });
  assert.equal(JSON.parse(ask.native.stdout).hookSpecificOutput.permissionDecision, "deny", "Codex cannot ask");
  assert.match(ask.notes[0], /ask became deny/);
  const unknownKeys = await answer({ decision: "deny", reason: "r", mine: { anything: 1 } });
  assert.equal(unknownKeys.effect, "blocked", "a hook may carry keys of its own");
});

test("a hook that exits with a non-zero code is a deny with its stderr as the reason, whatever it printed", async () => {
  const w = world("run");
  const r = await exec(w, hook(w, "exit2.mjs", "process.stdout.write('{\"decision\":\"allow\"}'); process.stderr.write('Not on my watch.\\n'); process.exitCode = 2;"));
  assert.deepEqual(r.answer, { decision: "deny", reason: "Not on my watch." });
  assert.equal(r.effect, "blocked");
  assert.equal(JSON.parse(r.native.stdout).hookSpecificOutput.permissionDecisionReason, "Not on my watch.");
  const one = await exec(w, hook(w, "exit1.mjs", "process.exitCode = 1;"));
  assert.match(one.answer.reason, /^The hook "exit1" exited with code 1\.$/);
  assert.equal(one.effect, "blocked");
  const long = await exec(w, hook(w, "long.mjs", "process.stderr.write('x'.repeat(9000)); process.exitCode = 1;"));
  assert.ok(long.answer.reason.length <= 4003 && long.answer.reason.endsWith("..."), "a reason is cut at 4,000 characters");
});

test("at an event that cannot deny, a failing hook is a message to the person where there is one", async () => {
  const w = world("run");
  const r = await exec(w, hook(w, "boom.mjs", "process.stderr.write('boom'); process.exitCode = 1;"), { event: "session-start", nativeText: native("claude-code", "session-start", "startup") });
  assert.deepEqual(JSON.parse(r.native.stdout), { systemMessage: "boom" });
  const c = await exec(w, hook(w, "boom2.mjs", "process.exitCode = 1;"), { agent: "copilot-cli", event: "prompt", nativeText: native("copilot-cli", "prompt", "prompt") });
  assert.equal(c.native.stdout, null, "Copilot CLI has nowhere to say it");
});

test("output that is not an answer is ignored with a message to the person, or a deny with --fail-closed", async () => {
  const w = world("run");
  const cases = [
    ["text", "process.stdout.write('hello');", /not one JSON object/],
    ["broken", "process.stdout.write('{\"decision\":');", /not one JSON object/],
    ["array", "process.stdout.write('[]');", /not an object/],
    ["two documents", "process.stdout.write('{}\\n{}');", /not one JSON object/],
    ["bad decision", "process.stdout.write('{\"decision\":\"maybe\"}');", /must be allow, deny or ask/],
    ["bad reason", "process.stdout.write('{\"decision\":\"deny\",\"reason\":5}');", /"reason" must be a string/],
  ];
  for (const [name, body, why] of cases) {
    const h = hook(w, "bad.mjs", body);
    const open = await exec(w, h);
    assert.equal(open.failure.kind, "invalid", name);
    assert.match(open.failure.detail, why, name);
    assert.equal(open.effect, "message", name);
    assert.match(JSON.parse(open.native.stdout).systemMessage, /^everyhook: .*; the hook was ignored$/, name);
    const closed = await exec(w, h, { failClosed: true });
    assert.equal(closed.effect, "blocked", name);
    assert.match(JSON.parse(closed.native.stdout).hookSpecificOutput.permissionDecisionReason, /^everyhook: /, name);
  }
});

test("a hook that runs past the limit, or cannot start, is ignored with a message, or denied with --fail-closed", async () => {
  const w = world("run");
  const slow = hook(w, "slow.mjs", "setInterval(() => {}, 1000);");
  const open = await exec(w, slow, { timeoutMs: 400 });
  assert.equal(open.failure.kind, "timeout");
  assert.equal(open.failure.detail, 'the hook "slow" did not finish in 0.4 seconds');
  assert.equal(open.effect, "message");
  const closed = await exec(w, slow, { timeoutMs: 400, failClosed: true });
  assert.equal(closed.effect, "blocked");
  const missing = await exec(w, path.join(w.hooks, "nope.mjs"));
  assert.equal(missing.failure.kind, "start");
  assert.match(missing.failure.detail, /the hook does not exist/);
  assert.equal((await exec(w, path.join(w.hooks, "nope.mjs"), { failClosed: true })).effect, "blocked");
});

test("input that is not the agent's JSON is a failure that does not run the hook", async () => {
  const w = world("run");
  const marker = path.join(w.base, "ran");
  const h = hook(w, "marks.mjs", `fs.writeFileSync(${JSON.stringify(marker)}, "x");`);
  for (const text of ["", "   ", "not json", "[]", "null", "42"]) {
    const r = await exec(w, h, { nativeText: text });
    assert.equal(r.failure.kind, "input", JSON.stringify(text));
    assert.equal(r.doc, null);
  }
  assert.equal(w.exists(marker), false, "the hook never ran");
  assert.equal((await exec(w, h, { nativeText: "not json", failClosed: true })).effect, "blocked");
});

test("the agent's own event name in the document wins over the installed one for the native name, and a byte-order mark is fine", async () => {
  const w = world("run");
  const h = hook(w, "quiet.mjs", "");
  const r = await exec(w, h, { nativeText: `﻿${CLAUDE_SHELL}` });
  assert.equal(r.nativeEvent, "PreToolUse");
  assert.equal(r.failure, null);
  const c = await exec(w, h, { agent: "copilot-cli", nativeText: native("copilot-cli", "pre-tool", "shell-harmless") });
  assert.equal(c.nativeEvent, "preToolUse", "camelCase payloads have no event name: the installed one is used");
});

test("a hook given arguments after -- gets them", async () => {
  const w = world("run");
  const out = path.join(w.base, "argv.json");
  const h = w.hook("argv.mjs", `import fs from "node:fs"; fs.readFileSync(0); fs.writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));`);
  await execute({ agent: "claude-code", event: "pre-tool", hook: h, hookArgs: ["--level", "strict", "two words"], nativeText: CLAUDE_SHELL, env: w.env });
  assert.deepEqual(JSON.parse(w.read(out)), ["--level", "strict", "two words"]);
});

test("through the command line: stdout is the agent's JSON and nothing else, stderr is empty, the exit code is 0", () => {
  const w = world("cli");
  const h = hook(w, "deny.mjs", "process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'no' }));");
  const r = runCli(["run", "--agent", "claude-code", "--event", "pre-tool", "--", h], { env: w.env, cwd: w.work, input: CLAUDE_SHELL });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.equal(r.out, `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no" } })}\n`);
  const quiet = runCli(["run", "--agent", "codex", "--event", "stop", "--", hook(w, "q.mjs", "")], { env: w.env, cwd: w.work, input: native("codex", "stop", "end-turn") });
  assert.equal(quiet.out, "");
  assert.equal(quiet.code, 0);
});

test("EVERYHOOK_DEBUG logs what happened to stderr and still prints only the answer to stdout", () => {
  const w = world("cli");
  const h = hook(w, "deny.mjs", "process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'no' }));");
  const r = runCli(["run", "--agent", "claude-code", "--event", "pre-tool", "--", h], { env: { ...w.env, EVERYHOOK_DEBUG: "1" }, cwd: w.work, input: CLAUDE_SHELL });
  assert.equal(r.code, 0);
  assert.equal(r.out.trim().startsWith('{"hookSpecificOutput"'), true);
  assert.match(r.err, /^\[everyhook\] agent claude-code, event pre-tool \(native PreToolUse\)/);
  assert.match(r.err, /answer \{"decision":"deny","reason":"no"\}; effect blocked/);
  const off = runCli(["run", "--agent", "claude-code", "--event", "pre-tool", "--", h], { env: { ...w.env, EVERYHOOK_DEBUG: "0" }, cwd: w.work, input: CLAUDE_SHELL });
  assert.equal(off.err, "");
});

test("run --json prints the whole result for a person", () => {
  const w = world("cli");
  const h = hook(w, "deny.mjs", "process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'no' }));");
  const r = runCli(["run", "--agent", "claude-code", "--event", "pre-tool", "--json", "--", h], { env: w.env, cwd: w.work, input: CLAUDE_SHELL });
  const doc = JSON.parse(r.out);
  assert.deepEqual(Object.keys(doc), ["ok", "agent", "event", "nativeEvent", "document", "hook", "answer", "failure", "native", "effect", "notes"]);
  assert.equal(doc.ok, true);
  assert.equal(doc.effect, "blocked");
  assert.equal(doc.native.exit, 0);
  assert.equal(doc.hook.exit, 0);
});

test("the examples are hooks too: the repository's own example denies through run", () => {
  const w = world("cli");
  const doc = JSON.parse(native("claude-code", "pre-tool", "shell-force-push"));
  const r = runCli(["run", "--agent", "claude-code", "--event", "pre-tool", "--", path.join(ROOT, "examples", "block-force-push.mjs")], { env: w.env, cwd: w.work, input: JSON.stringify(doc) });
  assert.equal(JSON.parse(r.out).hookSpecificOutput.permissionDecision, "deny");
  void run;
});

test("at stop only exit code 2 is a deny (the agent goes back to work); another exit code is a failure that is ignored", async () => {
  const w = world("run");
  const stopDoc = native("claude-code", "stop", "end-turn");
  const two = await exec(w, hook(w, "two.mjs", "process.stderr.write('Run the tests first.'); process.exitCode = 2;"), { event: "stop", nativeText: stopDoc });
  assert.equal(two.effect, "continue");
  assert.deepEqual(JSON.parse(two.native.stdout), { decision: "block", reason: "Run the tests first." });
  const one = await exec(w, hook(w, "one.mjs", "process.stderr.write('TypeError: x is not a function\\n    at line 3'); process.exitCode = 1;"), { event: "stop", nativeText: stopDoc });
  assert.equal(one.failure.kind, "exit");
  assert.equal(one.failure.detail, 'the hook "one" exited with code 1: TypeError: x is not a function');
  assert.equal(one.effect, "message");
  assert.equal(JSON.parse(one.native.stdout).systemMessage, 'everyhook: the hook "one" exited with code 1: TypeError: x is not a function; the hook was ignored');
});

test("--fail-closed denies where a deny stops something (before a tool, on a prompt) and nowhere else", async () => {
  const w = world("run");
  const bad = hook(w, "bad.mjs", "process.stdout.write('not json');");
  for (const [event, variant, blocked] of [["pre-tool", "shell-harmless", true], ["prompt", "prompt", true], ["post-tool", "shell-harmless", false], ["stop", "end-turn", false], ["session-start", "startup", false]]) {
    const r = await exec(w, bad, { event, nativeText: native("claude-code", event, variant), failClosed: true });
    assert.equal(r.effect === "blocked", blocked, event);
    if (!blocked) assert.match(JSON.parse(r.native.stdout).systemMessage, /^everyhook: /, event);
  }
});
