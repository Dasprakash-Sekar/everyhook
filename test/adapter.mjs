// The sessions the adapter is put through with the real binaries (test/e2e-adapter.test.mjs): everyhook installed into the agent, the agent
// run against its fake API, and what happened read back from the agent's own tool results, the requests it made and the hook's log.
import fs from "node:fs";
import path from "node:path";
import { ROOT, snapshot, world } from "./helpers.mjs";
import { TESTED } from "./conformance.mjs";
import { copyEveryhook, copyHook, everyhook, go, prepare } from "./session.mjs";

export const HOOKS = {
  block: path.join(ROOT, "examples", "block-force-push.mjs"),
  log: path.join(ROOT, "examples", "log-tool-calls.mjs"),
  answer: path.join(ROOT, "test", "answer-hook.mjs"),
};

// What each agent did with an answer at a tool event, through everyhook: the same for the four agents.
export const TOOL_CASES = [
  ["deny", "blocked+reason"], ["ask", "blocked+reason"], ["allow", "ran"], ["context", "ran"], ["exit2", "blocked+reason"],
  ["exit1", "blocked+reason"], ["invalid", "ran"], ["slow", "ran"], ["none", "ran"],
];
// What reached the model, by agent: context at pre-tool, and a deny / context at post-tool.
export const REACHED = {
  "claude-code": { preContext: true, postDeny: true, postContext: true, promptBlocked: true },
  codex: { preContext: true, postDeny: true, postContext: true, promptBlocked: true },
  "gemini-cli": { preContext: false, postDeny: true, postContext: true, promptBlocked: true },
  "copilot-cli": { preContext: false, postDeny: false, postContext: true, promptBlocked: false },
};

// What each agent did with a call when everyhook itself could not start (its files were gone), without and with --fail-closed.
// Only Claude Code has a field for it (onFailure: block); Copilot CLI denies on any non-zero exit by itself.
export const GONE = {
  "claude-code": { open: "ran", closed: "blocked" },
  codex: { open: "ran", closed: "ran" },
  "gemini-cli": { open: "ran", closed: "ran" },
  "copilot-cli": { open: "blocked", closed: "blocked" },
};

export const readLog = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

/** A world for an agent with a copy of everyhook (in a folder with a space) and the hooks asked for (copied to a folder with a space). */
export function setup(agent, label, hooks = []) {
  const mod = TESTED[agent];
  const sb = mod.sandbox(label);
  const bin = copyEveryhook(sb);
  const copies = Object.fromEntries(hooks.map((h) => [h, copyHook(sb, HOOKS[h], `${h}-hook.mjs`)]));
  return { agent, mod, sb, bin, hooks: copies, log: path.join(sb.base, "hook-log.jsonl"), everyhookLog: path.join(sb.base, "everyhook.jsonl") };
}

/** Installs a hook (a key of `hooks` given to setup) with the options, through the copy of the CLI. */
export async function install(s, hook, args = []) {
  const r = await everyhook(s.sb, s.bin, ["install", s.hooks[hook], "--agent", s.agent, ...args]);
  if (r.code !== 0) throw new Error(`install failed (${r.code}): ${r.all}`);
  return r;
}

export const uninstall = (s, hook) => everyhook(s.sb, s.bin, ["uninstall", s.hooks[hook], "--agent", s.agent]);

/**
 * Runs a script of steps (see the test/agent-*.mjs modules) with the agent; returns { r, api, results, requests, log, everyhookLog }.
 * `before(api)` runs after the agent is prepared for the fake API and before it starts: that is where the hooks are installed (installing first
 * would be undone by the sign-in settings that Gemini CLI needs).
 */
export async function session(s, steps, { env = {}, prompt, permissions, trust, before } = {}) {
  const api = await s.mod.fake(steps);
  let r;
  try {
    prepare(s.agent, s.sb, api);
    if (before) await before(api);
    r = await go(s.agent, s.sb, api, { env: { EH_LOG: s.log, EVERYHOOK_LOG: s.everyhookLog, ...env }, prompt, permissions, trust });
  } finally { await api.close(); }
  return { r, api, results: api.results(), requests: api.requests, log: readLog(s.log), everyhookLog: readLog(s.everyhookLog) };
}

/** The text of every request of a session, for "did this reach the model". */
export const allText = (requests) => JSON.stringify(requests.map((q) => q.body));

export { snapshot, world };
