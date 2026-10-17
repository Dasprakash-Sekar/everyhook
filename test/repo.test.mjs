// The package itself: what it says it is, what it imports, which Node it needs, that only the places that must start a program or write a file
// do, that nothing opens a connection, that no file has a carriage return, that the workflows have what they promise, the community files, and that the
// version is the same everywhere.
import { ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { VERSION } from "../src/version.mjs";

// a checkout on Windows may turn line feeds into CRLF
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const json = (rel) => JSON.parse(read(rel));
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const walk = (dir, ext) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name), ext) : e.name.endsWith(ext) ? [path.join(dir, e.name)] : []));
const posix = (f) => f.split(path.sep).join("/");

const pkg = json("package.json");
const SOURCES = [...walk("src", ".mjs"), ...walk("bin", ".mjs")];
const EXAMPLES = walk("examples", ".mjs");
const TESTS = walk("test", ".mjs");

test("package.json: name, version, bin, engines, no dependencies, tests run with node --test, the files that are shipped", () => {
  assert.equal(pkg.name, "everyhook");
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.type, "module");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.private, undefined);
  assert.deepEqual(pkg.bin, { everyhook: "bin/everyhook.mjs" });
  assert.equal(pkg.engines.node, ">=18");
  for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.scripts.test, "node --test");
  assert.deepEqual(pkg.files, ["bin", "src", "examples", "fixtures", "README.md", "LICENSE"]);
  for (const f of pkg.files) assert.ok(exists(f), `${f} is listed and exists`);
  assert.match(pkg.description, /^Write a hook once, run it in every coding agent: Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI and Cursor\./);
  assert.match(pkg.description, /Zero dependencies, zero tokens\.$/);
  assert.equal(pkg.repository, "github:nrzz/everyhook");
  assert.equal(pkg.homepage, "https://nrzz.github.io/claude-code-toolkit/");
  assert.equal(pkg.bugs, "https://github.com/nrzz/everyhook/issues");
  assert.equal(pkg.author, "Naresh Prabu");
  for (const k of ["hooks", "agent-hooks", "claude-code", "codex", "openai-codex", "gemini-cli", "github-copilot", "copilot-cli", "cursor", "guardrails", "cli", "nodejs", "zero-dependency", "developer-tools", "agentic-coding", "ai-coding", "coding-agents"]) assert.ok(pkg.keywords.includes(k), k);
});

test("no lock file, no vendored node_modules, no .gitattributes; a CLI only: no plugin, no skill, no icon", () => {
  for (const f of ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", ".gitattributes", ".claude-plugin", "skills", "hooks", "agents", "commands", ".mcp.json"]) assert.ok(!exists(f), f);
  assert.ok(!exists("node_modules") || fs.readdirSync(path.join(ROOT, "node_modules")).length === 0);
  assert.match(read(".gitignore"), /^node_modules\/$/m);
  assert.match(read(".gitignore"), /^\*\.bak-\*$/m, "the backups of a test run are never committed");
});

test("no tracked text file has a carriage return: every file is written with LF (the index is read, a checkout on Windows may differ)", { skip: !exists(".git") && "not a git checkout" }, () => {
  const ls = spawnSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer", windowsHide: true });
  assert.equal(ls.status, 0, String(ls.stderr));
  const tracked = ls.stdout.toString("utf8").split("\0").filter(Boolean);
  assert.ok(tracked.length > 20, `${tracked.length} tracked files`);
  const withCr = [];
  for (const f of tracked) {
    if (/\.(png|ico|jpg|gif|woff2?)$/i.test(f)) continue;
    const blob = spawnSync("git", ["show", `:${f}`], { cwd: ROOT, encoding: "buffer", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    if (blob.status === 0 && blob.stdout.includes(13)) withCr.push(f);
  }
  assert.deepEqual(withCr, [], "files that hold a carriage return in the index");
});

test("every source file, example and test is .mjs and imports only node: modules and the package itself", () => {
  assert.ok(SOURCES.length >= 25, `${SOURCES.length} source files`);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "src")).filter((n) => !n.endsWith(".mjs") && n !== "agents"), []);
  assert.deepEqual(fs.readdirSync(path.join(ROOT, "src", "agents")).filter((n) => !n.endsWith(".mjs")), []);
  const allowed = new Set(["node:child_process", "node:crypto", "node:fs", "node:http", "node:os", "node:path", "node:test", "node:assert/strict", "node:url"]);
  for (const f of [...SOURCES, ...EXAMPLES, ...TESTS]) {
    const text = read(f);
    for (const m of text.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)) {
      const spec = m[1];
      assert.ok(spec.startsWith("./") || spec.startsWith("../") || allowed.has(spec), `${f} imports ${spec}`);
    }
  }
  for (const f of [...SOURCES, ...EXAMPLES]) {
    assert.doesNotMatch(read(f), /\bimport\(/, `${f} has no dynamic loading`);
    assert.doesNotMatch(read(f).replace(/\/\/[^\n]*/g, ""), /\brequire\(/, `${f} has no require`);
  }
});

test("only src/hookproc.mjs starts a program; nothing in src or bin opens a connection, and nothing can run code that was not written here", () => {
  const startsProcess = /node:child_process|(?<![.\w])(spawn|spawnSync|execSync|execFile|execFileSync|fork)\s*\(/;
  const opensConnection = /node:(http|https|http2|net|tls|dns|dgram)\b|(?<![.\w])(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/;
  const runsCode = /node:(worker_threads|cluster|vm)\b|\bprocess\.binding\b|\beval\s*\(|new Function\s*\(/;
  for (const f of SOURCES) {
    const name = posix(f);
    const text = read(f);
    if (name !== "src/hookproc.mjs") assert.doesNotMatch(text, startsProcess, `${name} must not start a program: only src/hookproc.mjs does`);
    assert.doesNotMatch(text, opensConnection, `${name} must not open a connection: nothing in everyhook does`);
    assert.doesNotMatch(text, runsCode, name);
  }
  for (const f of EXAMPLES) {
    assert.doesNotMatch(read(f), opensConnection, `${f} opens no connection`);
    assert.doesNotMatch(read(f), runsCode, f);
  }
  assert.match(read("src/hookproc.mjs"), /node:child_process/);
});

test("only src/write.mjs writes a file: nothing else in src or bin calls a function that changes one", () => {
  const writes = /\b(?:writeFile|appendFile|copyFile|rename|unlink|rmdir|rm|mkdir|mkdtemp|truncate|symlink|link|chmod|utimes|cp)(?:Sync)?\s*\(|\bcreateWriteStream\b|\bfs\.promises\b|\bwriteSync\s*\(/;
  for (const f of SOURCES) {
    const name = posix(f);
    if (name === "src/write.mjs") continue;
    assert.doesNotMatch(read(f), writes, `${name} must not write: only src/write.mjs does`);
  }
  const w = read("src/write.mjs");
  assert.match(w, /fs\.writeFileSync/);
  assert.match(w, /fs\.renameSync/, "a file is written through a temporary file and a rename");
  assert.match(w, /copyFileSync/, "the backup is a copy");
});

test("only APIs that exist in Node 18 are used in src, bin and the examples", () => {
  const newer = [
    [/\.toSorted\(|\.toReversed\(|\.toSpliced\(|\.with\(\d/, "Array copy-methods (Node 20)"],
    [/\bObject\.groupBy\b|\bMap\.groupBy\b/, "groupBy (Node 21)"],
    [/\bArray\.fromAsync\b/, "Array.fromAsync (Node 22)"],
    [/\bPromise\.withResolvers\b/, "Promise.withResolvers (Node 22)"],
    [/import\.meta\.(dirname|filename)\b/, "import.meta.dirname/filename (Node 20.11)"],
    [/\bfs\.(glob|globSync)\b/, "fs.glob (Node 22)"],
    [/\.(isWellFormed|toWellFormed)\(/, "String well-formed methods (Node 20)"],
    [/\.(union|intersection|difference|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/, "Set methods (Node 22)"],
    [/process\.getBuiltinModule|process\.loadEnvFile|util\.styleText|\bstyleText\b/, "newer process/util APIs"],
    [/\bimport\s[^;]*\swith\s*\{/, "import attributes"],
    [/\bfs\.cpSync\b/, "fs.cpSync is experimental before Node 22"],
  ];
  for (const f of [...SOURCES, ...EXAMPLES]) {
    const text = read(f);
    for (const [re, what] of newer) assert.doesNotMatch(text, re, `${f}: ${what}`);
  }
});

test("the licence, the conduct file, the changelog and the version agree", () => {
  assert.match(read("LICENSE"), /^MIT License/);
  assert.match(read("LICENSE"), /Copyright \(c\) 2026 Naresh Prabu/);
  assert.ok(exists("CODE_OF_CONDUCT.md"));
  const v = VERSION.replace(/\./g, "\\.");
  assert.match(read("CHANGELOG.md"), new RegExp(`^## \\[${v}\\] - 2026-10-17$`, "m"));
  assert.match(read("CHANGELOG.md"), new RegExp(`^\\[${v}\\]: https://github\\.com/nrzz/everyhook/releases/tag/v${v}$`, "m"));
  for (const f of ["SECURITY.md", "SUPPORT.md", "ROADMAP.md", "CONTRIBUTING.md"]) assert.ok(exists(f), f);
  assert.match(read("SECURITY.md"), /security\/advisories\/new/);
  const roadmap = read("ROADMAP.md");
  const bullets = (roadmap.match(/^- /gm) || []).length;
  assert.ok(bullets >= 3 && bullets <= 5, `${bullets} next steps: three to five`);
  assert.match(roadmap, /good first issue: \[#1\]\(https:\/\/github\.com\/nrzz\/everyhook\/issues\/1\)/, "the roadmap names the good first issue");
  assert.match(read("CONTRIBUTING.md"), /## Where things are/);
});

test("the issue forms and the pull request template are there", () => {
  for (const f of ["bug_report.yml", "feature_request.yml", "config.yml"]) assert.ok(exists(`.github/ISSUE_TEMPLATE/${f}`), f);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /blank_issues_enabled: false/);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /nrzz\/everyhook\/discussions/);
  assert.match(read(".github/ISSUE_TEMPLATE/config.yml"), /nrzz\/everyhook\/security\/advisories\/new/);
  assert.ok(exists(".github/PULL_REQUEST_TEMPLATE.md"));
  assert.match(read(".github/dependabot.yml"), /package-ecosystem: github-actions/);
  for (const f of ["bug_report.yml", "feature_request.yml"]) assert.match(read(`.github/ISSUE_TEMPLATE/${f}`), /everyhook/);
});

test("the CI workflows: the suite on three systems and four Node versions, and the real-agent checks on all three systems, with no action version pinned here", () => {
  const ci = read(".github/workflows/test.yml");
  assert.match(ci, /os: \[ubuntu-latest, windows-latest, macos-latest\]/);
  assert.match(ci, /node: \[20, 22, 24\]/);
  assert.match(ci, /node: 18/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /uses: actions\/checkout@/);
  assert.match(ci, /uses: actions\/setup-node@/);
  assert.match(ci, /timeout-minutes: \d+/);
  const e2e = read(".github/workflows/e2e.yml");
  for (const part of ["name: e2e", "ubuntu-latest, macos-latest, windows-latest", "npm install -g @anthropic-ai/claude-code", "npm install -g @openai/codex", "npm install -g @google/gemini-cli", "npm install -g @github/copilot", "E2E_CLAUDE: claude", "E2E_CODEX: codex", "E2E_GEMINI: gemini", "E2E_COPILOT: copilot", "schedule:", "workflow_dispatch", "claude_version", "codex_version", "gemini_version", "copilot_version", "--test-concurrency=1"]) assert.ok(e2e.includes(part), part);
  for (const file of ["e2e-conformance", "e2e-adapter"]) assert.ok(e2e.includes(`test/${file}.test.mjs`), file);
  assert.match(e2e, /timeout-minutes: \d+/);
  // an install may fail without failing the job; the real-agent checks may not
  const steps = e2e.split(/\n {6}- /);
  const installs = steps.filter((s) => s.includes("npm install -g"));
  assert.equal(installs.length, 4);
  for (const s of installs) assert.match(s, /continue-on-error: true/);
  const checks = steps.find((s) => s.includes("test/e2e-conformance.test.mjs"));
  assert.doesNotMatch(checks, /continue-on-error/);
  for (const m of e2e.matchAll(/test\/[\w.-]+\.test\.mjs/g)) assert.ok(exists(m[0]), m[0]);
});

test("every test helper that node --test runs as a test does nothing when it is not asked to", () => {
  // the helpers under test/ are run by `node --test` too; the ones that read standard input or start agents must be inert without their variable
  const r = spawnSync(process.execPath, [path.join(ROOT, "test", "record-hook.mjs")], { encoding: "utf8", input: "", timeout: 20000, windowsHide: true, env: { ...process.env, EH_LOG: "" } });
  assert.equal(r.status, 0);
  const a = spawnSync(process.execPath, [path.join(ROOT, "test", "answer-hook.mjs")], { encoding: "utf8", input: "", timeout: 20000, windowsHide: true, env: { ...process.env, EH_LOG: "" } });
  assert.equal(a.status, 0);
  const rec = spawnSync(process.execPath, [path.join(ROOT, "test", "record.mjs")], { encoding: "utf8", input: "", timeout: 20000, windowsHide: true, env: { ...process.env, RECORD_FIXTURES: "" } });
  assert.equal(rec.status, 0);
  assert.equal(rec.stdout, "");
});

test("no test asks the machine for its home folder: every test builds its own world in a temporary folder", () => {
  for (const f of TESTS) {
    if (f.endsWith("repo.test.mjs") || f.endsWith("locations.test.mjs") || f.endsWith("hookproc.test.mjs")) continue;
    assert.doesNotMatch(read(f), /os\.homedir\(\)/, `${f} reaches for the real home folder`);
  }
});

test("the process the tests run in has its home and every agent's config folder pointed at a throwaway place, and the agents' variables of this machine are gone", () => {
  for (const k of ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "COPILOT_HOME", "GEMINI_CLI_HOME"]) {
    assert.ok(process.env[k].toLowerCase().includes("eh-guard-") || process.env[k].toLowerCase().includes(`${path.sep}eh-guard-`.toLowerCase()), `${k} = ${process.env[k]}`);
  }
  assert.equal(process.env.USERPROFILE, process.env.HOME);
  for (const k of Object.keys(process.env)) assert.ok(!/^(ANTHROPIC|CLAUDECODE|CODEX_THREAD|OPENAI_API|GEMINI_API|COPILOT_PROVIDER)/i.test(k), k);
});
