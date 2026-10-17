// The table that explain prints, held to what the binaries did: fixtures/conformance/<agent>.json holds the answer of each real binary to every
// case of test/conformance.mjs (with the version, the system and the date), and every "binary" cell of the table rests on one of them. These tests
// read the recordings; test/e2e-conformance.test.mjs puts the cases to the binaries again.
import { ROOT } from "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { AGENTS } from "../src/contract.mjs";
import { MODULES } from "../src/agents/index.mjs";
import { ROWS } from "../src/conformance.mjs";
import { casesFor, EXPECT, expected } from "./conformance.mjs";

const RECORDED = ["claude-code", "codex", "gemini-cli", "copilot-cli"];
const file = (agent) => path.join(ROOT, "fixtures", "conformance", `${agent}.json`);
const rec = (agent) => JSON.parse(fs.readFileSync(file(agent), "utf8"));

test("each of the four binaries has a recording with its version, system and date, and a case for everything we put to it", () => {
  for (const agent of RECORDED) {
    const r = rec(agent);
    assert.equal(r.agent, agent);
    assert.match(r.agentVersion, /^\d+\.\d+\.\d+$/);
    assert.match(r.os, /^(win32|linux|darwin) (x64|arm64), /);
    assert.match(r.date, /^\d{4}-\d\d-\d\d$/);
    assert.equal(r.hookTimeoutSeconds, 10);
    assert.deepEqual(Object.keys(r.cases).sort(), casesFor(agent).map((c) => c.id).sort(), agent);
  }
});

test("what was recorded is what the table of expectations says (for the system it was recorded on)", () => {
  for (const agent of RECORDED) {
    const r = rec(agent);
    const platform = r.os.split(" ")[0];
    for (const [id, c] of Object.entries(r.cases)) assert.equal(c.outcome, expected(agent, id, platform), `${agent} ${id} on ${platform}`);
    assert.equal(r.cases.timeout.stopped, true, `${agent}: the hook that ran past its timeout was stopped at it`);
  }
});

test("every expectation has a case that is put to the binary, and every case an expectation", () => {
  for (const agent of RECORDED) {
    const ids = casesFor(agent).map((c) => c.id);
    for (const id of Object.keys(EXPECT[agent])) assert.ok(ids.includes(id), `${agent}: ${id}`);
    for (const id of ids) assert.ok(id in EXPECT[agent], `${agent}: ${id}`);
  }
});

test("the shell that ran the hook on Windows is recorded for the agents that were run there", () => {
  const rx = { "claude-code": /bash\.exe/, codex: /powershell\.exe"? -NoProfile -Command/, "gemini-cli": /powershell\.exe -NoProfile -NonInteractive -Command/, "copilot-cli": /powershell\.exe"? -nop -nol -c/ };
  for (const agent of RECORDED) {
    const r = rec(agent);
    if (!r.os.startsWith("win32")) continue;
    assert.ok(r.windowsShell, `${agent}: windowsShell`);
    assert.match(`${r.windowsShell.name} ${r.windowsShell.commandLine}`, rx[agent], agent);
    assert.ok(!/nares/i.test(JSON.stringify(r)), "no user name");
  }
});

test("every cell of the table that says binary names a case that a recording holds, with the outcome the cell states", () => {
  const known = new Set(["install.user", "events", "timeout-unit", "windows-shell", "context", "allow-json", "env", "env-github"]);
  for (const row of ROWS) for (const agent of AGENTS) {
    const c = row.cells[agent];
    if (c.basis !== "binary") continue;
    assert.ok(RECORDED.includes(agent), `${row.id}/${agent}: only the four binaries that were run have binary cells`);
    const r = rec(agent);
    if (c.outcome) {
      const name = c.case === "allow-json" && agent === "claude-code" ? "allow-json (default permission mode)" : c.case;
      if (c.case === "allow-json" && agent === "claude-code") assert.equal(c.outcome, "approved", name);
      else if (c.case === "context") assert.equal(c.outcome, r.cases.ctx.outcome, `${row.id}/${agent}`);
      else assert.equal(r.cases[c.case] && r.cases[c.case].outcome, c.outcome, `${row.id}/${agent}: ${c.case}`);
    } else assert.ok(known.has(c.case) || c.case in r.cases, `${row.id}/${agent}: case ${c.case}`);
  }
});

test("the events row: the names in the table are the names the recorded documents carry", () => {
  const row = ROWS.find((r) => r.id === "events");
  for (const agent of RECORDED) {
    const names = row.cells[agent].text.split(", ");
    assert.deepEqual(names, ["pre-tool", "post-tool", "prompt", "session-start", "session-end", "stop"].map((e) => MODULES[agent].NATIVE[e]));
  }
});
