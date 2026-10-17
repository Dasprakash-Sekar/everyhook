// Running a hook: which program runs which file, and what comes back for a hook that prints, exits, hangs, ignores its input or cannot start.
import { world, IS_WIN } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { commandFor, findGitBash, findOnPath, runHook } from "../src/hookproc.mjs";

const has = (cmd, args) => { try { return spawnSync(cmd, args, { stdio: "ignore", windowsHide: true }).status === 0; } catch { return false; } };

test("commandFor: .mjs, .js and .cjs run with the Node that runs everyhook", () => {
  for (const ext of [".mjs", ".js", ".cjs"]) assert.deepEqual(commandFor(`/h/x${ext}`, ["a"]), { file: process.execPath, args: [`/h/x${ext}`, "a"] });
});

test("commandFor: .ps1 with PowerShell, .sh with bash, .cmd and .bat with cmd.exe on Windows, anything else as it is", () => {
  const w = { platform: "win32", env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" } };
  assert.deepEqual(commandFor("C:\\h\\x.ps1", ["a"], w), { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "C:\\h\\x.ps1", "a"] });
  assert.deepEqual(commandFor("/h/x.ps1", [], { platform: "linux" }), { file: "pwsh", args: ["-NoProfile", "-NonInteractive", "-File", "/h/x.ps1"] });
  assert.deepEqual(commandFor("/h/x.sh", ["a"], { platform: "linux" }), { file: "bash", args: ["/h/x.sh", "a"] });
  const cmd = commandFor("C:\\h dir\\x.cmd", ["a b"], w);
  assert.equal(cmd.file, "C:\\Windows\\System32\\cmd.exe");
  assert.deepEqual(cmd.args, ["/d", "/s", "/c", '""C:\\h dir\\x.cmd" "a b""']);
  assert.equal(cmd.verbatim, true);
  assert.deepEqual(commandFor("/h/tool", ["a"], { platform: "linux" }), { file: "/h/tool", args: ["a"] });
  assert.deepEqual(commandFor("/h/x.cmd", [], { platform: "linux" }), { file: "/h/x.cmd", args: [] }, ".cmd is only special on Windows");
});

test("findGitBash: Git Bash, never the WSL launcher in System32 or the Store alias; null when there is none", () => {
  const present = new Set(["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Windows\\System32\\bash.exe", "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe", "D:\\Tools\\Git\\bin\\bash.exe"]);
  const exists = (p) => present.has(p);
  assert.equal(findGitBash({ PATH: "C:\\Windows\\System32;C:\\Program Files\\Git\\cmd" }, exists), "C:\\Program Files\\Git\\bin\\bash.exe", "bin next to a cmd folder on PATH");
  assert.equal(findGitBash({ PATH: "C:\\Windows\\System32;C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps" }, exists), "C:\\Program Files\\Git\\bin\\bash.exe", "the launcher and the alias are skipped; Program Files is looked in");
  assert.equal(findGitBash({ PATH: "D:\\Tools\\Git\\bin" }, exists), "D:\\Tools\\Git\\bin\\bash.exe", "a bash.exe on PATH itself");
  assert.equal(findGitBash({ PATH: "C:\\Windows\\System32", ProgramFiles: "E:\\none", "ProgramFiles(x86)": "E:\\none2" }, (p) => p === "C:\\Windows\\System32\\bash.exe"), null);
  assert.equal(findGitBash({ PATH: "C:\\Windows\\System32", ProgramFiles: "D:\\Tools" }, exists), "D:\\Tools\\Git\\bin\\bash.exe", "ProgramFiles names the folder");
});

test("commandFor: a .sh hook on Windows is run by the bash that was found, or is an error that says it needs one", () => {
  if (!IS_WIN) return;
  const w = world("sh");
  const git = path.join(w.base, "Git");
  fs.mkdirSync(path.join(git, "bin"), { recursive: true });
  fs.mkdirSync(path.join(git, "cmd"), { recursive: true });
  fs.writeFileSync(path.join(git, "bin", "bash.exe"), "");
  const env = { PATH: path.join(git, "cmd") };
  assert.equal(commandFor("C:\\h\\x.sh", [], { platform: "win32", env }).file.toLowerCase(), path.join(git, "bin", "bash.exe").toLowerCase());
  const none = commandFor("C:\\h\\x.sh", [], { platform: "win32", env: { PATH: "C:\\nowhere", ProgramFiles: path.join(w.base, "nope"), "ProgramFiles(x86)": path.join(w.base, "nope2") } });
  if (none.error) assert.match(none.error, /needs bash/);
});

test("findOnPath: the first file of that name on PATH, with the extensions of PATHEXT on Windows", () => {
  const w = world("path");
  const a = path.join(w.base, "a");
  const b = path.join(w.base, "b");
  fs.mkdirSync(a); fs.mkdirSync(b);
  fs.writeFileSync(path.join(b, "tool.exe"), "");
  fs.writeFileSync(path.join(a, "tool.cmd"), "");
  const env = { PATH: `${a}${IS_WIN ? ";" : ":"}${b}`, PATHEXT: ".EXE;.CMD" };
  if (IS_WIN) assert.equal(findOnPath("tool", env, "win32").toLowerCase(), path.join(a, "tool.cmd").toLowerCase(), "the first folder on PATH wins, and the extension comes from PATHEXT");
  assert.equal(findOnPath("nothing-here", env), null);
  fs.writeFileSync(path.join(a, "plain"), "");
  assert.equal(findOnPath("plain", { PATH: a }, process.platform), path.join(a, "plain"));
});

const hookFile = (w, name, text) => w.hook(name, text);

test("runHook: the input on stdin, what the hook printed, its exit code", async () => {
  const w = world("run");
  const h = hookFile(w, "echo.mjs", 'import fs from "node:fs"; const i = fs.readFileSync(0, "utf8"); process.stdout.write("got:" + i); process.stderr.write("err"); process.exitCode = 3;');
  const r = await runHook(h, [], "hello", { cwd: w.work });
  assert.equal(r.status, "exit");
  assert.equal(r.code, 3);
  assert.equal(r.stdout, "got:hello");
  assert.equal(r.stderr, "err");
  assert.ok(r.ms >= 0);
});

test("runHook: arguments, the working folder, and the environment the hook is given", async () => {
  const w = world("run");
  const h = hookFile(w, "args.mjs", "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), v: process.env.MY_VAR }));");
  const r = await runHook(h, ["one", "two words"], "", { cwd: w.work, env: { ...process.env, MY_VAR: "yes" } });
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.argv, ["one", "two words"]);
  assert.equal(fs.realpathSync(out.cwd), fs.realpathSync(w.work));
  assert.equal(out.v, "yes");
});

test("runHook: a hook that does not exist, or has no program to run it, is an error that says so", async () => {
  const w = world("run");
  const missing = await runHook(path.join(w.hooks, "nope.mjs"), [], "");
  assert.equal(missing.status, "error");
  assert.match(missing.error, /the hook does not exist/);
  const data = hookFile(w, "data.txt", "not a program");
  const r = await runHook(data, [], "");
  assert.equal(r.status, "error");
  assert.match(r.error, /could not start the hook/);
});

test("runHook: a hook that runs past its time is stopped, with the programs it started", async () => {
  const w = world("run");
  const marker = path.join(w.base, "child-alive");
  const childScript = "setTimeout(() => require('fs').writeFileSync(process.argv[1], 'alive'), 2500)";
  const h = hookFile(w, "slow.mjs", [
    'import { spawn } from "node:child_process";',
    `spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}, ${JSON.stringify(marker)}], { stdio: "ignore" });`,
    "setInterval(() => {}, 1000);",
  ].join("\n"));
  const started = Date.now();
  const r = await runHook(h, [], "", { timeoutMs: 900 });
  assert.equal(r.status, "timeout");
  assert.ok(Date.now() - started < 2400, `stopped after ${Date.now() - started} ms`);
  await new Promise((res) => setTimeout(res, 3200));
  assert.equal(fs.existsSync(marker), false, "the child of the hook was stopped too");
});

test("runHook: a hook that never reads its input does not hang or crash it", async () => {
  const w = world("run");
  const h = hookFile(w, "deaf.mjs", 'process.stdout.write("{}");');
  const r = await runHook(h, [], "x".repeat(2 * 1024 * 1024));
  assert.equal(r.status, "exit");
  assert.equal(r.stdout, "{}");
});

test("runHook: a hook that leaves a program running with its output open does not hold the answer back", async () => {
  const w = world("run");
  const h = hookFile(w, "bg.mjs", `import { spawn } from "node:child_process";
    const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], { stdio: ["ignore", "inherit", "inherit"], detached: true }); c.unref();
    process.stdout.write('{"decision":"deny"}');`);
  const started = Date.now();
  const r = await runHook(h, [], "");
  assert.equal(r.status, "exit");
  assert.equal(r.stdout, '{"decision":"deny"}');
  assert.ok(Date.now() - started < 3500, `answered after ${Date.now() - started} ms`);
});

test("runHook: output over 10 MiB is an error, not a memory problem", async () => {
  const w = world("run");
  const h = hookFile(w, "big.mjs", 'const chunk = "x".repeat(1 << 20); for (let i = 0; i < 12; i++) process.stdout.write(chunk); setInterval(() => {}, 1000);');
  const r = await runHook(h, [], "", { timeoutMs: 20000 });
  assert.equal(r.status, "error");
  assert.match(r.error, /more than 10 MiB/);
});

test("runHook: a .cmd hook on Windows, a .ps1 hook with PowerShell and a .sh hook with bash, where those exist", async (t) => {
  const w = world("run");
  const ran = [];
  if (IS_WIN) {
    const cmd = hookFile(w, "h dir.cmd", '@echo off\r\nmore >nul\r\necho {"decision":"allow"}\r\nexit /b 0\r\n');
    const r = await runHook(cmd, [], "in");
    assert.equal(r.status, "exit");
    assert.equal(r.stdout.trim(), '{"decision":"allow"}');
    ran.push("cmd");
  }
  if (has(IS_WIN ? "powershell.exe" : "pwsh", ["-NoProfile", "-Command", "exit 0"])) {
    const ps = hookFile(w, "h.ps1", '$in = [Console]::In.ReadToEnd(); Write-Output ("{`"reason`":`"" + $in.Length + "`"}"); exit 4');
    const r = await runHook(ps, [], "abcd");
    assert.equal(r.code, 4, r.stderr);
    assert.equal(JSON.parse(r.stdout).reason, "4");
    ran.push("ps1");
  }
  if (has("bash", ["-c", "exit 0"]) && !IS_WIN) {
    const sh = hookFile(w, "h.sh", '#!/bin/bash\ncat > /dev/null\necho \'{"decision":"deny"}\'\nexit 0\n');
    const r = await runHook(sh, [], "in");
    assert.equal(r.stdout.trim(), '{"decision":"deny"}');
    ran.push("sh");
  }
  t.diagnostic(`ran: ${ran.join(", ") || "none of them"}`);
});
