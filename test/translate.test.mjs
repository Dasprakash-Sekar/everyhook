// What everyhook prints for an answer: the whole table of agents, events and answers, the default reasons, ask where it is and is not
// supported, and Cursor's two ask-honouring events.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { MODULES } from "../src/agents/index.mjs";
import { AGENTS, EVENTS } from "../src/contract.mjs";
import { EFFECTS, translate } from "../src/translate.mjs";
import { ANSWERS, TABLE } from "./translate-table.mjs";

test("the table has a row for every agent, event and answer, and every row is what translate() prints", () => {
  assert.equal(TABLE.length, AGENTS.length * EVENTS.length * Object.keys(ANSWERS).length);
  const seen = new Set();
  for (const [agent, event, answer, effect, stdout, notes] of TABLE) {
    const key = `${agent}|${event}|${answer}`;
    assert.ok(!seen.has(key), `${key} twice`);
    seen.add(key);
    const got = translate(MODULES[agent], event, ANSWERS[answer], { hook: "/h/x.mjs" });
    assert.deepEqual({ effect: got.effect, stdout: got.stdout, notes: got.notes, exit: got.exit }, { effect, stdout, notes, exit: 0 }, key);
  }
  for (const a of AGENTS) for (const e of EVENTS) for (const k of Object.keys(ANSWERS)) assert.ok(seen.has(`${a}|${e}|${k}`), `${a}|${e}|${k}`);
});

test("every output is one JSON object or nothing, never the word undefined, and every effect has words", () => {
  for (const [agent, event, answer, effect, stdout] of TABLE) {
    if (stdout !== null) {
      const v = JSON.parse(stdout);
      assert.ok(v && typeof v === "object" && !Array.isArray(v), `${agent}|${event}|${answer}`);
      assert.ok(!stdout.includes("undefined") && !stdout.includes("null,") , `${agent}|${event}|${answer}: ${stdout}`);
    }
    assert.ok(effect in EFFECTS, effect);
  }
});

test("ask works on Claude Code and Copilot CLI and is a deny everywhere else, with a note that says so", () => {
  const ask = (agent) => translate(MODULES[agent], "pre-tool", ANSWERS.ask, { hook: "/h/x.mjs" });
  assert.equal(ask("claude-code").effect, "asked");
  assert.equal(ask("copilot-cli").effect, "asked");
  for (const agent of ["codex", "gemini-cli", "cursor"]) {
    const r = ask(agent);
    assert.equal(r.effect, "blocked", agent);
    assert.match(r.notes[0], new RegExp(`^ask became deny: ${MODULES[agent].name} cannot ask at pre-tool$`), agent);
  }
});

test("Cursor honours ask at beforeShellExecution and beforeMCPExecution, not at preToolUse", () => {
  const c = MODULES.cursor;
  for (const nativeEvent of ["beforeShellExecution", "beforeMCPExecution"]) {
    const r = translate(c, "pre-tool", { decision: "ask", reason: "R", message: "M" }, { nativeEvent });
    assert.equal(r.stdout, '{"permission":"ask","user_message":"M","agent_message":"R"}', nativeEvent);
    assert.equal(r.effect, "asked");
  }
  assert.equal(translate(c, "pre-tool", { decision: "ask", reason: "R" }, { nativeEvent: "preToolUse" }).effect, "blocked");
  assert.equal(translate(c, "pre-tool", { decision: "ask", reason: "R" }, { nativeEvent: "beforeReadFile" }).effect, "blocked");
});

test("a deny without a reason gets one that names the hook; an ask too", () => {
  const d = translate(MODULES["claude-code"], "pre-tool", { decision: "deny" }, { hook: "/home/me/hooks/block-force-push.mjs" });
  assert.equal(JSON.parse(d.stdout).hookSpecificOutput.permissionDecisionReason, 'Blocked by the everyhook hook "block-force-push".');
  const a = translate(MODULES["claude-code"], "pre-tool", { decision: "ask" }, { hook: "/h/x.ps1" });
  assert.equal(JSON.parse(a.stdout).hookSpecificOutput.permissionDecisionReason, 'The everyhook hook "x" asks you to confirm.');
  const g = translate(MODULES["gemini-cli"], "pre-tool", { decision: "deny", reason: "" }, { hook: "C:\\h\\guard.mjs" });
  assert.equal(JSON.parse(g.stdout).reason, 'Blocked by the everyhook hook "guard".');
});

test("a deny at an event that cannot deny becomes a message to the person where the agent has one, and is otherwise dropped with a note", () => {
  const r = translate(MODULES["claude-code"], "session-start", { decision: "deny", reason: "no" }, { hook: "/h/x.mjs" });
  assert.equal(r.stdout, '{"systemMessage":"no"}');
  assert.equal(r.effect, "message");
  assert.match(r.notes[0], /deny has no effect: Claude Code cannot deny at session-start/);
  const c = translate(MODULES["copilot-cli"], "prompt", { decision: "deny", reason: "no" }, { hook: "/h/x.mjs" });
  assert.equal(c.stdout, null);
  assert.match(c.notes[0], /deny has no effect: GitHub Copilot CLI cannot deny at prompt/);
});

test("context and message together, with a deny, are merged into one document", () => {
  const r = translate(MODULES["claude-code"], "pre-tool", { decision: "deny", reason: "R", context: "C", message: "M" }, { hook: "/h/x.mjs" });
  assert.deepEqual(JSON.parse(r.stdout), { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "R", additionalContext: "C" }, systemMessage: "M" });
});

test("Cursor: nothing to say on a permission event is an explicit allow, so that an empty answer is never read as invalid JSON", () => {
  assert.equal(translate(MODULES.cursor, "pre-tool", {}, {}).stdout, '{"permission":"allow"}');
  assert.equal(translate(MODULES.cursor, "pre-tool", {}, { nativeEvent: "beforeShellExecution" }).stdout, '{"permission":"allow"}');
  assert.equal(translate(MODULES.cursor, "prompt", {}, {}).stdout, '{"continue":true}');
  assert.equal(translate(MODULES.cursor, "post-tool", {}, {}).stdout, null);
});

test("Gemini CLI never gets an ask, which ends a headless run with no output", () => {
  for (const event of EVENTS) {
    const r = translate(MODULES["gemini-cli"], event, { decision: "ask", reason: "R" }, { hook: "/h/x.mjs" });
    assert.ok(r.stdout === null || !r.stdout.includes('"ask"'), event);
  }
});

test("Codex CLI never gets an ask or an allow at PreToolUse: it marks such a hook failed", () => {
  for (const decision of ["ask", "allow"]) {
    const r = translate(MODULES.codex, "pre-tool", { decision, reason: "R" }, { hook: "/h/x.mjs" });
    assert.ok(r.stdout === null || !new RegExp(`"permissionDecision":"${decision}"`).test(r.stdout), decision);
  }
});
