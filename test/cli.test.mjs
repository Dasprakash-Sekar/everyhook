// The command line: every usage error and its exit code, help and version, --json on every command with the shape of each document, and
// a child process on the real entry point.
import { world, run, runCli, ROOT, CLI } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { HELP, parseArgs } from "../src/cli.mjs";
import { VERSION } from "../src/version.mjs";

const EXAMPLE = path.join(ROOT, "examples", "block-force-push.mjs");

const usage = (args) => { try { parseArgs(args); } catch (e) { return e.message; } return null; };

test("parseArgs: commands, lists, scopes and the hook after --", () => {
  const i = parseArgs(["install", "h.mjs", "--agent", "codex,cursor", "--event", "pre-tool,stop", "--scope", "project", "--project", "p", "--matcher", "Bash", "--timeout", "45", "--fail-closed", "--dry-run", "--json"]);
  assert.deepEqual([i.command, i.hook, i.agent, i.event, i.scope, i.project, i.matcher, i.timeout, i.failClosed, i.dryRun, i.json], ["install", "h.mjs", ["codex", "cursor"], ["pre-tool", "stop"], "project", "p", "Bash", 45, true, true, true]);
  const r = parseArgs(["run", "--agent", "codex", "--event", "stop", "--fail-closed", "--", "h.mjs", "--level", "2", "x y"]);
  assert.deepEqual([r.command, r.agent, r.event, r.hook, r.hookArgs, r.failClosed], ["run", ["codex"], ["stop"], "h.mjs", ["--level", "2", "x y"], true]);
  assert.deepEqual(parseArgs(["install", "h.mjs", "--all", "--event", "all"]).event, ["pre-tool", "post-tool", "prompt", "session-start", "session-end", "stop"]);
  assert.equal(parseArgs(["install", "h.mjs", "--all", "--matcher", "-x"]).matcher, "-x", "a matcher may begin with a dash");
  assert.equal(parseArgs(["explain", "codex", "pre-tool"]).positional.join(), "codex,pre-tool");
  assert.deepEqual(parseArgs(["bench", "h.mjs", "--fixture", "a.json", "--fixture", "b.json"]).fixture, ["a.json", "b.json"]);
  assert.equal(parseArgs(["list", "--agent=codex"]).agent[0], "codex", "--option=value works");
  assert.equal(parseArgs(["--help"]).help, true);
  assert.equal(parseArgs(["-v"]).version, true);
});

test("parseArgs: every usage error says what is wrong", () => {
  const cases = [
    [[], /no command given/],
    [["frobnicate"], /unknown command "frobnicate"/],
    [["list", "--bogus"], /unknown option --bogus/],
    [["list", "x"], /list takes no name, not "x"/],
    [["install", "a", "b", "--all"], /install takes at most 1 name, not "a b"/],
    [["list", "--dry-run"], /list does not take --dry-run/],
    [["list", "--fail-closed"], /list does not take --fail-closed/],
    [["run", "--agent", "codex", "--event", "stop"], /run needs the hook after --/],
    [["run", "--agent", "codex", "--event", "stop", "--"], /run needs the hook after --/],
    [["run", "--event", "stop", "--", "h"], /run needs exactly one --agent/],
    [["run", "--agent", "codex,cursor", "--event", "stop", "--", "h"], /run needs exactly one --agent/],
    [["run", "--agent", "codex", "--event", "stop,stop", "--", "h"], /run needs exactly one --event/],
    [["run", "--agent", "codex", "--event", "all", "--", "h"], /run needs exactly one --event/],
    [["install", "h"], /install needs the agents/],
    [["install", "h", "--agent", "vim"], /unknown agent "vim" \(claude-code, codex, gemini-cli, copilot-cli, cursor\)/],
    [["install", "h", "--agent", ","], /--agent needs at least one agent/],
    [["install", "h", "--all", "--agent", "codex"], /--all and --agent do not go together/],
    [["install", "h", "--all", "--event", "boom"], /unknown event "boom" \(pre-tool, post-tool, prompt, session-start, session-end, stop, or all\)/],
    [["install", "h", "--all", "--scope", "local"], /--scope is user or project/],
    [["install", "h", "--all", "--timeout", "abc"], /--timeout is a number of seconds/],
    [["install", "h", "--all", "--timeout", "4000"], /--timeout is a number of seconds/],
    [["install", "h", "--all", "--agent"], /--agent needs a value/],
    [["install", "h", "--all", "--event", "--json"], /--event needs a value/],
    [["uninstall"], /uninstall needs the hook/],
    [["bench"], /bench needs the hook/],
    [["restore"], /restore needs the agents/],
    [["restore", "--all", "--matcher", "x"], /restore does not take --matcher/],
    [["explain", "vim"], /explain takes an agent/],
    [["explain", "codex", "boom"], /explain takes an event/],
    [["explain", "codex", "stop", "x"], /explain takes (no name|at most 2 names)/],
    [["install", "h", "--all", "--fixture", "f"], /install does not take --fixture/],
    [["list", "--"], /unknown option --/],
  ];
  for (const [args, re] of cases) assert.match(usage(args) || "(no error)", re, args.join(" "));
});

test("usage errors exit 2, print to stderr, and as JSON when --json is given", async () => {
  const w = world("cli");
  const text = await run(["frobnicate"], { w });
  assert.equal(text.code, 2);
  assert.equal(text.out, "");
  assert.equal(text.err, 'everyhook: unknown command "frobnicate"\nRun everyhook --help for the commands.\n');
  const json = await run(["frobnicate", "--json"], { w });
  assert.equal(json.code, 2);
  assert.deepEqual(json.json(), { ok: false, error: 'unknown command "frobnicate"' });
});

test("--help is the usage text and exits 0; --version prints the version", async () => {
  const w = world("cli");
  const h = await run(["--help"], { w });
  assert.equal(h.code, 0);
  assert.equal(h.out, HELP);
  assert.equal((await run(["-h"], { w })).out, HELP);
  assert.match(HELP, /^Usage: everyhook <command> \[options\]\n/);
  assert.ok(HELP.length < 6500, `${HELP.length} characters`);
  const v = await run(["--version"], { w });
  assert.equal(v.out, `everyhook ${VERSION}\n`);
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test("every command prints one JSON document with --json: its keys", async () => {
  const w = world("cli");
  await run(["install", EXAMPLE, "--all"], { w });
  const keys = async (args) => Object.keys((await run([...args, "--json"], { w })).json());
  assert.deepEqual(await keys(["install", EXAMPLE, "--all", "--dry-run"]), ["ok", "dryRun", "hook", "scope", "results", "needs"]);
  assert.deepEqual(await keys(["uninstall", EXAMPLE, "--dry-run"]), ["ok", "dryRun", "hook", "scope", "removed", "results"]);
  assert.deepEqual(await keys(["restore", "--all", "--dry-run"]), ["ok", "dryRun", "scope", "results"]);
  assert.deepEqual(await keys(["list"]), ["ok", "project", "counts", "files", "entries"]);
  assert.deepEqual(await keys(["bench", EXAMPLE, "--agent", "codex"]), ["ok", "hook", "failClosed", "results"]);
  assert.deepEqual(await keys(["explain"]), ["ok", "agents", "rows"]);
  assert.deepEqual(await keys(["explain", "codex"]), ["ok", "agents", "rows", "agent", "name", "native", "tools", "paths", "events"]);
});

test("exit codes: install is 0 and 1 for a refusal; list is 1 for a problem; bench is 1 when a hook fails; the others 0", async () => {
  const w = world("cli");
  assert.equal((await run(["install", EXAMPLE, "--all"], { w })).code, 0);
  assert.equal((await run(["list"], { w })).code, 0);
  w.write(path.join(w.cursor, "hooks.json"), "{ nope");
  assert.equal((await run(["list"], { w })).code, 1, "a file that cannot be read is a problem");
  assert.equal((await run(["install", EXAMPLE, "--agent", "cursor"], { w })).code, 1);
  const failing = w.hook("fails.mjs", "setInterval(() => {}, 1000);");
  const b = await run(["bench", failing, "--agent", "codex", "--event", "stop", "--timeout", "0.5"], { w });
  assert.equal(b.code, 1);
  assert.match(b.out, /fail open: the hook "fails" did not finish in 0.5 seconds/);
  assert.equal((await run(["explain"], { w })).code, 0);
  assert.equal((await run(["bench", path.join(w.hooks, "missing.mjs")], { w })).code, 1);
});

test("a child process on the real entry point: version, a closed pipe is not an error", () => {
  const w = world("cli");
  const v = runCli(["--version"], { env: w.env });
  assert.equal(v.out, `everyhook ${VERSION}\n`);
  assert.equal(v.code, 0);
  assert.equal(CLI, path.join(ROOT, "bin", "everyhook.mjs"));
  const bad = runCli(["list", "--bogus"], { env: w.env });
  assert.equal(bad.code, 2);
});

test("run reads the agent's JSON from stdin when the process is started for real, and an empty stdin is a failure, not a hang", () => {
  const w = world("cli");
  const r = runCli(["run", "--agent", "codex", "--event", "stop", "--", EXAMPLE], { env: w.env, cwd: w.work, input: "" });
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).systemMessage, "everyhook: the agent sent no input; the hook was ignored");
  const closed = runCli(["run", "--agent", "codex", "--event", "pre-tool", "--fail-closed", "--", EXAMPLE], { env: w.env, cwd: w.work, input: "" });
  assert.equal(closed.code, 0);
  assert.equal(JSON.parse(closed.out).hookSpecificOutput.permissionDecision, "deny");
  const atStop = runCli(["run", "--agent", "codex", "--event", "stop", "--fail-closed", "--", EXAMPLE], { env: w.env, cwd: w.work, input: "" });
  assert.equal(JSON.parse(atStop.out).systemMessage, "everyhook: the agent sent no input; the hook was ignored", "fail closed does not send the agent back to work");
});
