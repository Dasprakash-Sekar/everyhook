// bench: a hook put to the recorded documents; what it reports for each, the exact JSON, fixtures chosen by agent, event and file, and the
// failures it names (fail open, fail closed, an exit code).
import { world, run, ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { loadFixtures } from "../src/fixtures.mjs";

const FORCE = path.join(ROOT, "examples", "block-force-push.mjs");
const bench = async (w, hook, args = []) => run(["bench", hook, ...args], { w });
const benchJson = async (w, hook, args = []) => (await bench(w, hook, ["--json", ...args])).json();

test("the text report: a header per agent with its version and how it was got, a line per document, and the exact JSON under it", async () => {
  const w = world("bench");
  const r = await bench(w, FORCE, ["--agent", "codex,cursor", "--event", "pre-tool"]);
  assert.equal(r.code, 0, r.all);
  const lines = r.out.split("\n");
  assert.equal(lines[0], "everyhook bench block-force-push.mjs");
  assert.match(r.out, /\ncodex 0\.163\.0 {2}recorded \d{4}-\d\d-\d\d, \S+ \S+, .+\n/);
  assert.match(r.out, /\n {2}pre-tool {1,}shell-force-push {1,}deny {1,}the action is blocked\n {6}\{"hookSpecificOutput":\{"hookEventName":"PreToolUse","permissionDecision":"deny"/);
  assert.match(r.out, /\n {2}pre-tool {1,}shell-harmless {1,}no opinion {1,}nothing changes\n {6}\(nothing printed\)\n/);
  assert.match(r.out, /\ncursor {2}documented, not recorded\n/);
  assert.match(r.out, /\n {2}pre-tool {1,}shell-force-push {1,}deny {1,}the action is blocked\n {6}\{"permission":"deny","agent_message":"Force-pushing the protected branch \\"main\\" is blocked/);
});

test("the JSON report: one object per document, with the answer, the effect, the notes and the exact native output", async () => {
  const w = world("bench");
  const j = await benchJson(w, FORCE, ["--agent", "gemini-cli", "--event", "pre-tool"]);
  assert.equal(j.ok, true);
  assert.deepEqual(Object.keys(j), ["ok", "hook", "failClosed", "results"]);
  const r = j.results.find((x) => x.variant === "shell-force-push");
  assert.deepEqual(Object.keys(r), ["agent", "version", "source", "os", "date", "event", "variant", "summary", "answer", "effect", "outcome", "notes", "native", "hook"]);
  assert.deepEqual([r.agent, r.version, r.source, r.event, r.answer, r.effect], ["gemini-cli", "0.64.0", "recorded", "pre-tool", "deny", "blocked"]);
  assert.deepEqual(JSON.parse(r.native.stdout), { decision: "deny", reason: 'Force-pushing the protected branch "main" is blocked. Push without --force, or ask the person to allow it.' });
  assert.equal(r.native.exit, 0);
  assert.equal(r.hook.status, "exit");
});

test("--agent and --event choose the documents; the order is the agents', then the events'", async () => {
  const w = world("bench");
  const j = await benchJson(w, FORCE, ["--agent", "cursor,claude-code", "--event", "stop,pre-tool"]);
  assert.deepEqual([...new Set(j.results.map((r) => r.agent))], ["claude-code", "cursor"]);
  const order = j.results.filter((r) => r.agent === "claude-code").map((r) => r.event);
  assert.deepEqual([...new Set(order)], ["pre-tool", "stop"]);
  const all = await benchJson(w, FORCE);
  assert.equal(all.results.length, loadFixtures().length);
});

test("--fixture puts the hook to one file of your own, with the filters still applying", async () => {
  const w = world("bench");
  const mine = path.join(w.base, "mine.json");
  const base = loadFixtures({ agents: ["codex"], events: ["pre-tool"] }).map((r) => r.fixture).find((f) => f.variant === "shell-force-push");
  fs.writeFileSync(mine, JSON.stringify({ ...base, variant: "mine", summary: "git push -f origin master", stdin: { ...base.stdin, tool_input: { command: "git push -f origin master" } } }));
  const j = await benchJson(w, FORCE, ["--fixture", mine]);
  assert.equal(j.results.length, 1);
  assert.equal(j.results[0].variant, "mine");
  assert.equal(j.results[0].answer, "deny");
  assert.match(JSON.parse(j.results[0].native.stdout).hookSpecificOutput.permissionDecisionReason, /"master"/);
  const none = await bench(w, FORCE, ["--fixture", mine, "--agent", "cursor"]);
  assert.equal(none.code, 1);
  assert.match(none.err, /no fixture matches/);
});

test("a fixture that cannot be read is reported by name, and is a finding (exit 1)", async () => {
  const w = world("bench");
  const bad = path.join(w.base, "bad.json");
  fs.writeFileSync(bad, JSON.stringify({ everyhookFixture: 1, agent: "codex", event: "nope", source: "recorded", stdin: [] }));
  const r = await bench(w, FORCE, ["--fixture", bad]);
  assert.equal(r.code, 1);
  assert.match(r.out, /bad\.json: event "nope" is not one of/);
  const notJson = path.join(w.base, "notjson.json");
  fs.writeFileSync(notJson, "{ nope");
  assert.match((await bench(w, FORCE, ["--fixture", notJson])).out, /notjson\.json: cannot read it/);
  const missing = await bench(w, FORCE, ["--fixture", path.join(w.base, "missing.json")]);
  assert.match(missing.out, /missing\.json: cannot read it/);
});

test("a hook that exits non-zero is reported as a deny with its exit code; at stop an exit code other than 2 is ignored", async () => {
  const w = world("bench");
  const h = w.hook("exits.mjs", 'import fs from "node:fs"; fs.readFileSync(0); process.stderr.write("because"); process.exitCode = 3;');
  const j = await benchJson(w, h, ["--agent", "claude-code", "--event", "pre-tool,stop"]);
  const pre = j.results.find((r) => r.event === "pre-tool" && r.variant === "shell-harmless");
  assert.deepEqual([pre.answer, pre.effect], ["exit 3 (deny)", "blocked"]);
  assert.equal(pre.hook.stderr, "because");
  const stop = j.results.find((r) => r.event === "stop");
  assert.equal(stop.answer, "exit 3 (ignored)");
  assert.match(stop.outcome, /^fail open: the hook "exits" exited with code 3: because$/);
  assert.equal(j.ok, false, "a hook that fails is a finding");
});

test("a hook that prints garbage or hangs is fail open, and fail closed with --fail-closed where a deny stops something", async () => {
  const w = world("bench");
  const garbage = w.hook("garbage.mjs", 'import fs from "node:fs"; fs.readFileSync(0); process.stdout.write("garbage");');
  const open = await benchJson(w, garbage, ["--agent", "codex", "--event", "pre-tool,stop"]);
  assert.ok(open.results.every((r) => /^fail open: /.test(r.outcome) && r.answer === "invalid output"));
  const closed = await benchJson(w, garbage, ["--agent", "codex", "--event", "pre-tool,stop", "--fail-closed"]);
  assert.ok(closed.results.filter((r) => r.event === "pre-tool").every((r) => /^fail closed: /.test(r.outcome) && r.effect === "blocked"));
  assert.ok(closed.results.filter((r) => r.event === "stop").every((r) => /^fail open: /.test(r.outcome)), "at stop a deny would send the agent back to work, so it is not used");
  assert.equal(closed.failClosed, true);
  const text = await bench(w, garbage, ["--agent", "codex", "--event", "pre-tool", "--fail-closed"]);
  assert.match(text.out, /^everyhook bench garbage\.mjs \(fail closed\)\n/);
});

test("the notes say when ask became deny, and what an agent cannot do", async () => {
  const w = world("bench");
  const asks = w.hook("asks.mjs", 'import fs from "node:fs"; fs.readFileSync(0); process.stdout.write(JSON.stringify({ decision: "ask", reason: "Sure?" }));');
  const j = await benchJson(w, asks, ["--event", "pre-tool", "--agent", "claude-code,codex,gemini-cli,copilot-cli,cursor"]);
  const by = (agent) => j.results.find((r) => r.agent === agent && r.variant === "shell-harmless");
  assert.equal(by("claude-code").effect, "asked");
  assert.equal(by("copilot-cli").effect, "asked");
  for (const a of ["codex", "gemini-cli", "cursor"]) {
    assert.equal(by(a).effect, "blocked", a);
    assert.match(by(a).outcome, /ask became deny/, a);
  }
  const beforeShell = j.results.find((r) => r.agent === "cursor" && r.variant === "shell-force-push-beforeShellExecution");
  assert.equal(beforeShell.effect, "asked", "Cursor's beforeShellExecution honours ask");
  assert.deepEqual(JSON.parse(beforeShell.native.stdout), { permission: "ask", agent_message: "Sure?" });
});

test("paths in recorded documents are filled with the project and the home of the person who runs bench", async () => {
  const w = world("bench");
  const log = path.join(w.base, "seen.jsonl");
  const spy = w.hook("spy.mjs", `import fs from "node:fs"; const d = JSON.parse(fs.readFileSync(0, "utf8")); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: d.cwd, transcript: d.transcript }) + "\\n");`);
  await run(["bench", spy, "--agent", "claude-code", "--event", "pre-tool", "--project", w.work, "--json"], { w });
  const first = JSON.parse(fs.readFileSync(log, "utf8").split("\n")[0]);
  assert.equal(first.cwd, w.work);
  assert.ok(first.transcript.startsWith(w.home), `${first.transcript} is under the home folder`);
  assert.ok(!first.transcript.includes("<home>") && !first.cwd.includes("<project>"));
});
