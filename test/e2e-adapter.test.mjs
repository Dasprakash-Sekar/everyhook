// everyhook put to the real agents. For each agent whose binary E2E_* names (Claude Code, Codex CLI, Gemini CLI, GitHub Copilot CLI), run against a
// fake API on 127.0.0.1 so that no token is spent:
//   1. the first thing in the README: install block-force-push and log-tool-calls, make the agent run `git push --force origin main` and a
//      harmless command, see the first blocked and the second through, read the recorded documents, and uninstall to the exact bytes;
//   2. every answer of a hook at a tool event, through the adapter, and what each agent did with it (also exit codes, a hook that runs too long, output
//      that is not an answer, with and without --fail-closed);
//   3. a prompt that a hook refuses, and what the agent did;
//   4. context at the start of a session, and a hook that sends the agent back to work once when it stops.
// The binary is started asynchronously with its stdin ignored; every run has its own throwaway home and config folders.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TESTED } from "./conformance.mjs";
import { allText, install, session, setup, uninstall } from "./adapter.mjs";

const T = 600000;
const AGENTS = ["claude-code", "codex", "gemini-cli", "copilot-cli"];

// What each agent did with an answer at a tool event, through everyhook: the same for the four agents.
const TOOL_CASES = [
  ["deny", "blocked+reason"], ["ask", "blocked+reason"], ["allow", "ran"], ["context", "ran"], ["exit2", "blocked+reason"],
  ["exit1", "blocked+reason"], ["invalid", "ran"], ["slow", "ran"], ["none", "ran"],
];
// What reached the model, by agent: context at pre-tool, and a deny / context at post-tool.
const REACHED = {
  "claude-code": { preContext: true, postDeny: true, postContext: true, promptBlocked: true },
  codex: { preContext: true, postDeny: true, postContext: true, promptBlocked: true },
  "gemini-cli": { preContext: false, postDeny: true, postContext: true, promptBlocked: true },
  "copilot-cli": { preContext: false, postDeny: false, postContext: true, promptBlocked: false },
};

const configFiles = (agent, sb) => ({
  "claude-code": [path.join(sb.claude, "settings.json")],
  codex: [path.join(sb.codex, "hooks.json")],
  "gemini-cli": [path.join(sb.gemini, "settings.json")],
  "copilot-cli": [path.join(sb.copilot, "hooks", "everyhook.json")],
})[agent];
// Gemini CLI hands the model its refusal as { "error": "..." }
const plain = (text) => { try { const j = JSON.parse(text); return j && typeof j.error === "string" ? j.error : text; } catch { return text; } };
const bytesOf = (files) => files.map((f) => (fs.existsSync(f) ? fs.readFileSync(f).toString("hex") : null));

for (const agent of AGENTS) {
  const mod = TESTED[agent];
  const skip = mod.skip();

  test(`${agent}: install block-force-push and log-tool-calls, a force push is blocked and a harmless command runs, uninstall gives the bytes back`, { skip, timeout: T }, async () => {
    const s = setup(agent, "first", ["block", "log"]);
    const harmless = `echo harmless-${agent}`;
    let before;
    const o = await session(s, [{ shell: "git push --force origin main" }, { shell: harmless }], {
      before: async () => {
        before = bytesOf(configFiles(agent, s.sb));
        await install(s, "block");
        await install(s, "log", ["--event", "all"]);
      },
    });
    assert.equal(o.r.code, 0, `${agent} exited ${o.r.code}: ${o.r.err.slice(0, 500)}`);
    assert.equal(o.results.length, 2, "both tool calls got a result");
    assert.match(plain(o.results[0].text), /Force-pushing the protected branch "main" is blocked\. Push without --force, or ask the person to allow it\./, "the reason reached the model");
    assert.ok(o.results[1].text.includes(`harmless-${agent}`), "the harmless command ran");
    // the recorded documents: both calls reached the hook before they ran; only the harmless one ran
    const docs = o.everyhookLog;
    const pre = docs.filter((d) => d.event === "pre-tool");
    // Copilot CLI runs the hooks of an event in order and stops at the first deny: the logging hook, installed after the blocking one, never saw the blocked call
    assert.deepEqual(pre.map((d) => d.tool.command), agent === "copilot-cli" ? [harmless] : ["git push --force origin main", harmless], "the contract's document had the command, the same for every agent");
    assert.ok(pre.every((d) => d.agent === agent && d.tool.kind === "shell" && d.native && typeof d.cwd === "string" && typeof d.session === "string"));
    assert.deepEqual(docs.filter((d) => d.event === "post-tool").map((d) => d.tool.command), [harmless], "no post-tool for the blocked call");
    for (const e of ["session-start", "prompt", "stop"]) assert.ok(docs.some((d) => d.event === e), `${e} fired`);
    assert.ok(docs.filter((d) => d.event === "post-tool")[0].tool.output.includes(`harmless-${agent}`), "the output of the tool is in the post-tool document");
    // uninstall both: the agent's files are as they were
    const u1 = await uninstall(s, "block");
    const u2 = await uninstall(s, "log");
    assert.equal(u1.code, 0, u1.all);
    assert.equal(u2.code, 0, u2.all);
    assert.deepEqual(bytesOf(configFiles(agent, s.sb)), before, `${agent}: the configuration is byte for byte what it was`);
  });

  test(`${agent}: every answer of a hook at a tool event does what the table says`, { skip, timeout: T }, async () => {
    const s = setup(agent, "tools", ["answer"]);
    const steps = [...TOOL_CASES.map(([k]) => ({ shell: `echo ANSWER-${k}` })), { shell: "echo POST-postdeny" }, { shell: "echo POST-postcontext" }];
    const o = await session(s, steps, { before: () => install(s, "answer", ["--event", "pre-tool,post-tool", "--timeout", "6"]) });
    assert.equal(o.r.code, 0, `${agent}: ${o.r.err.slice(0, 500)}`);
    assert.equal(o.results.length, steps.length, "every call got a result");
    const ran = new Set(o.log.filter((l) => l.event === "post-tool").map((l) => l.cmd));
    TOOL_CASES.forEach(([kind, want], i) => {
      const cmd = `echo ANSWER-${kind}`;
      const saw = o.results[i].text;
      const got = ran.has(cmd) ? "ran" : saw.includes("REASON-") ? "blocked+reason" : "blocked";
      assert.equal(got, want, `${agent}: ${kind} -> ${got}, expected ${want}; the model saw: ${saw.slice(0, 160)}`);
    });
    const text = allText(o.requests);
    assert.equal(text.includes("CTX-answer"), REACHED[agent].preContext, `${agent}: context at pre-tool reaches the model`);
    assert.equal(text.includes("REASON-post"), REACHED[agent].postDeny, `${agent}: a deny at post-tool reaches the model`);
    assert.equal(text.includes("CTX-post"), REACHED[agent].postContext, `${agent}: context at post-tool reaches the model`);
  });

  test(`${agent}: with --fail-closed a hook that prints garbage or runs too long blocks the call; without it the call runs`, { skip, timeout: T }, async () => {
    const s = setup(agent, "closed", ["answer"]);
    const steps = ["invalid", "slow", "none"].map((k) => ({ shell: `echo ANSWER-${k}` }));
    const o = await session(s, steps, { before: () => install(s, "answer", ["--event", "pre-tool,post-tool", "--timeout", "6", "--fail-closed"]) });
    const ran = new Set(o.log.filter((l) => l.event === "post-tool").map((l) => l.cmd));
    assert.deepEqual(steps.map((st) => ran.has(st.shell)), [false, false, true], `${agent}: ${JSON.stringify(o.results.map((r) => r.text.slice(0, 80)))}`);
    assert.match(plain(o.results[0].text), /everyhook: the hook printed text that is not one JSON object/);
    assert.match(plain(o.results[1].text), /everyhook: the hook "answer-hook" did not finish in 4 seconds/);
  });

  test(`${agent}: a prompt that a hook refuses`, { skip, timeout: T }, async () => {
    const s = setup(agent, "prompt", ["answer"]);
    const o = await session(s, [{ shell: "echo AFTER-PROMPT" }], { prompt: "ANSWER-deny hello", before: () => install(s, "answer", ["--event", "prompt"]) });
    assert.equal(o.r.code, 0, `${agent}: ${o.r.err.slice(0, 400)}`);
    assert.equal(o.log.filter((l) => l.event === "prompt").length, 1, "the hook saw the prompt");
    assert.equal(o.log[0].cmd, "ANSWER-deny hello");
    if (REACHED[agent].promptBlocked) assert.equal(o.requests.length, 0, `${agent}: the prompt never reached the model`);
    else assert.ok(o.requests.length > 0, `${agent}: ${mod.label} drops the output of a prompt hook, so the prompt went through`);
  });

  test(`${agent}: context at the start of a session reaches the model, and a stop hook sends the agent back to work once`, { skip, timeout: T }, async () => {
    const s = setup(agent, "startstop", ["answer"]);
    const o = await session(s, [{ shell: "echo ONE" }], { env: { EH_SESSION_START: "context", EH_STOP: "stop-once" }, before: () => install(s, "answer", ["--event", "session-start,stop,session-end"]) });
    assert.equal(o.r.code, 0, `${agent}: ${o.r.err.slice(0, 400)}`);
    assert.deepEqual(o.log.map((l) => l.event), ["session-start", "stop", "stop", "session-end"].slice(0, o.log.length));
    assert.deepEqual(o.log.filter((l) => l.event === "stop").map((l) => l.stopActive), [false, true], "the second stop is told it was sent back already");
    assert.ok(JSON.stringify(o.requests[0].body).includes("CTX-answer"), "the context is in the first request");
    assert.ok(allText(o.requests.slice(1)).includes("STOP-AGAIN"), "the reason of the stop hook went to the model as the next prompt");
    assert.ok(o.requests.length >= 3, `${o.requests.length} requests: the call, the answer, and the extra turn`);
  });
}

test("codex: a hook that is not trusted does not run, and `codex exec` says nothing about it (the person trusts it in /hooks; --dangerously-bypass-hook-trust is for a test run)", { skip: TESTED.codex.skip(), timeout: T }, async () => {
  const s = setup("codex", "trust", ["block", "log"]);
  const o = await session(s, [{ shell: "git push --force origin main" }], { trust: false, before: async () => { await install(s, "block"); await install(s, "log", ["--event", "pre-tool"]); } });
  assert.equal(o.r.code, 0);
  assert.equal(o.everyhookLog.length, 0, "the hook never ran");
  assert.ok(!o.results[0].text.includes("Force-pushing"), "so the force push was not blocked: it ran (and git, in a folder that is not a repository, said so)");
  assert.match(o.results[0].text, /not a git repository/);
  assert.ok(!o.r.events.some((e) => /hook/i.test(JSON.stringify(e))), "no event of the run mentions hooks");
});
