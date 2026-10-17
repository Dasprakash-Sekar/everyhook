// The three examples as hooks: each is run with a contract document on stdin and its answer is read. Then each is put to the recorded
// documents of every agent through bench, which is how a person would try them.
import { world, run, ROOT, IS_WIN } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const EX = (n) => path.join(ROOT, "examples", n);
const FORCE = EX("block-force-push.mjs");
const ENV = EX("protect-env-files.mjs");
const LOG = EX("log-tool-calls.mjs");

function ask(hook, doc, env = {}) {
  const r = spawnSync(process.execPath, [hook], { input: typeof doc === "string" ? doc : JSON.stringify(doc), encoding: "utf8", env: { ...process.env, ...env }, windowsHide: true });
  assert.equal(r.status, 0, `${path.basename(hook)} exited ${r.status}: ${r.stderr}`);
  assert.equal(r.stderr, "", "a hook prints nothing on stderr");
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const shell = (command, cwd) => ({ everyhook: 1, agent: "claude-code", event: "pre-tool", tool: { name: "Bash", kind: "shell", command, input: { command } }, cwd: cwd || process.cwd(), native: {} });
const file = (kind, p, more = {}) => ({ everyhook: 1, agent: "claude-code", event: "pre-tool", tool: { name: kind === "write" ? "Write" : "Edit", kind, path: p, input: {}, ...more }, cwd: process.cwd(), native: {} });

// ---- block-force-push -------------------------------------------------------------------------------------------------------------

const DENIED = [
  "git push --force origin main", "git push -f origin main", "git push origin main --force", "git push --force origin master",
  "git push origin +main", "git push origin +HEAD:main", "git push -f origin HEAD:main", "git push -f origin HEAD:refs/heads/main",
  "git push -fu origin main", "git push -uf origin main", "git push --force-with-lease=main origin main --force",
  "git -C /some/repo push -f origin main", "git -c user.name=x push --force origin main", "git --no-pager push -f origin main",
  "cd repo && git push --force origin main", "git add . && git commit -m x; git push -f origin main", "echo ok | git push -f origin main",
  "FOO=bar git push --force origin main", "/usr/bin/git push --force origin main", "git.exe push --force origin main",
  "git push --force 'origin' \"main\"", "git push --force --set-upstream origin main", "git push -o ci.skip --force origin main", "git push --force -- origin main",
  "git push --all --force", "git push --mirror -f", "git push origin feature:main -f",
];
const ALLOWED = [
  "git push origin main", "git push", "git push -u origin main", "git push --force-with-lease origin main", "git push --force-with-lease=main:abc origin main",
  "git push --force origin feature/x", "git push -f origin feature", "git push origin +feature", "git push --force origin :main", "git push --delete origin main",
  "git status", "git fetch --force origin main", "git pull --force", "echo git push --force origin main > /dev/null && true".replace("git push --force origin main", "hi"),
  "git commit -m 'git push --force origin main'", "git log --oneline", "ls -la", "", "npm test", "git branch -f main HEAD",
];

test("block-force-push denies the force pushes to main and master, in the ways one writes them", () => {
  for (const command of DENIED) {
    const a = ask(FORCE, shell(command));
    assert.ok(a && a.decision === "deny", `denied: ${command}`);
    assert.match(a.reason, /^Force-pushing (the protected branch "(main|master)"|every branch) is blocked\. Push without --force, or ask the person to allow it\.$/, command);
  }
});

test("block-force-push lets everything else through: other branches, --force-with-lease, deletions, other git commands, text that only mentions it", () => {
  for (const command of ALLOWED) assert.equal(ask(FORCE, shell(command)), null, `allowed: ${command}`);
});

test("block-force-push: the reasons are short, and name the branch", () => {
  const a = ask(FORCE, shell("git push -f origin master"));
  assert.ok(a.reason.length < 200, `${a.reason.length} characters`);
  assert.match(a.reason, /"master"/);
});

test("block-force-push: EVERYHOOK_PROTECTED_BRANCHES replaces the protected branches, with * as a wildcard", () => {
  const env = { EVERYHOOK_PROTECTED_BRANCHES: "prod, release/*" };
  assert.equal(ask(FORCE, shell("git push -f origin main"), env), null);
  assert.equal(ask(FORCE, shell("git push -f origin prod"), env).decision, "deny");
  assert.equal(ask(FORCE, shell("git push -f origin release/1.2"), env).decision, "deny");
  assert.equal(ask(FORCE, shell("git push -f origin releases"), env), null);
});

test("block-force-push: a force push with no branch looks up the current branch with git, and is denied when it cannot tell", () => {
  const w = world("force");
  const git = (...args) => spawnSync("git", args, { cwd: w.work, encoding: "utf8", windowsHide: true, env: { ...w.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "x");
  const onMain = ask(FORCE, shell("git push --force", w.work), { HOME: w.home });
  assert.equal(onMain.decision, "deny");
  assert.match(onMain.reason, /"main"/);
  git("checkout", "-q", "-b", "feature");
  assert.equal(ask(FORCE, shell("git push --force origin", w.work), { HOME: w.home }), null, "on a feature branch");
  assert.equal(ask(FORCE, shell("git push -f origin HEAD", w.work), { HOME: w.home }), null, "HEAD is the feature branch");
  assert.equal(ask(FORCE, shell(`git -C ${w.work.replace(/\\/g, "/")} push -f`, w.hooks), { HOME: w.home }), null, "-C names the folder");
  const nowhere = ask(FORCE, shell("git push -f", path.join(w.base, "not-a-repo")), { HOME: w.home });
  assert.equal(nowhere.decision, "deny");
  assert.match(nowhere.reason, /^A force push that names no branch is blocked because the current branch is not known/);
});

test("block-force-push: other kinds of tool, other documents and broken input are no opinion", () => {
  assert.equal(ask(FORCE, file("edit", "/x/main")), null);
  assert.equal(ask(FORCE, { everyhook: 1, event: "prompt", prompt: "git push --force origin main" }), null);
  assert.equal(ask(FORCE, { tool: { kind: "shell" } }), null);
  assert.equal(ask(FORCE, "not json"), null);
  assert.equal(ask(FORCE, ""), null);
});

test("block-force-push: quotes and line breaks in the command are read as a shell would", () => {
  assert.equal(ask(FORCE, shell('git commit -m "x; git push -f origin main"')), null, "inside a quoted message");
  assert.equal(ask(FORCE, shell("git add .\ngit push -f origin main")).decision, "deny", "on the next line");
  assert.equal(ask(FORCE, shell('git push "--force" "origin" "main"')).decision, "deny");
});

// ---- protect-env-files ------------------------------------------------------------------------------------------------------------

test("protect-env-files denies edits and writes to .env and .env.anything, but not .env.example", () => {
  for (const p of [".env", ".env.local", ".env.production", "/work/proj/.env", "C:\\work\\proj\\.env", "C:\\work\\proj\\.ENV.local", "sub/dir/.env.staging", "./.env"]) {
    for (const kind of ["edit", "write"]) {
      const a = ask(ENV, file(kind, p));
      assert.ok(a && a.decision === "deny", `${kind} ${p}`);
      assert.ok(a.reason.length < 200);
    }
  }
  for (const p of [".env.example", ".env.sample", ".env.template", "/w/.env.example", "env.txt", "app.env", "environment.js", "/w/dotenv/readme.md", ".environment", "notes.txt"]) assert.equal(ask(ENV, file("edit", p)), null, p);
});

test("protect-env-files: the reason says write for a write and edit for an edit, and names the file", () => {
  assert.match(ask(ENV, file("write", "/w/.env")).reason, /^"\.env" is protected and cannot be written\./);
  assert.match(ask(ENV, file("edit", "/w/.env.local")).reason, /^"\.env\.local" is protected and cannot be edited\./);
});

test("protect-env-files looks at every path of a call (a patch that touches several files), and only at edits and writes", () => {
  assert.equal(ask(ENV, file("edit", "a.txt", { paths: ["a.txt", "b/.env"] })).decision, "deny");
  assert.equal(ask(ENV, file("edit", "a.txt", { paths: ["a.txt", "b.txt"] })), null);
  assert.equal(ask(ENV, file("read", "/w/.env")), null, "reading is not editing");
  assert.equal(ask(ENV, shell("echo X=1 > .env")), null, "a shell redirect is out of its reach");
  assert.equal(ask(ENV, { everyhook: 1, event: "stop" }), null);
  assert.equal(ask(ENV, "garbage"), null);
});

test("protect-env-files: EVERYHOOK_PROTECT adds files, folders and patterns, read from the working folder, separated like PATH", () => {
  const sep = path.delimiter;
  const cwd = IS_WIN ? "C:\\work\\proj" : "/work/proj";
  const at = (rel) => path.join(cwd, rel);
  const doc = (p, kind = "edit") => ({ ...file(kind, p), cwd });
  const env = { EVERYHOOK_PROTECT: ["secrets.json", "config/prod", "**/*.pem", `${path.join(cwd, "..", "other")}`, "src/*.gen.ts"].join(sep) };
  assert.equal(ask(ENV, doc(at("secrets.json")), env).decision, "deny", "a file, relative");
  assert.equal(ask(ENV, doc("secrets.json"), env).decision, "deny", "a relative path in the call");
  assert.equal(ask(ENV, doc(at("config/prod/db.yml")), env).decision, "deny", "everything under a folder");
  assert.equal(ask(ENV, doc(at("config/production.yml")), env), null, "not a folder of that name");
  assert.equal(ask(ENV, doc(at("deep/er/key.pem")), env).decision, "deny", "** is any number of folders");
  assert.equal(ask(ENV, doc(at("key.pem")), env).decision, "deny");
  assert.equal(ask(ENV, doc(path.join(cwd, "..", "other", "x.txt")), env).decision, "deny", "an absolute entry");
  assert.equal(ask(ENV, doc(at("src/a.gen.ts")), env).decision, "deny", "* inside a name");
  assert.equal(ask(ENV, doc(at("src/sub/a.gen.ts")), env), null, "* does not cross a folder");
  assert.equal(ask(ENV, doc(at("readme.md")), env), null);
  assert.equal(ask(ENV, doc(at("readme.md")), { EVERYHOOK_PROTECT: "" }), null);
});

// ---- log-tool-calls ---------------------------------------------------------------------------------------------------------------

test("log-tool-calls appends one JSON line per event to EVERYHOOK_LOG and prints nothing", () => {
  const w = world("log");
  const log = path.join(w.base, "calls.jsonl");
  const d1 = shell("echo one");
  const d2 = { everyhook: 1, agent: "codex", event: "stop", cwd: "/p", native: { a: 1 } };
  assert.equal(ask(LOG, d1, { EVERYHOOK_LOG: log }), null);
  assert.equal(ask(LOG, d2, { EVERYHOOK_LOG: log }), null);
  const lines = fs.readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.match(lines[0].loggedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  const { loggedAt, ...rest } = lines[0];
  void loggedAt;
  assert.deepEqual(rest, d1);
  assert.equal(lines[1].event, "stop");
});

test("log-tool-calls: without EVERYHOOK_LOG it does nothing; long texts are cut unless EVERYHOOK_LOG_FULL=1; input that is not JSON is logged as it is", () => {
  const w = world("log");
  const log = path.join(w.base, "calls.jsonl");
  assert.equal(ask(LOG, shell("echo one"), {}), null);
  assert.equal(fs.existsSync(log), false);
  const long = shell("x".repeat(20000));
  ask(LOG, long, { EVERYHOOK_LOG: log });
  const cut = JSON.parse(fs.readFileSync(log, "utf8").trim());
  assert.match(cut.tool.command, /^x{8000}\.\.\.\[12000 more characters\]$/);
  assert.match(cut.tool.input.command, /\[12000 more characters\]$/, "also inside the nested objects");
  fs.rmSync(log);
  ask(LOG, long, { EVERYHOOK_LOG: log, EVERYHOOK_LOG_FULL: "1" });
  assert.equal(JSON.parse(fs.readFileSync(log, "utf8").trim()).tool.command.length, 20000);
  fs.rmSync(log);
  ask(LOG, "not json at all", { EVERYHOOK_LOG: log });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(log, "utf8").trim())), ["loggedAt", "unparsed"]);
});

// ---- the examples through bench, on the recorded documents of every agent ----------------------------------------------------------

const bench = async (hook, args = [], env = {}) => {
  const w = world("bench");
  return (await run(["bench", hook, "--json", ...args], { w, env: { ...w.env, ...env } })).json();
};

test("block-force-push through bench: every agent's recorded force push is blocked, every harmless command is not", async () => {
  const j = await bench(FORCE);
  const rows = j.results.filter((r) => r.event === "pre-tool" && /^shell-/.test(r.variant));
  assert.ok(rows.length >= 10);
  for (const r of rows) {
    const force = /force-push/.test(r.variant);
    assert.equal(r.answer, force ? "deny" : "no opinion", `${r.agent} ${r.variant}`);
    assert.equal(r.effect, force ? "blocked" : "none", `${r.agent} ${r.variant}`);
    if (force && r.native.stdout) assert.match(r.native.stdout, /Force-pushing the protected branch \\"main\\" is blocked/, r.agent);
  }
  assert.deepEqual([...new Set(rows.map((r) => r.agent))], ["claude-code", "codex", "gemini-cli", "copilot-cli", "cursor"]);
});

test("protect-env-files through bench: the recorded .env writes of Claude Code, Codex and Copilot are blocked; Gemini CLI refuses .env itself, and its app.env is not .env", async () => {
  const j = await bench(ENV, ["--event", "pre-tool"]);
  const blocked = j.results.filter((r) => r.effect === "blocked").map((r) => `${r.agent}:${r.variant}`).sort();
  assert.deepEqual(blocked, ["claude-code:write-env", "codex:write-env", "copilot-cli:write-env"]);
  const gem = j.results.find((r) => r.agent === "gemini-cli" && r.variant === "write");
  assert.equal(gem.answer, "no opinion");
});

test("log-tool-calls through bench: every document is logged and nothing is answered", async () => {
  const w = world("bench");
  const log = path.join(w.base, "bench.jsonl");
  const j = (await run(["bench", LOG, "--json"], { w, env: { ...w.env, EVERYHOOK_LOG: log } })).json();
  const logged = fs.readFileSync(log, "utf8").trim().split("\n").length;
  assert.equal(logged, j.results.length, "one line per fixture");
  assert.ok(j.results.every((r) => r.answer === "no opinion" && r.effect === "none"));
  assert.ok(logged >= 55, `${logged} documents`);
});
