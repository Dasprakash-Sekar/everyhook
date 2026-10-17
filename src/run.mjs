// The adapter: one agent's JSON in, the contract's document to the hook, the hook's answer translated back into what the agent understands.
// This is what `everyhook run` does, and what `bench` does with a recorded document. It never prints: it returns what should be printed.
import { agentModule } from "./agents/index.mjs";
import { buildDocument, hookName, readAnswer } from "./contract.mjs";
import { runHook } from "./hookproc.mjs";
import { translate } from "./translate.mjs";

const REASON_LIMIT = 4000;
const clip = (s, n = REASON_LIMIT) => (s.length > n ? `${s.slice(0, n)}...` : s);

/** The events where a deny stops something from happening; at the others it changes nothing or sends the agent back to work. */
const GUARDED = ["pre-tool", "prompt"];

/**
 * What a failure of the hook itself turns into. A hook that exits with a non-zero code is a deny with its stderr as the reason (at stop,
 * where a deny sends the agent back to work, only exit code 2 is: a hook that crashed must not do that). Anything else that goes wrong
 * (it cannot be started, it runs too long, it prints something that is not an answer) is ignored with a message to the person, or, with
 * --fail-closed, a deny where a deny stops something: before a tool and on a prompt.
 */
function failureAnswer(detail, failClosed, event) {
  const text = `everyhook: ${detail}`;
  return failClosed && GUARDED.includes(event) ? { decision: "deny", reason: text } : { message: `${text}; the hook was ignored` };
}

/**
 * Runs the adapter for one agent document. `nativeText` is what the agent wrote on stdin. Returns
 * { doc, hook, answer, failure, native: { stdout, exit }, effect, notes }, where `native.stdout` is JSON text or null.
 */
export async function execute({ agent, event, hook, hookArgs = [], failClosed = false, timeoutMs = 25000, nativeText, env = process.env, cwd, platform = process.platform }) {
  const mod = agentModule(agent);
  if (!mod) throw new Error(`unknown agent ${agent}`);
  let native = null;
  let failure = null;
  let doc = null;
  let hookResult = null;
  let answer;

  if (typeof nativeText === "string" && nativeText.trim() !== "") {
    try { native = JSON.parse(nativeText.replace(/^﻿/, "")); } catch { failure = { kind: "input", detail: "the agent's input was not JSON" }; }
    if (!failure && (native === null || typeof native !== "object" || Array.isArray(native))) failure = { kind: "input", detail: "the agent's input was not a JSON object" };
  } else failure = { kind: "input", detail: "the agent sent no input" };

  const nativeEvent = native && typeof native.hook_event_name === "string" ? native.hook_event_name : mod.NATIVE[event];
  if (!failure) {
    doc = buildDocument(agent, event, mod.normalize(event, native, nativeEvent), native);
    hookResult = await runHook(hook, hookArgs, JSON.stringify(doc), {
      timeoutMs,
      env: { ...env, EVERYHOOK: "1", EVERYHOOK_AGENT: agent, EVERYHOOK_EVENT: event },
      cwd: typeof doc.cwd === "string" && doc.cwd ? doc.cwd : cwd,
      platform,
    });
    if (hookResult.status === "error") failure = { kind: "start", detail: hookResult.error };
    else if (hookResult.status === "timeout") failure = { kind: "timeout", detail: `the hook "${hookName(hook)}" did not finish in ${Number((timeoutMs / 1000).toFixed(1))} seconds` };
    else if (hookResult.code !== 0) {
      const text = clip(hookResult.stderr.trim());
      const first = text.split(/\r?\n/)[0];
      if (event === "stop" && hookResult.code !== 2) failure = { kind: "exit", detail: `the hook "${hookName(hook)}" exited with code ${hookResult.code}${first ? `: ${first}` : ""}` };
      else answer = { decision: "deny", reason: text || `The hook "${hookName(hook)}" exited with code ${hookResult.code}.` };
    } else {
      const read = readAnswer(hookResult.stdout);
      if (read.ok) answer = read.answer; else failure = { kind: "invalid", detail: `${read.problem} ("${hookName(hook)}")` };
    }
  }
  if (failure) answer = failureAnswer(failure.detail, failClosed, event);

  const out = translate(mod, event, answer, { nativeEvent, hook });
  return { doc, hook: hookResult, answer, failure, native: { stdout: out.stdout, exit: out.exit }, effect: out.effect, notes: out.notes, nativeEvent };
}

