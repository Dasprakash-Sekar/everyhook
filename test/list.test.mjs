// list: every hook of every agent from every file each one reads, and the problems it would trip over (a program that is not there, a
// timeout in the wrong unit, a misspelt event, a Copilot file with the wrong version, a Gemini hooks entry that is not an array, a Codex layer
// with hooks in both formats, a Claude file that Copilot also reads).
import { world, run, ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { listHooks, missingProgram } from "../src/list.mjs";

const EXAMPLE = path.join(ROOT, "examples", "block-force-push.mjs");
const J = (o) => JSON.stringify(o, null, 2);
const node = `"${process.execPath.replace(/\\/g, "/")}"`;

const listJson = async (w, args = []) => (await run(["list", "--json", ...args], { w })).json();

test("nothing configured is said in one line, and is not a problem", async () => {
  const w = world("list");
  const r = await run(["list"], { w });
  assert.equal(r.code, 0);
  assert.equal(r.out, "no agent has a hooks file on this machine or in this project\n");
  const j = await listJson(w);
  assert.deepEqual(j.counts, { files: 0, entries: 0, ours: 0, problems: 0 });
});

test("hooks of every agent are listed with their event, matcher, command and timeout; the ones everyhook wrote are marked", async () => {
  const w = world("list");
  await run(["install", EXAMPLE, "--all", "--event", "pre-tool", "--matcher", "Bash"], { w });
  w.write(path.join(w.claude, "settings.json"), J({ ...w.readJson(path.join(w.claude, "settings.json")), hooks: { ...w.readJson(path.join(w.claude, "settings.json")).hooks, Stop: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  const j = await listJson(w);
  assert.equal(j.counts.entries, 6);
  assert.equal(j.counts.ours, 5);
  assert.equal(j.ok, true, JSON.stringify(j.entries.map((e) => e.problems)));
  const by = Object.fromEntries(j.entries.filter((e) => e.ours).map((e) => [e.agent, e]));
  assert.deepEqual(Object.keys(by), ["claude-code", "codex", "gemini-cli", "copilot-cli", "cursor"]);
  assert.deepEqual([by["claude-code"].event, by["claude-code"].contractEvent, by["claude-code"].matcher, by["claude-code"].timeout], ["PreToolUse", "pre-tool", "Bash", { value: 30, unit: "s", seconds: 30 }]);
  assert.deepEqual(by["gemini-cli"].timeout, { value: 30000, unit: "ms", seconds: 30 });
  assert.equal(by["copilot-cli"].matcher, "Bash");
  assert.equal(path.basename(by.cursor.hook), "block-force-push.mjs");
  const mine = j.entries.find((e) => !e.ours);
  assert.equal(mine.event, "Stop");
  const text = (await run(["list"], { w })).out;
  assert.match(text, /^claude-code\n  user  .*settings\.json\n    PreToolUse +matcher Bash +timeout 30 s +\[everyhook\]/m);
  assert.match(text, /6 hooks in 5 files, 5 by everyhook; 0 problems/);
});

test("the project's files are read too (--project), and so is a Claude project file", async () => {
  const w = world("list");
  await run(["install", EXAMPLE, "--agent", "claude-code,cursor", "--scope", "project", "--project", w.work], { w });
  const j = await listJson(w, ["--project", w.work]);
  assert.deepEqual(j.entries.map((e) => [e.agent, e.scope]), [["claude-code", "project"], ["cursor", "project"]]);
  const none = await listJson(w, ["--project", path.join(w.base, "elsewhere")]);
  assert.equal(none.entries.length, 0);
});

test("a hook of Claude Code in the project's .claude/settings.json is run by Copilot CLI too, and list says so", async () => {
  const w = world("list");
  w.write(path.join(w.work, ".claude", "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { Stop: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w, ["--project", w.work]);
  const project = j.entries.find((e) => e.scope === "project");
  assert.deepEqual(project.alsoRunBy, ["copilot-cli"]);
  assert.ok(project.problems.some((p) => /Copilot CLI also reads this file and will run this hook/.test(p)));
  assert.deepEqual(j.entries.find((e) => e.scope === "user").alsoRunBy, [], "the user file is not read by Copilot CLI");
  assert.equal(j.entries.filter((e) => e.agent === "copilot-cli").length, 0, "listed once, under the agent whose file it is");
});

test("a program that is not there is a problem, for the command and for the script an interpreter is given", async () => {
  const w = world("list");
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [
    { type: "command", command: "definitely-not-a-program --x" },
    { type: "command", command: `${node} ${path.join(w.base, "gone.mjs").replace(/\\/g, "/")}` },
    { type: "command", command: path.join(w.base, "gone.sh") },
    { type: "command", command: `${node} -e 0` },
  ] }] } }));
  const j = await listJson(w);
  const problems = j.entries.map((e) => e.problems);
  assert.match(problems[0][0], /^the program is not on PATH: definitely-not-a-program$/);
  assert.match(problems[1][0], /^the script does not exist: /);
  assert.match(problems[2][0], /^the program does not exist: /);
  assert.deepEqual(problems[3], []);
  assert.equal(j.ok, false);
  assert.equal((await run(["list"], { w })).code, 1, "a problem is exit 1");
});

test("only simple commands are checked: pipes, variables, relative paths and shell words are left alone", () => {
  const ctx = { env: { PATH: "" }, platform: process.platform };
  for (const line of ["cd x && y", "a | b", "$HOME/hooks/x.sh", "~/x.sh", "./hooks/x.sh", "hooks\\x.cmd", "FOO=1 bar", "echo hi", "& 'C:\\x\\y.ps1'", "%USERPROFILE%\\x.cmd", "", null]) assert.equal(missingProgram(line, ctx), null, String(line));
  assert.match(missingProgram("nope-program", ctx), /not on PATH/);
});

test("an event name that the agent does not document is a problem, with the right spelling when it is a case slip", async () => {
  const w = world("list");
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { pretooluse: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }], Nonsense: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w);
  assert.match(j.entries[0].problems[0], /^pretooluse is not an event name Claude Code documents \(did you mean PreToolUse\? names are case sensitive\); it is ignored$/);
  assert.match(j.entries[1].problems[0], /^Nonsense is not an event name Claude Code documents; it is ignored$/);
});

test("a timeout in the wrong unit is a problem: 30 for Gemini CLI is 30 milliseconds, 30000 for the others is hours", async () => {
  const w = world("list");
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: { BeforeTool: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 30 }] }] } }));
  w.write(path.join(w.claude, "settings.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 30000 }] }] } }));
  const j = await listJson(w);
  assert.match(j.entries.find((e) => e.agent === "gemini-cli").problems[0], /timeout 30 is read as milliseconds by Gemini CLI: 30 ms; did you mean 30000\?/);
  assert.match(j.entries.find((e) => e.agent === "claude-code").problems[0], /timeout 30000 is read as seconds by Claude Code: more than an hour; did you mean 30\?/);
});

test("a Gemini hooks entry that is not an array is a problem of the file, with what Gemini CLI does about it", async () => {
  const w = world("list");
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: { enabled: true, BeforeTool: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w);
  const f = j.files.find((x) => x.agent === "gemini-cli");
  assert.deepEqual(f.problems, ['hooks.enabled is not an array (it is boolean): Gemini CLI rejects the settings ("Expected array")']);
  assert.equal(j.entries.length, 1);
});

test("a Gemini hook of another type than command is a problem", async () => {
  const w = world("list");
  w.write(path.join(w.gemini, "settings.json"), J({ hooks: { BeforeTool: [{ hooks: [{ type: "http", url: "https://example.com" }] }] } }));
  const j = await listJson(w);
  assert.match(j.entries[0].problems[0], /supports only hooks of type "command", not "http"/);
});

test("a Copilot hooks file with a version other than 1 is a problem, and its folder is read as a whole", async () => {
  const w = world("list");
  w.write(path.join(w.copilot, "hooks", "a.json"), J({ version: 2, hooks: { preToolUse: [{ type: "command", bash: `${node} -e 0`, timeoutSec: 5 }] } }));
  w.write(path.join(w.copilot, "hooks", "b.json"), J({ version: 1, hooks: { postToolUse: [{ type: "command", powershell: `${node} -e 0` }] } }));
  w.write(path.join(w.copilot, "hooks", "notes.txt"), "not a hooks file");
  const j = await listJson(w);
  assert.deepEqual(j.entries.map((e) => [path.basename(e.file), e.event]), [["a.json", "preToolUse"], ["b.json", "postToolUse"]]);
  const a = j.files.find((f) => path.basename(f.file) === "a.json");
  assert.match(a.problems[0], /^"version" is 2: Copilot CLI hook files need "version": 1/);
  assert.deepEqual(j.files.find((f) => path.basename(f.file) === "b.json").problems, []);
});

test("Codex: hooks in hooks.json and in config.toml of one layer are a problem for both files; the TOML hooks are listed", async () => {
  const w = world("list");
  w.write(path.join(w.codex, "hooks.json"), J({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: `${node} -e 0`, timeout: 5 }] }] } }));
  w.write(path.join(w.codex, "config.toml"), `model = "gpt-5.5"\n\n[[hooks.Stop]]\n[[hooks.Stop.hooks]]\ntype = "command"\ncommand = '${node} -e 0'\ntimeout = 5\n`);
  const j = await listJson(w);
  assert.deepEqual(j.entries.map((e) => [path.basename(e.file), e.event]), [["hooks.json", "PreToolUse"], ["config.toml", "Stop"]]);
  for (const f of j.files.filter((x) => x.agent === "codex" && x.status === "found")) assert.match(f.problems.join(" "), /defines hooks in hooks\.json and in config\.toml: Codex merges them and warns at startup; keep one/, f.file);
  // one format alone is fine
  fs.rmSync(path.join(w.codex, "config.toml"));
  const one = await listJson(w);
  assert.equal(one.files.find((x) => x.agent === "codex" && x.status === "found").problems.length, 0);
});

test("a config.toml that is not TOML the reader knows is said, not guessed at", async () => {
  const w = world("list");
  w.write(path.join(w.codex, "config.toml"), "this is = = not toml\n");
  const j = await listJson(w);
  const f = j.files.find((x) => x.agent === "codex");
  assert.equal(f.status, "unreadable");
  assert.match(f.problems[0], /^config\.toml is not TOML this reader knows \(line 1: .*\); its hooks are not listed$/);
});

test("a file that is not JSON is a problem of the file, and the other files are still listed", async () => {
  const w = world("list");
  w.write(path.join(w.claude, "settings.json"), "{ nope");
  w.write(path.join(w.cursor, "hooks.json"), J({ version: 1, hooks: { stop: [{ command: `${node} -e 0` }] } }));
  const j = await listJson(w);
  assert.equal(j.files.find((f) => f.agent === "claude-code").status, "unreadable");
  assert.match(j.files.find((f) => f.agent === "claude-code").problems[0], /^not valid JSON: .*; Claude Code cannot read it$/);
  assert.equal(j.entries.length, 1);
});

test("an everyhook entry whose everyhook or hook has gone is a problem", async () => {
  const w = world("list");
  const hook = path.join(w.hooks, "mine.mjs");
  fs.copyFileSync(EXAMPLE, hook);
  await run(["install", hook, "--agent", "claude-code"], { w });
  fs.rmSync(hook);
  const j = await listJson(w);
  assert.ok(j.entries[0].problems.some((p) => /^the hook does not exist: /.test(p)), JSON.stringify(j.entries[0].problems));
});

test("the administrators' files are read: managed settings, the system settings of Gemini, policy files of Copilot, enterprise hooks of Cursor", async () => {
  const w = world("list");
  const sys = path.join(w.home, ".no-system-files");
  w.write(path.join(sys, "claude", "managed-settings.json"), J({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  w.write(path.join(sys, "copilot", "policy.d", "10-audit.json"), J({ version: 1, hooks: { sessionStart: [{ type: "command", bash: `${node} -e 0` }] } }));
  w.write(path.join(sys, "cursor", "hooks.json"), J({ version: 1, hooks: { sessionStart: [{ command: `${node} -e 0` }] } }));
  w.write(path.join(sys, "gemini", "settings.json"), J({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `${node} -e 0` }] }] } }));
  const j = await listJson(w);
  assert.deepEqual(j.entries.map((e) => [e.agent, e.scope]).sort(), [["claude-code", "managed"], ["copilot-cli", "managed"], ["cursor", "managed"], ["gemini-cli", "managed"]]);
});

test("--agent narrows the list", async () => {
  const w = world("list");
  await run(["install", EXAMPLE, "--all"], { w });
  const j = await listJson(w, ["--agent", "codex,cursor"]);
  assert.deepEqual([...new Set(j.entries.map((e) => e.agent))], ["codex", "cursor"]);
  assert.equal(listHooks({ env: w.env, platform: process.platform, project: w.work, agents: ["gemini-cli"] }).entries.length, 1);
});
