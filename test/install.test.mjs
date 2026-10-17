// install, uninstall and restore against throwaway homes: what is written for each agent, that existing content is not touched, that a
// second install changes nothing, that a file that cannot be read is left alone, and that uninstall gives the bytes back.
import { world, run, snapshot, ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseRun } from "../src/cmdline.mjs";
import { BACKUP_MARK, listBackups } from "../src/write.mjs";

const EXAMPLE = path.join(ROOT, "examples", "block-force-push.mjs");
const EVERYHOOK = path.join(ROOT, "bin", "everyhook.mjs");
const slash = (p) => p.replace(/\\/g, "/");
const files = (w) => ({
  "claude-code": path.join(w.claude, "settings.json"),
  codex: path.join(w.codex, "hooks.json"),
  "gemini-cli": path.join(w.gemini, "settings.json"),
  "copilot-cli": path.join(w.copilot, "hooks", "everyhook.json"),
  cursor: path.join(w.cursor, "hooks.json"),
});
const noBackups = (snap) => Object.fromEntries(Object.entries(snap).filter(([k]) => !k.includes(BACKUP_MARK)));

test("install --all writes each agent's file in its own shape: names, timeout unit, command or exec + args", async () => {
  const w = world("inst");
  const r = await run(["install", EXAMPLE, "--all", "--event", "pre-tool,stop", "--timeout", "40"], { w });
  assert.equal(r.code, 0, r.all);
  const f = files(w);
  const expectLine = (agent, event) => `node "${slash(EVERYHOOK)}" run --agent ${agent} --event ${event} --timeout 38 -- "${slash(EXAMPLE)}"`;
  const claude = w.readJson(f["claude-code"]);
  assert.deepEqual(claude.hooks.PreToolUse, [{ hooks: [{ type: "command", command: expectLine("claude-code", "pre-tool"), timeout: 40 }] }]);
  assert.deepEqual(claude.hooks.Stop, [{ hooks: [{ type: "command", command: expectLine("claude-code", "stop"), timeout: 40 }] }]);
  assert.deepEqual(w.readJson(f.codex).hooks.PreToolUse, [{ hooks: [{ type: "command", command: expectLine("codex", "pre-tool"), timeout: 40 }] }]);
  assert.deepEqual(Object.keys(w.readJson(f.codex).hooks), ["PreToolUse", "Stop"]);
  const gem = w.readJson(f["gemini-cli"]);
  assert.deepEqual(Object.keys(gem.hooks), ["BeforeTool", "AfterAgent"]);
  assert.deepEqual(gem.hooks.BeforeTool[0].hooks[0], { type: "command", name: "everyhook block-force-push.mjs", command: expectLine("gemini-cli", "pre-tool"), timeout: 40000 });
  const cop = w.readJson(f["copilot-cli"]);
  assert.equal(cop.version, 1);
  assert.deepEqual(Object.keys(cop.hooks), ["preToolUse", "agentStop"]);
  assert.deepEqual(cop.hooks.preToolUse, [{ type: "command", exec: "node", args: [slash(EVERYHOOK), "run", "--agent", "copilot-cli", "--event", "pre-tool", "--timeout", "38", "--", slash(EXAMPLE)], timeoutSec: 40 }]);
  const cur = w.readJson(f.cursor);
  assert.equal(cur.version, 1);
  assert.deepEqual(Object.keys(cur.hooks), ["preToolUse", "stop"]);
  assert.deepEqual(cur.hooks.preToolUse, [{ command: expectLine("cursor", "pre-tool"), timeout: 40 }]);
});

test("the report says what each agent will do, and what still needs the person", async () => {
  const w = world("inst");
  const r = await run(["install", EXAMPLE, "--all"], { w });
  assert.match(r.out, /^everyhook install block-force-push\.mjs \(user scope\)/);
  assert.match(r.out, /claude-code\s+created\s+.*settings\.json\n\s+pre-tool\s+PreToolUse\s+deny blocks, ask asks, allow approves, context, message/);
  assert.match(r.out, /codex\s+created[\s\S]*pre-tool\s+PreToolUse\s+deny blocks, ask becomes deny, context, message/);
  assert.match(r.out, /gemini-cli\s+created[\s\S]*BeforeTool\s+deny blocks, ask becomes deny, message/);
  assert.match(r.out, /cursor\s+created[\s\S]*preToolUse\s+deny blocks, ask becomes deny, allow approves, message/);
  assert.match(r.out, /Still to do:\n\s+claude-code: Claude Code reads its settings when a session starts/);
  assert.match(r.out, /codex: Codex runs a hook only after you trust it: open \/hooks in Codex/);
  assert.match(r.out, /--dangerously-bypass-hook-trust/);
  const j = (await run(["install", EXAMPLE, "--all", "--json", "--dry-run"], { w })).json();
  assert.deepEqual(Object.keys(j), ["ok", "dryRun", "hook", "scope", "results", "needs"]);
  assert.equal(j.dryRun, true);
  assert.deepEqual(j.results.map((x) => x.agent), ["claude-code", "codex", "gemini-cli", "copilot-cli", "cursor"]);
  assert.deepEqual(Object.keys(j.results[0]), ["agent", "scope", "file", "action", "backup", "refused", "entries", "notes"]);
  assert.deepEqual(Object.keys(j.results[0].entries[0]), ["event", "native", "matcher", "timeout", "can"]);
});

test("a second install changes nothing: no new backup, the same bytes, and the report says so", async () => {
  const w = world("inst");
  await run(["install", EXAMPLE, "--all"], { w });
  const before = snapshot(w.home);
  const again = await run(["install", EXAMPLE, "--all"], { w });
  assert.equal(again.code, 0);
  assert.equal((again.out.match(/unchanged \(already installed\)/g) || []).length, 5);
  assert.deepEqual(snapshot(w.home), before);
});

test("a changed option replaces the entries instead of adding more", async () => {
  const w = world("inst");
  await run(["install", EXAMPLE, "--agent", "claude-code,cursor", "--event", "pre-tool"], { w });
  const r = await run(["install", EXAMPLE, "--agent", "claude-code,cursor", "--event", "pre-tool", "--timeout", "90", "--matcher", "Bash", "--fail-closed"], { w });
  assert.match(r.out, /claude-code\s+updated/);
  const claude = w.readJson(files(w)["claude-code"]);
  assert.equal(claude.hooks.PreToolUse.length, 1);
  assert.deepEqual(claude.hooks.PreToolUse[0], { matcher: "Bash", hooks: [{ type: "command", command: `node "${slash(EVERYHOOK)}" run --agent claude-code --event pre-tool --fail-closed --timeout 88 -- "${slash(EXAMPLE)}"`, timeout: 90, onFailure: "block" }] });
  const cursor = w.readJson(files(w).cursor);
  assert.deepEqual(cursor.hooks.preToolUse, [{ command: `node "${slash(EVERYHOOK)}" run --agent cursor --event pre-tool --fail-closed --timeout 88 -- "${slash(EXAMPLE)}"`, timeout: 90, failClosed: true, matcher: "Bash" }]);
});

test("--matcher goes where each agent keeps it, for tool events only", async () => {
  const w = world("inst");
  const r = await run(["install", EXAMPLE, "--all", "--event", "pre-tool,stop", "--matcher", "Bash|shell"], { w });
  assert.match(r.out, /note: --matcher is for tool events: ignored for stop/);
  const f = files(w);
  assert.equal(w.readJson(f["claude-code"]).hooks.PreToolUse[0].matcher, "Bash|shell");
  assert.equal(w.readJson(f["claude-code"]).hooks.Stop[0].matcher, undefined);
  assert.equal(w.readJson(f.codex).hooks.PreToolUse[0].matcher, "Bash|shell");
  assert.equal(w.readJson(f["gemini-cli"]).hooks.BeforeTool[0].matcher, "Bash|shell");
  assert.equal(w.readJson(f["copilot-cli"]).hooks.preToolUse[0].matcher, "Bash|shell");
  assert.equal(w.readJson(f["copilot-cli"]).hooks.agentStop[0].matcher, undefined);
  assert.equal(w.readJson(f.cursor).hooks.preToolUse[0].matcher, "Bash|shell");
});

test("the rest of an existing file is not touched: keys, order, indentation, a CRLF layout", async () => {
  const w = world("inst");
  const f = files(w);
  const claudeText = '{\r\n\t"model": "opus",\r\n\t"permissions": { "allow": ["Bash(ls:*)"] },\r\n\t"env": { "A": "1" }\r\n}\r\n';
  w.write(f["claude-code"], claudeText);
  const geminiText = '{\n    "security": { "auth": { "selectedType": "gemini-api-key" } },\n    "privacy": { "usageStatisticsEnabled": false }\n}';
  w.write(f["gemini-cli"], geminiText);
  const r = await run(["install", EXAMPLE, "--all"], { w });
  assert.equal(r.code, 0, r.all);
  const claude = w.read(f["claude-code"]);
  assert.ok(claude.startsWith(claudeText.slice(0, claudeText.indexOf('"env"'))), "the first lines are as they were");
  assert.ok(claude.includes('\t"model": "opus",\r\n'));
  assert.ok(/\r\n\t"hooks": \{\r\n\t\t"PreToolUse"/.test(claude), "the new key follows the file's tabs and CRLF");
  assert.ok(!/[^\r]\n/.test(claude), "no bare line feed was added to a CRLF file");
  assert.deepEqual(JSON.parse(claude).permissions, { allow: ["Bash(ls:*)"] });
  const gem = w.read(f["gemini-cli"]);
  assert.ok(gem.startsWith('{\n    "security": { "auth": { "selectedType": "gemini-api-key" } },\n    "privacy": { "usageStatisticsEnabled": false },\n    "hooks": {'));
  assert.ok(!gem.endsWith("\n"), "no final newline was added to a file without one");
});

test("a backup of every file that changes, next to it, with the bytes it had; a new file has none", async () => {
  const w = world("inst");
  const f = files(w);
  const original = '{\n  "model": "opus"\n}\n';
  w.write(f["claude-code"], original);
  await run(["install", EXAMPLE, "--agent", "claude-code,codex"], { w });
  const backups = listBackups(f["claude-code"]);
  assert.equal(backups.length, 1);
  assert.match(backups[0], /^settings\.json\.bak-everyhook-20261017-\d{6}$/);
  assert.equal(w.read(path.join(w.claude, backups[0])), original);
  assert.deepEqual(listBackups(f.codex), [], "the Codex file did not exist");
});

test("a file that cannot be read, or that has a hooks key of the wrong shape, is left alone, and the other agents still get theirs", async () => {
  const w = world("inst");
  const f = files(w);
  w.write(f["claude-code"], "{ \"model\": ,}");
  w.write(f["gemini-cli"], JSON.stringify({ hooks: { BeforeTool: true } }));
  w.write(f.codex, "{ \"hooks\": [] }");
  w.write(f.cursor, "// a comment\n{}");
  const before = snapshot(w.home);
  const r = await run(["install", EXAMPLE, "--all"], { w });
  assert.equal(r.code, 1);
  assert.match(r.out, /claude-code\s+refused[\s\S]*is not valid JSON.*everyhook leaves a file it cannot read alone/);
  assert.match(r.out, /gemini-cli\s+refused[\s\S]*has a problem in its hooks \(hooks\.BeforeTool is not an array \(it is boolean\)\)/);
  assert.match(r.out, /codex\s+refused[\s\S]*"hooks" is not an object/);
  assert.match(r.out, /cursor\s+refused[\s\S]*is not valid JSON/);
  assert.match(r.out, /copilot-cli\s+created/);
  const after = snapshot(w.home);
  for (const agent of ["claude-code", "gemini-cli", "codex", "cursor"]) {
    const rel = path.relative(w.home, f[agent]).split(path.sep).join("/");
    assert.equal(after[rel], before[rel], `${agent}: the bytes are the same`);
  }
  assert.deepEqual(Object.keys(after).filter((k) => k.includes(BACKUP_MARK)), [], "no backup of a file that was not written");
  const j = (await run(["install", EXAMPLE, "--all", "--json", "--dry-run"], { w })).json();
  assert.equal(j.ok, false);
  assert.deepEqual(j.results.map((x) => [x.agent, x.action]), [["claude-code", "refused"], ["codex", "refused"], ["gemini-cli", "refused"], ["copilot-cli", "unchanged"], ["cursor", "refused"]]);
});

test("--dry-run writes nothing, not even a backup, and says what would happen", async () => {
  const w = world("inst");
  w.write(files(w)["claude-code"], '{\n  "model": "opus"\n}\n');
  const before = snapshot(w.home);
  const r = await run(["install", EXAMPLE, "--all", "--dry-run"], { w });
  assert.equal(r.code, 0);
  assert.match(r.out, /dry run: nothing is written/);
  assert.match(r.out, /claude-code\s+would update/);
  assert.match(r.out, /codex\s+would create/);
  assert.deepEqual(snapshot(w.home), before);
});

test("paths with spaces: everyhook and the hook may live in folders with spaces, in the line and in exec + args", async () => {
  const w = world("inst space");
  const copy = path.join(w.base, "every hook");
  for (const d of ["bin", "src"]) fs.cpSync(path.join(ROOT, d), path.join(copy, d), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(copy, "package.json"));
  const hook = path.join(w.base, "my hooks", "block force push.mjs");
  fs.mkdirSync(path.dirname(hook), { recursive: true });
  fs.copyFileSync(EXAMPLE, hook);
  const viaCopy = path.join(copy, "bin", "everyhook.mjs");
  const out = spawnSync(process.execPath, [viaCopy, "install", hook, "--all"], { env: w.env, cwd: w.work, encoding: "utf8", windowsHide: true });
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const f = files(w);
  const line = w.readJson(f["claude-code"]).hooks.PreToolUse[0].hooks[0].command;
  assert.ok(line.includes(`"${slash(viaCopy)}"`) && line.endsWith(`-- "${slash(hook)}"`), line);
  assert.deepEqual(parseRun(line), { everyhook: slash(viaCopy), agent: "claude-code", event: "pre-tool", hook: slash(hook), failClosed: false, timeout: 28 });
  const args = w.readJson(f["copilot-cli"]).hooks.preToolUse[0].args;
  assert.equal(args[0], slash(viaCopy));
  assert.equal(args.at(-1), slash(hook));
  // and the line runs in the shell of the machine, with the spaces in it
  const run1 = spawnSync(line.replace(/ -- .*$/, " --help"), { shell: true, encoding: "utf8", windowsHide: true });
  assert.equal(run1.status, 0, run1.stderr);
  assert.match(run1.stdout, /^Usage: everyhook <command>/);
});

test("a path with a character that shells quote differently is refused, with the reason, and nothing is written", async () => {
  const w = world("inst");
  const hook = path.join(w.hooks, "dollar$hook.mjs");
  fs.copyFileSync(EXAMPLE, hook);
  const before = snapshot(w.home);
  const r = await run(["install", hook, "--agent", "claude-code,copilot-cli"], { w });
  assert.equal(r.code, 1);
  assert.match(r.out, /the path of the hook contains a character that shells quote differently/);
  assert.deepEqual(snapshot(w.home), before);
});

test("project scope writes the project's files, and says the entries hold paths of this machine", async () => {
  const w = world("inst");
  const r = await run(["install", EXAMPLE, "--all", "--scope", "project", "--project", w.work], { w });
  assert.equal(r.code, 0, r.all);
  for (const rel of [".claude/settings.json", ".codex/hooks.json", ".gemini/settings.json", ".github/hooks/everyhook.json", ".cursor/hooks.json"]) assert.ok(w.exists(path.join(w.work, rel)), rel);
  assert.deepEqual(fs.readdirSync(w.home), [], "nothing in the home folder");
  assert.match(r.out, /project scope/);
  assert.match(r.out, /gemini-cli: Gemini CLI fingerprints project hooks/);
  assert.match(r.out, /copilot-cli: Copilot CLI loads project hooks only in a trusted folder/);
  assert.match(r.out, /The entries hold absolute paths of this machine/);
});

test("several hooks live together, and uninstall takes out only the one named", async () => {
  const w = world("inst");
  const other = path.join(ROOT, "examples", "protect-env-files.mjs");
  await run(["install", EXAMPLE, "--all", "--event", "pre-tool"], { w });
  await run(["install", other, "--all", "--event", "pre-tool,post-tool"], { w });
  const f = files(w);
  assert.equal(w.readJson(f["claude-code"]).hooks.PreToolUse.length, 2);
  assert.equal(w.readJson(f["copilot-cli"]).hooks.preToolUse.length, 2);
  const r = await run(["uninstall", EXAMPLE], { w });
  assert.equal(r.code, 0);
  assert.match(r.out, /claude-code\s+removed 1 entry/);
  const claude = w.readJson(f["claude-code"]);
  assert.equal(claude.hooks.PreToolUse.length, 1);
  assert.ok(claude.hooks.PreToolUse[0].hooks[0].command.endsWith(`"${slash(other)}"`));
  assert.ok(claude.hooks.PostToolUse);
  const listed = (await run(["list", "--agent", "claude-code", "--json"], { w })).json();
  assert.deepEqual([...new Set(listed.entries.map((e) => path.basename(e.hook)))], ["protect-env-files.mjs"], "list shows only the hook that is left");
});

test("uninstall --event takes out only those events of the hook", async () => {
  const w = world("inst");
  await run(["install", EXAMPLE, "--agent", "claude-code", "--event", "pre-tool,post-tool,stop"], { w });
  const r = await run(["uninstall", EXAMPLE, "--agent", "claude-code", "--event", "post-tool,stop"], { w });
  assert.match(r.out, /removed 2 entries/);
  assert.deepEqual(Object.keys(w.readJson(files(w)["claude-code"]).hooks), ["PreToolUse"]);
});

test("uninstall with nothing installed says so and writes nothing", async () => {
  const w = world("inst");
  w.write(files(w)["claude-code"], '{"model":"x"}');
  const before = snapshot(w.home);
  const r = await run(["uninstall", EXAMPLE], { w });
  assert.equal(r.code, 0);
  assert.equal((r.out.match(/nothing to remove/g) || []).length, 5);
  assert.deepEqual(snapshot(w.home), before);
});

// ---- uninstall gives the bytes back ----------------------------------------------------------------------------------------------

const PRE_STATES = {
  "no file": null,
  "an empty object": "{}",
  "an empty object and a final newline": "{}\n",
  "a typical file": '{\n  "model": "opus",\n  "permissions": {\n    "allow": ["Bash(ls:*)"],\n    "deny": []\n  }\n}\n',
  "four spaces and no final newline": '{\n    "a": 1,\n    "b": { "c": [1, 2, 3] }\n}',
  "tabs and CRLF": '{\r\n\t"a": 1,\r\n\t"b": 2\r\n}\r\n',
  "everything on one line": '{"a":1,"b":[1,2],"c":{"d":null}}',
  "a byte-order mark": '﻿{\n  "a": 1\n}\n',
  "hooks of its own": '{\n  "hooks": {\n    "Stop": [\n      {\n        "hooks": [\n          { "type": "command", "command": "echo mine" }\n        ]\n      }\n    ]\n  }\n}\n',
  "escapes and unicode": '{\n  "text": "caf\\u00e9 \\"quoted\\" \\\\ \\/",\n  "n": 1.50,\n  "e": 1E3\n}\n',
};

for (const [name, text] of Object.entries(PRE_STATES)) {
  test(`install then uninstall gives back the same bytes: ${name}`, async () => {
    const w = world("rt");
    const f = files(w);
    if (text !== null) for (const p of Object.values(f)) w.write(p, text);
    const before = snapshot(w.home);
    const i = await run(["install", EXAMPLE, "--all", "--event", "pre-tool,post-tool,prompt,session-start,session-end,stop"], { w });
    assert.equal(i.code, 0, i.all);
    const u = await run(["uninstall", EXAMPLE], { w });
    assert.equal(u.code, 0, u.all);
    assert.deepEqual(noBackups(snapshot(w.home)), before);
  });
}

test("uninstall keeps the changes someone else made to the file since install, and takes only the entries out", async () => {
  const w = world("rt");
  const f = files(w);
  w.write(f["claude-code"], '{\n  "model": "opus"\n}\n');
  await run(["install", EXAMPLE, "--agent", "claude-code", "--event", "pre-tool"], { w });
  const edited = w.read(f["claude-code"]).replace('"model": "opus"', '"model": "sonnet"');
  w.write(f["claude-code"], edited);
  const u = await run(["uninstall", EXAMPLE, "--agent", "claude-code"], { w });
  assert.equal(u.code, 0);
  assert.equal(w.read(f["claude-code"]), '{\n  "model": "sonnet"\n}\n');
  assert.doesNotMatch(u.out, /back to its bytes/);
});

test("uninstall of the second of two installs restores the file as it was after the first", async () => {
  const w = world("rt");
  const f = files(w);
  const other = path.join(ROOT, "examples", "log-tool-calls.mjs");
  w.write(f["claude-code"], '{\n  "model": "opus"\n}\n');
  await run(["install", EXAMPLE, "--agent", "claude-code"], { w });
  const afterFirst = w.read(f["claude-code"]);
  await run(["install", other, "--agent", "claude-code", "--event", "all"], { w });
  await run(["uninstall", other, "--agent", "claude-code"], { w });
  assert.equal(w.read(f["claude-code"]), afterFirst);
  await run(["uninstall", EXAMPLE, "--agent", "claude-code"], { w });
  assert.equal(w.read(f["claude-code"]), '{\n  "model": "opus"\n}\n');
});

test("a file that install made and uninstall empties is deleted; a backup of it stays", async () => {
  const w = world("rt");
  const f = files(w);
  await run(["install", EXAMPLE, "--agent", "copilot-cli,cursor"], { w });
  const u = await run(["uninstall", EXAMPLE, "--agent", "copilot-cli,cursor"], { w });
  assert.match(u.out, /copilot-cli\s+deleted the file/);
  assert.equal(w.exists(f["copilot-cli"]), false);
  assert.equal(w.exists(f.cursor), false);
  assert.equal(listBackups(f.cursor).length, 1, "what was deleted can be restored");
});

test("uninstall --dry-run writes nothing", async () => {
  const w = world("rt");
  await run(["install", EXAMPLE, "--all"], { w });
  const before = snapshot(w.home);
  const u = await run(["uninstall", EXAMPLE, "--dry-run"], { w });
  assert.match(u.out, /dry run/);
  assert.match(u.out, /would (remove|delete)/);
  assert.deepEqual(snapshot(w.home), before);
});

test("uninstall leaves a file that cannot be read alone", async () => {
  const w = world("rt");
  w.write(files(w)["claude-code"], "{ broken");
  const u = await run(["uninstall", EXAMPLE, "--agent", "claude-code"], { w });
  assert.equal(u.code, 1);
  assert.match(u.out, /refused/);
  assert.equal(w.read(files(w)["claude-code"]), "{ broken");
});

test("restore puts the newest backup back and saves what was there; --dry-run only says what it would do", async () => {
  const w = world("rt");
  const f = files(w);
  w.write(f["claude-code"], '{\n  "model": "opus"\n}\n');
  await run(["install", EXAMPLE, "--agent", "claude-code"], { w });
  const installed = w.read(f["claude-code"]);
  const dry = await run(["restore", "--agent", "claude-code", "--dry-run"], { w });
  assert.match(dry.out, /would put back settings\.json\.bak-everyhook-/);
  assert.equal(w.read(f["claude-code"]), installed);
  const r = await run(["restore", "--agent", "claude-code"], { w });
  assert.equal(r.code, 0);
  assert.equal(w.read(f["claude-code"]), '{\n  "model": "opus"\n}\n');
  assert.match(r.out, /the file as it was is saved as settings\.json\.bak-everyhook-/);
  const none = await run(["restore", "--agent", "cursor"], { w });
  assert.match(none.out, /cursor\s+no backup/);
  const j = (await run(["restore", "--agent", "claude-code", "--json", "--dry-run"], { w })).json();
  assert.deepEqual(Object.keys(j), ["ok", "dryRun", "scope", "results"]);
});

test("usage errors: no agents for install, a hook that does not exist, an unknown agent, scope or event", async () => {
  const w = world("inst");
  const err = async (args, re) => { const r = await run(args, { w }); assert.equal(r.code, 2, args.join(" ")); assert.match(r.err, re, args.join(" ")); };
  await err(["install", EXAMPLE], /install needs the agents: --agent <a,b,...> or --all/);
  await err(["install"], /install needs the hook/);
  await err(["install", EXAMPLE, "--agent", "emacs"], /unknown agent "emacs"/);
  await err(["install", EXAMPLE, "--all", "--agent", "codex"], /--all and --agent do not go together/);
  await err(["install", EXAMPLE, "--all", "--scope", "system"], /--scope is user or project/);
  await err(["install", EXAMPLE, "--all", "--event", "pre-tool,boom"], /unknown event "boom"/);
  await err(["install", EXAMPLE, "--all", "--timeout", "0"], /--timeout is a number of seconds/);
  await err(["uninstall", EXAMPLE, "--matcher", "x"], /uninstall does not take --matcher/);
  const missing = await run(["install", path.join(w.hooks, "nope.mjs"), "--all"], { w });
  assert.equal(missing.code, 1);
  assert.match(missing.err, /the hook does not exist/);
});
