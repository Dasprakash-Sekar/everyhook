// The recorded documents: every fixture is a valid file with the agent, the version, the system and the date; the set each agent has; what is
// recorded and what is documented; that the paths of the recording are placeholders, and that no fixture carries the name of whoever recorded it.
import { ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENTS, EVENTS } from "../src/contract.mjs";
import { agentModule } from "../src/agents/index.mjs";
import { FIXTURES_DIR, checkFixture, fillPlaceholders, loadFixtures, readFixture } from "../src/fixtures.mjs";
import { CURSOR_FIXTURES } from "./cursor-docs.mjs";

const loaded = loadFixtures();
const all = loaded.map((r) => r.fixture);

test("every fixture file reads, passes its check, and is named <event>.<variant>.json in the folder of its agent", () => {
  assert.deepEqual(loaded.filter((r) => r.error), []);
  assert.ok(all.length >= 60, `${all.length} fixtures`);
  for (const r of loaded) {
    const f = r.fixture;
    assert.equal(path.basename(r.file), `${f.event}.${f.variant}.json`, r.file);
    assert.equal(path.basename(path.dirname(r.file)), f.agent, r.file);
    assert.deepEqual(checkFixture(f), [], r.file);
    assert.equal(agentModule(f.agent).ALIASES[f.nativeEvent], f.event, `${r.file}: ${f.nativeEvent} is an event name of ${f.agent} for ${f.event}`);
  }
});

test("every agent has the six events recorded or documented, and the calls the examples are tried on", () => {
  for (const agent of AGENTS) {
    const mine = all.filter((f) => f.agent === agent);
    for (const e of EVENTS) assert.ok(mine.some((f) => f.event === e), `${agent} has a ${e} fixture`);
    for (const v of ["shell-force-push", "shell-harmless"]) assert.ok(mine.some((f) => f.event === "pre-tool" && f.variant === v), `${agent}: pre-tool ${v}`);
  }
  for (const agent of ["claude-code", "codex", "gemini-cli", "copilot-cli"]) {
    const mine = all.filter((f) => f.agent === agent);
    for (const v of ["edit"]) assert.ok(mine.some((f) => f.event === "pre-tool" && f.variant === v), `${agent}: pre-tool ${v}`);
    assert.ok(mine.some((f) => f.event === "post-tool" && /^shell-/.test(f.variant)), `${agent}: a post-tool shell document`);
    assert.ok(mine.some((f) => f.event === "pre-tool" && /^write/.test(f.variant)), `${agent}: a write`);
  }
});

test("the four agents with a binary are recorded (with their version and a system), Cursor is documented (and says so)", () => {
  const versions = { "claude-code": /^2\.1\.\d+$/, codex: /^0\.\d+\.\d+$/, "gemini-cli": /^0\.\d+\.\d+$/, "copilot-cli": /^1\.0\.\d+$/ };
  for (const f of all) {
    if (f.agent === "cursor") {
      assert.equal(f.source, "documented", `${f.event}.${f.variant}`);
      assert.equal(f.agentVersion, "documented");
      assert.equal(f.os, "any");
    } else {
      assert.equal(f.source, "recorded", `${f.agent}/${f.event}.${f.variant}`);
      assert.match(f.agentVersion, versions[f.agent]);
      assert.match(f.os, /^(win32|linux|darwin) (x64|arm64), /, f.os);
      assert.match(f.node, /^\d+\.\d+\.\d+$/);
    }
  }
  assert.equal(all.filter((f) => f.agent === "cursor").length, CURSOR_FIXTURES.length);
});

test("one version and one recording date for each agent's fixtures: they come from one run", () => {
  for (const agent of ["claude-code", "codex", "gemini-cli", "copilot-cli"]) {
    const mine = all.filter((f) => f.agent === agent);
    assert.equal(new Set(mine.map((f) => f.agentVersion)).size, 1, agent);
    assert.equal(new Set(mine.map((f) => f.date)).size, 1, agent);
    assert.equal(new Set(mine.map((f) => f.os)).size, 1, agent);
  }
});

test("the paths of the recording are <project>, <home> and <tmp>; none of the throwaway folders' names is left", () => {
  const text = (f) => JSON.stringify(f);
  let seen = 0;
  for (const f of all) {
    const t = text(f);
    assert.ok(!/eh-record-/.test(t), `${f.agent}/${f.event}.${f.variant} keeps the name of the recording folder`);
    assert.ok(!/AppData|\\\\Temp\\\\|\/tmp\/|\/var\/folders/i.test(t), `${f.agent}/${f.event}.${f.variant}: ${t.match(/.{30}(AppData|Temp).{30}/i)}`);
    if (t.includes("<project>")) seen++;
  }
  assert.ok(seen > 40, `${seen} fixtures use <project>`);
});

test("no fixture carries the name of whoever recorded it, nor their e-mail address", () => {
  const user = os.userInfo().username.toLowerCase();
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(FIXTURES_DIR)) {
    const t = fs.readFileSync(file, "utf8").toLowerCase();
    if (user.length > 3) assert.ok(!t.includes(user), `${path.relative(ROOT, file)} holds "${user}"`);
    assert.ok(!/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/.test(t.replace(/user_email": null/g, "")), `${path.relative(ROOT, file)} holds an e-mail address`);
  }
});

test("the recorded documents are the real thing: the keys each agent sends, at each event", () => {
  const keys = (agent, event, variant) => Object.keys(all.find((f) => f.agent === agent && f.event === event && f.variant === variant).stdin);
  assert.deepEqual(keys("claude-code", "session-start", "startup"), ["session_id", "transcript_path", "cwd", "hook_event_name", "source"]);
  assert.ok(keys("claude-code", "pre-tool", "shell-force-push").includes("tool_use_id") && keys("claude-code", "pre-tool", "shell-force-push").includes("permission_mode"));
  assert.ok(keys("claude-code", "post-tool", "shell-harmless").includes("tool_response") && keys("claude-code", "post-tool", "shell-harmless").includes("duration_ms"));
  assert.ok(keys("claude-code", "stop", "end-turn").includes("last_assistant_message") && keys("claude-code", "stop", "end-turn").includes("stop_hook_active"));
  assert.deepEqual(keys("codex", "session-start", "startup"), ["session_id", "transcript_path", "cwd", "hook_event_name", "model", "permission_mode", "source"]);
  assert.ok(keys("codex", "pre-tool", "shell-harmless").includes("turn_id"));
  assert.deepEqual(keys("gemini-cli", "pre-tool", "shell-harmless"), ["session_id", "transcript_path", "cwd", "hook_event_name", "timestamp", "tool_name", "tool_input"]);
  assert.ok(keys("gemini-cli", "stop", "end-turn").includes("prompt_response"));
  assert.deepEqual(keys("copilot-cli", "pre-tool", "shell-harmless"), ["sessionId", "timestamp", "cwd", "toolName", "toolArgs"]);
  assert.ok(keys("copilot-cli", "post-tool", "shell-harmless").includes("toolResult"));
  assert.deepEqual(keys("copilot-cli", "session-start", "startup"), ["sessionId", "timestamp", "cwd", "source", "initialPrompt"]);
});

test("fillPlaceholders: <project> and <home> in every string of a document, nowhere else", () => {
  const out = fillPlaceholders({ a: "<project>/x", b: ["<home>/y", 3, null, true], c: { d: "<project>" }, "<project>": "k" }, { project: "/p", home: "/h" });
  assert.deepEqual(out, { a: "/p/x", b: ["/h/y", 3, null, true], c: { d: "/p" }, "<project>": "k" });
});

test("readFixture and checkFixture name what is wrong with a file", () => {
  const good = all[0];
  assert.deepEqual(checkFixture(good), []);
  assert.match(checkFixture({ ...good, source: "guessed" }).join(), /source must be "recorded" or "documented"/);
  assert.match(checkFixture({ ...good, date: "yesterday" }).join(), /date must be YYYY-MM-DD/);
  assert.match(checkFixture({ ...good, stdin: [] }).join(), /stdin must be an object/);
  assert.match(checkFixture({ ...good, agent: "vim" }).join(), /agent "vim" is not one of/);
  assert.match(checkFixture({ ...good, everyhookFixture: 2 }).join(), /everyhookFixture must be 1/);
  assert.deepEqual(checkFixture(null), ["not an object"]);
  assert.match(readFixture(path.join(ROOT, "package.json")).error, /everyhookFixture must be 1/);
  assert.match(readFixture(path.join(ROOT, "nope.json")).error, /cannot read it/);
});

test("loadFixtures filters by agent and event, and keeps the agents' order", () => {
  const some = loadFixtures({ agents: ["cursor", "codex"], events: ["stop", "prompt"] });
  assert.deepEqual(some.map((r) => `${r.fixture.agent}:${r.fixture.event}`), ["codex:prompt", "codex:stop", "cursor:prompt", "cursor:stop"]);
  assert.deepEqual(loadFixtures({ agents: [] }), []);
  assert.deepEqual(loadFixtures({ dir: path.join(ROOT, "no-such-folder") }), []);
});
