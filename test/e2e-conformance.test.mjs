// What the real binaries do with a hook's raw output, with no everyhook in the loop (test/conformance.mjs): exit codes, JSON in each agent's own
// dialect, ask, text that is not JSON, a hook that runs too long. These are the facts that `everyhook explain` marks "binary". Each agent is
// started asynchronously against a fake API on 127.0.0.1; no token is spent. A case whose hook did not get to run because the machine was
// slow is put again once, with the same hooks.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { IS_WIN } from "./helpers.mjs";
import { RECORD_HOOK, TESTED, casesFor, expected, runCases } from "./conformance.mjs";

const T = 600000;

// PowerShell is powershell.exe (5.1) or, on a machine that has PowerShell 7 (GitHub's Windows runners do), pwsh.exe
const SHELL = {
  "claude-code": /bash\.exe"? -c /,
  codex: /(powershell|pwsh)\.exe"? -NoProfile -Command /,
  "gemini-cli": /(powershell|pwsh)\.exe"? -NoProfile (-NonInteractive )?-Command .*\$LASTEXITCODE/,
  "copilot-cli": /(powershell|pwsh)\.exe"? -nop -nol -c /,
};

async function runWell(agent, opts) {
  let r = await runCases(agent, opts);
  const missing = (x) => Object.entries(x.cases).filter(([id, c]) => id !== "timeout" && !c.hookRan).map(([id]) => id);
  if (missing(r).length) r = await runCases(agent, opts);
  const still = missing(r);
  assert.deepEqual(still, [], `${agent}: the hook did not get to run for ${still.join(", ")} (a slow machine? ${r.stderr.slice(0, 200)})`);
  return r;
}

for (const [agent, mod] of Object.entries(TESTED)) {
  test(`${agent}: ${casesFor(agent).length} raw hook outputs, each as expected`, { skip: mod.skip(), timeout: T }, async () => {
    const r = await runWell(agent, { parent: IS_WIN });
    const wrong = [];
    for (const [id, c] of Object.entries(r.cases)) {
      const want = expected(agent, id);
      assert.ok(want !== undefined, `${agent}: no expectation for ${id}`);
      if (c.outcome !== want) wrong.push(`${id}: ${c.outcome}, expected ${want} (the model saw: ${c.modelSaw})`);
    }
    assert.deepEqual(wrong, [], `${agent} ${r.version} on ${process.platform}`);
    assert.equal(r.cases.timeout.stopped, true, `${agent}: a hook past its timeout was stopped at the timeout (the unit of the timeout field is the one install writes)`);
  });

  test(`${agent}: the shell that runs the hook command on Windows`, { skip: mod.skip() || (!IS_WIN && "this check is about Windows"), timeout: T }, async () => {
    const r = await runCases(agent, { parent: true, cases: casesFor(agent).filter((c) => c.id === "empty") });
    assert.ok(r.parent, "the recorder found its parent process");
    assert.match(`${r.parent.name} ${r.parent.commandLine}`, SHELL[agent]);
  });
}

test("claude-code: an allow skips the permission prompt; a hook with no opinion leaves the command to the permission rules (default mode, -p, no one to ask)", { skip: TESTED["claude-code"].skip(), timeout: T }, async () => {
  const cases = casesFor("claude-code").filter((c) => c.id === "empty" || c.id === "allow-json" || c.id === "ask-json");
  const r = await runWell("claude-code", { cases, command: (id) => `mkdir CASE-${id}`, permissions: ["--permission-mode", "default"] });
  assert.equal(r.cases.empty.outcome, "blocked", "mkdir needs approval and there is no one to give it");
  assert.equal(r.cases["allow-json"].outcome, "ran", "the hook's allow approved it");
  assert.equal(r.cases["ask-json"].outcome, "blocked+reason");
});

// The two configuration problems that `list` reports, put to the binaries that have them.
test("gemini-cli: a hooks entry that is not an array is reported as an invalid configuration, with 'Expected array'", { skip: TESTED["gemini-cli"].skip(), timeout: T }, async () => {
  const mod = TESTED["gemini-cli"];
  const sb = mod.sandbox("badgem");
  const api = await mod.fake([{ shell: "echo HI" }]);
  try {
    sb.write(sb.settings, mod.baseSettings({ hooks: { BeforeTool: { matcher: "x", hooks: [] } } }));
    const r = await mod.run(sb, api, {});
    assert.match(r.err, /Invalid configuration/);
    assert.match(r.err, /Expected array/);
  } finally { await api.close(); }
});

test("copilot-cli: a hook file whose version is not 1 is ignored without a word; one with no version, or version 1, runs", { skip: TESTED["copilot-cli"].skip(), timeout: T }, async () => {
  const mod = TESTED["copilot-cli"];
  const ran = {};
  for (const version of [2, undefined, 1]) {
    const sb = mod.sandbox("badcop");
    const api = await mod.fake([{ shell: "echo HI" }]);
    const log = path.join(sb.base, "hook.log");
    try {
      const entry = [{ type: "command", bash: `node "${RECORD_HOOK}" preToolUse`, powershell: `node "${RECORD_HOOK}" preToolUse`, timeoutSec: 10 }];
      sb.write(path.join(sb.hooksDir, "v.json"), { ...(version === undefined ? {} : { version }), hooks: { preToolUse: entry } });
      const r = await mod.run(sb, api, { env: { EH_LOG: log } });
      assert.equal(r.code, 0, r.err.slice(0, 300));
      ran[String(version)] = fs.existsSync(log);
    } finally { await api.close(); }
  }
  assert.deepEqual(ran, { 2: false, undefined: true, 1: true });
});
