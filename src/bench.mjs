// bench: a hook, put to the documents each agent really sent (fixtures/), through the same adapter `run` uses. For each document it says
// what the hook answered, what the agent would do with the answer, and the exact JSON the agent would get.
import os from "node:os";
import { execute } from "./run.mjs";
import { EFFECTS } from "./translate.mjs";
import { fillPlaceholders } from "./fixtures.mjs";

/** How the hook's answer reads: "deny", "ask", "allow", "no opinion", "exit 3 (deny)", "timeout", ... */
function answerWord(r) {
  if (r.failure) return { timeout: "timeout", start: "could not start", invalid: "invalid output", input: "no input" }[r.failure.kind] || `exit ${r.hook.code} (ignored)`;
  if (r.hook && r.hook.code !== 0) return `exit ${r.hook.code} (deny)`;
  return r.answer.decision || (r.answer.context || r.answer.message ? "context or message" : "no opinion");
}

/** What the agent would do, in a short phrase that includes fail open and fail closed. */
function outcomeWord(r) {
  if (r.failure) return `${r.effect === "blocked" ? "fail closed" : "fail open"}: ${r.failure.detail}`;
  const base = EFFECTS[r.effect] || r.effect;
  return r.notes.length ? `${base} (${r.notes.join("; ")})` : base;
}

/**
 * Puts the fixtures to the hook. `fixtures` are the results of loadFixtures(); a fixture that could not be read is reported as such.
 * Returns { results: [ { agent, version, source, event, variant, summary, answer, effect, outcome, notes, native, hookMs, error } ] }.
 */
export async function bench({ hook, hookArgs = [], fixtures, failClosed = false, timeoutMs = 25000, project, home = os.homedir(), env = process.env, platform = process.platform }) {
  const results = [];
  for (const item of fixtures) {
    if (!item.fixture) { results.push({ file: item.file, error: item.error }); continue; }
    const f = item.fixture;
    const stdin = fillPlaceholders(f.stdin, { project: project || process.cwd(), home });
    const r = await execute({ agent: f.agent, event: f.event, hook, hookArgs, failClosed, timeoutMs, nativeText: JSON.stringify(stdin), env, cwd: project, platform });
    results.push({
      file: item.file, agent: f.agent, version: f.agentVersion, source: f.source, os: f.os, date: f.date, event: f.event, variant: f.variant, summary: f.summary,
      answer: answerWord(r), effect: r.effect, outcome: outcomeWord(r), notes: r.notes,
      native: { stdout: r.native.stdout, exit: r.native.exit },
      hook: r.hook ? { status: r.hook.status, exit: r.hook.code, ms: r.hook.ms, stderr: r.hook.stderr.trim().slice(0, 300) } : null,
      failure: r.failure,
    });
  }
  return { results };
}
