// What the real binaries do with a hook's raw output, with no everyhook in the loop (test/conformance.mjs): exit codes, JSON in each agent's own
// dialect, ask, text that is not JSON, a hook that runs too long. These are the facts that `everyhook explain` marks "binary". Each agent is
// started asynchronously against a fake API on 127.0.0.1; no token is spent. A case whose hook did not get to run because the machine was
// slow is put again once, with the same hooks.
import test from "node:test";
import assert from "node:assert/strict";
import { IS_WIN } from "./helpers.mjs";
import { TESTED, casesFor, expected, runCases } from "./conformance.mjs";

const T = 600000;

const SHELL = {
  "claude-code": /bash\.exe"? -c /,
  codex: /powershell\.exe"? -NoProfile -Command /,
  "gemini-cli": /powershell\.exe -NoProfile -NonInteractive -Command .*\$LASTEXITCODE/,
  "copilot-cli": /powershell\.exe"? -nop -nol -c /,
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
