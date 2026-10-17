// What the real binaries do with a hook's raw output: the cases that explain's table rests on. A recording hook (test/record-hook.mjs) stands
// where everyhook would, prints the native output of the case the tool call names (CASE-<id> in the command), and the run is read back:
// did the tool run (the post-tool hook fired for it), and what did the model see in its place. No everyhook code is in the loop here.
//
// The outcome words:  ran            the tool ran
//                     blocked        the tool did not run; the model did not get the hook's reason
//                     blocked+reason the tool did not run; the model got the hook's reason (REASON-<id> in the tool result)
//                     ended          the agent stopped without answering (no tool result)
//                     context        the hook's added context (CTX-pre-tool) reached the model
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.mjs";
import * as claude from "./agent-claude.mjs";
import * as codex from "./agent-codex.mjs";
import * as gemini from "./agent-gemini.mjs";
import * as copilot from "./agent-copilot.mjs";

export const TESTED = { "claude-code": claude, codex, "gemini-cli": gemini, "copilot-cli": copilot };
export const RECORD_HOOK = path.join(ROOT, "test", "record-hook.mjs").replace(/\\/g, "/");

const J = JSON.stringify;
const IS_WIN = process.platform === "win32";

/** The native JSON each agent takes for a decision at its before-tool event. */
const NATIVE = {
  "claude-code": {
    "deny-json": J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "REASON-deny-json" } }),
    "ask-json": J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "REASON-ask-json" } }),
    "allow-json": J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "REASON-allow-json" } }),
    "legacy-block": J({ decision: "block", reason: "REASON-legacy-block" }),
    ctx: J({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "CTX-pre-tool" } }),
  },
  codex: {
    "deny-json": J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "REASON-deny-json" } }),
    "ask-json": J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "REASON-ask-json" } }),
    "allow-json": J({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "REASON-allow-json" } }),
    "legacy-block": J({ decision: "block", reason: "REASON-legacy-block" }),
    ctx: J({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: "CTX-pre-tool" } }),
  },
  "gemini-cli": {
    "deny-json": J({ decision: "deny", reason: "REASON-deny-json" }),
    "block-json": J({ decision: "block", reason: "REASON-block-json" }),
    "allow-json": J({ decision: "allow", reason: "REASON-allow-json" }),
    "deny-noreason": J({ decision: "deny" }),
    ctx: J({ hookSpecificOutput: { additionalContext: "CTX-pre-tool" } }),
    "ask-json": J({ decision: "ask", reason: "REASON-ask-json" }),
  },
  "copilot-cli": {
    "deny-json": J({ permissionDecision: "deny", permissionDecisionReason: "REASON-deny-json" }),
    "ask-json": J({ permissionDecision: "ask", permissionDecisionReason: "REASON-ask-json" }),
    "allow-json": J({ permissionDecision: "allow", permissionDecisionReason: "REASON-allow-json" }),
    "deny-noreason": J({ permissionDecision: "deny" }),
  },
};

const RAW = {
  empty: {},
  exit2: { stderr: "REASON-exit2", exit: 2 },
  exit2n: { exit: 2 },
  exit1: { stderr: "REASON-exit1", exit: 1 },
  exit3: { stderr: "REASON-exit3", exit: 3 },
  invalid: { stdout: "{not json" },
  plain: { stdout: "REASON-plain" },
  timeout: { sleepMs: 30000 },
};

/** The cases of an agent in the order they are put to it: [{ id, behavior }]. `ask-json` goes last (it ends a Gemini CLI run). */
export function casesFor(agent) {
  const native = NATIVE[agent];
  const ids = [...Object.keys(RAW), ...Object.keys(native).filter((k) => k !== "ask-json" && !k.startsWith("ctx")), ...(native.ctx ? ["ctx"] : []), ...(native["ask-json"] ? ["ask-json"] : [])];
  return ids.map((id) => ({ id, behavior: RAW[id] || { stdout: native[id] } }));
}

/**
 * What the binary is expected to do with each case. A string, or { win32, other } where Windows differs. These are the words
 * the README and `explain` state; the cases are put to the binary again by test/e2e-conformance.test.mjs.
 */
export const EXPECT = {
  "claude-code": { empty: "ran", exit2: "blocked+reason", exit2n: "blocked", exit1: "ran", exit3: "ran", invalid: "ran", plain: "ran", timeout: "ran", "deny-json": "blocked+reason", "legacy-block": "blocked+reason", "allow-json": "ran", ctx: "context", "ask-json": "blocked+reason" },
  codex: { empty: "ran", exit2: { win32: "ran", other: "blocked+reason" }, exit2n: { win32: "ran", other: "blocked" }, exit1: "ran", exit3: "ran", invalid: "ran", plain: "ran", timeout: "ran", "deny-json": "blocked+reason", "legacy-block": "blocked+reason", "allow-json": "ran", ctx: "context", "ask-json": "ran" },
  "gemini-cli": { empty: "ran", exit2: "blocked+reason", exit2n: "ran", exit1: "ran", exit3: "blocked+reason", invalid: "ran", plain: "ran", timeout: "ran", "deny-json": "blocked+reason", "block-json": "blocked+reason", "allow-json": "ran", "deny-noreason": "blocked", ctx: "none", "ask-json": "ended" },
  "copilot-cli": { empty: "ran", exit2: "blocked", exit2n: "blocked", exit1: "blocked", exit3: "blocked", invalid: "ran", plain: "ran", timeout: "ran", "deny-json": "blocked+reason", "ask-json": "blocked+reason", "allow-json": "ran", "deny-noreason": "blocked" },
};

/** The expected outcome of a case on this system, or undefined. */
export function expected(agent, id, platform = process.platform) {
  const e = EXPECT[agent][id];
  return e && typeof e === "object" ? (platform === "win32" ? e.win32 : e.other) : e;
}

function hooksConfig(agent, timeoutSec) {
  const cmd = (label, act) => `node "${RECORD_HOOK}" ${label}${act ? " act" : ""}`;
  const group = (label, act, ms) => [{ hooks: [{ type: "command", command: cmd(label, act), timeout: ms ? timeoutSec * 1000 : timeoutSec }] }];
  switch (agent) {
    case "claude-code": return { settings: { hooks: { PreToolUse: group("PreToolUse", true), PostToolUse: group("PostToolUse", false) } } };
    case "codex": return { hooksJson: { hooks: { PreToolUse: group("PreToolUse", true), PostToolUse: group("PostToolUse", false) } } };
    case "gemini-cli": return { settings: gemini.baseSettings({ hooks: { BeforeTool: group("BeforeTool", true, true), AfterTool: group("AfterTool", false, true) } }) };
    case "copilot-cli": {
      const h = (label, act) => [{ type: "command", bash: cmd(label, act), powershell: cmd(label, act), timeoutSec }];
      return { copilotFile: { version: 1, hooks: { preToolUse: h("preToolUse", true), postToolUse: h("postToolUse", false) } } };
    }
    default: throw new Error(agent);
  }
}

const PRE = /^(PreToolUse|BeforeTool|preToolUse)$/;
const POST = /^(PostToolUse|AfterTool|postToolUse)$/;

/**
 * Puts the cases to the real binary of an agent in one run, one tool call per case. Returns
 * { agent, version, code, ms, requests, cases: { id: { outcome, modelSaw, ran, elapsedMs } }, windowsShell }.
 */
export async function runCases(agent, { timeoutSec = 10, cases = casesFor(agent), parent = false, extra = {} } = {}) {
  const mod = TESTED[agent];
  const sb = mod.sandbox("conf");
  const log = path.join(sb.base, "hook-log.jsonl");
  const casesFile = path.join(sb.base, "cases.json");
  fs.writeFileSync(casesFile, J(Object.fromEntries(cases.map((c) => [c.id, c.behavior]))));
  const steps = cases.map((c) => ({ shell: `echo CASE-${c.id}` }));
  const api = await mod.fake(steps);
  const env = { EH_LOG: log, EH_CASES: casesFile, ...(parent ? { EH_PARENT: "1" } : {}), ...extra };
  const conf = hooksConfig(agent, timeoutSec);
  let r;
  try {
    if (agent === "claude-code") { sb.write(sb.settings, conf.settings); r = await mod.run(sb, api, { env, timeout: 280000 }); }
    else if (agent === "codex") { mod.configure(sb, api); sb.write(sb.hooksJson, conf.hooksJson); r = await mod.run(sb, { env, timeout: 280000 }); }
    else if (agent === "gemini-cli") { sb.write(sb.settings, conf.settings); r = await mod.run(sb, api, { env, timeout: 280000 }); }
    else { sb.write(path.join(sb.hooksDir, "rec.json"), conf.copilotFile); r = await mod.run(sb, api, { env, timeout: 280000 }); }
  } finally { await api.close(); }
  const lines = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const results = api.results();
  const out = {};
  const requestsText = JSON.stringify(api.requests.map((q) => q.body));
  cases.forEach((c, i) => {
    const pre = lines.find((l) => PRE.test(l.label) && l.id === c.id);
    const post = lines.find((l) => POST.test(l.label) && l.id === c.id);
    const saw = results[i] ? results[i].text.replace(/\s+/g, " ").trim() : null;
    let outcome;
    if (c.id === "ctx") outcome = requestsText.includes("CTX-pre-tool") ? "context" : "none";
    else if (saw === null && !post) outcome = "ended";
    else if (post) outcome = "ran";
    else outcome = saw && saw.includes(`REASON-${c.id}`) ? "blocked+reason" : "blocked";
    out[c.id] = { outcome, hookRan: !!pre, ran: !!post, modelSaw: saw === null ? null : saw.slice(0, 300), elapsedMs: pre && post ? post.at - pre.at : null, ...(c.id === "timeout" ? { stopped: !!(pre && post && post.at - pre.at < 25000) } : {}) };
  });
  const first = lines.find((l) => PRE.test(l.label));
  return { agent, version: mod.info().number, code: r.code, ms: r.ms, requests: api.requests.length, cases: out, parent: first ? first.parent : null, stderr: String(r.err).slice(0, 600) };
}
