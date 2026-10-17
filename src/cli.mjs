// The command line: the options, the help, the exit codes. 0 ok, 1 findings or a refusal, 2 a usage error.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, EVENTS, isAgent, isEvent } from "./contract.mjs";
import { VERSION } from "./version.mjs";
import { execute } from "./run.mjs";
import { applyPlan, planInstall, planUninstall, restoreAll } from "./install.mjs";
import { listHooks } from "./list.mjs";
import { bench } from "./bench.mjs";
import { loadFixtures, readFixture } from "./fixtures.mjs";
import { explainJson, explainText, resolveExplain } from "./explain.mjs";
import { benchJson, benchText, installJson, installText, listJson, listText, restoreJson, restoreText, uninstallJson, uninstallText } from "./report.mjs";
import { homeDir } from "./locations.mjs";

export const HELP = `Usage: everyhook <command> [options]

Write a hook once. Run it in every coding agent: Claude Code (claude-code), Codex CLI (codex), Gemini CLI (gemini-cli),
GitHub Copilot CLI (copilot-cli) and Cursor (cursor). A hook is any executable that reads one JSON document on stdin
and may print one JSON document on stdout; everyhook turns each agent's own JSON into that document and the answer back.

Run (the agents call this; it is what install writes into their configuration):
  run        --agent <agent> --event <event> [--fail-closed] [--timeout <seconds>] -- <hook> [args...]
             reads the agent's JSON on stdin, runs the hook with the contract's document, prints the agent's JSON
             (or nothing) on stdout. A hook that exits non-zero is a deny with its stderr as the reason (at stop, only
             exit code 2 is). A hook that cannot start, runs past --timeout (default 25) or prints something that is not
             an answer is ignored with a message, or, with --fail-closed, denied before a tool and on a prompt.
             EVERYHOOK_DEBUG=1 logs to stderr. With --json it prints the whole result instead.

Change (they edit the agents' configuration files after a backup, and take --dry-run):
  install    <hook> (--agent <a,b,...> | --all) [--event <e,f,...|all>] [--scope user|project] [--project <dir>]
             [--matcher <regex>] [--timeout <seconds>] [--fail-closed]
             adds the hook to each agent's configuration, with the agent's own event names and timeout unit; only its
             own entries are added. Events default to pre-tool. --matcher is in the agent's own syntax (tool events).
  uninstall  <hook> [--agent <a,b,...>] [--event <e,f,...>] [--scope user|project] [--project <dir>]
             takes out exactly the entries install wrote for that hook; the file is byte for byte what it was before
             install when nothing else in it changed
  restore    (--agent <a,b,...> | --all) [--scope user|project] [--project <dir>]
             puts back the newest backup of each file install writes (the file as it is now is backed up first)

Read (they change nothing):
  list       [--agent <a,b,...>] [--project <dir>]
             every hook of every agent, from every file each one reads, with the problems it would trip over
  bench      <hook> [--agent <a,b,...>] [--event <e,f,...>] [--fixture <file>] [--fail-closed] [--timeout <seconds>]
             [--project <dir>]
             runs the hook through run with the recorded JSON of each agent and event (fixtures/) and prints what each
             agent would do with the answer, and the exact JSON it would get
  explain    [agent] [event]
             how the five agents differ (config files, events, deny, ask, errors, timeouts, Windows), with the basis of
             every statement: binary (a real run saw it) or docs

Options:
  --json            one JSON document on stdout (every command)
  --dry-run         show what would change and write nothing (install, uninstall, restore)
  -h, --help        this text
  -v, --version     the version

Agents: ${AGENTS.join(", ")}
Events: ${EVENTS.join(", ")}
Exit codes: 0 ok; 1 findings, a refusal or a failed hook; 2 a usage error.
Environment: EVERYHOOK_DEBUG (log to stderr), CLAUDE_CONFIG_DIR, CODEX_HOME, GEMINI_CLI_HOME and COPILOT_HOME (where those
agents keep their files), EVERYHOOK_SYSTEM_DIR (replaces the folders of administrators' files that list reads).
It reads the agents' configuration files, writes only the files install, uninstall and restore name (after a backup), starts
only the hooks you name, and sends nothing anywhere.
`;

const COMMANDS = {
  run: { options: ["agent", "event", "failClosed", "timeout", "json"], positional: 0 },
  install: { options: ["agent", "all", "event", "scope", "project", "matcher", "timeout", "failClosed", "dryRun", "json"], positional: 1 },
  uninstall: { options: ["agent", "all", "event", "scope", "project", "dryRun", "json"], positional: 1 },
  restore: { options: ["agent", "all", "scope", "project", "dryRun", "json"], positional: 0 },
  list: { options: ["agent", "all", "project", "json"], positional: 0 },
  bench: { options: ["agent", "all", "event", "fixture", "failClosed", "timeout", "project", "json"], positional: 1 },
  explain: { options: ["json"], positional: 2 },
};

const FLAGS = { "--json": "json", "--dry-run": "dryRun", "--all": "all", "--fail-closed": "failClosed", "-h": "help", "--help": "help", "-v": "version", "--version": "version" };
const VALUES = { "--agent": "agent", "--event": "event", "--scope": "scope", "--project": "project", "--matcher": "matcher", "--timeout": "timeout", "--fixture": "fixture" };

class UsageError extends Error {}

const list = (v) => String(v).split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Reads the argument list. Returns { command, positional, agent (array|null), event (array|null), scope, project, matcher, timeout, fixture,
 * json, dryRun, all, failClosed, help, version, hook, hookArgs, given } or throws a UsageError.
 */
export function parseArgs(argv) {
  const o = { command: null, positional: [], agent: null, event: null, scope: "user", project: undefined, matcher: undefined, timeout: undefined, fixture: [], json: false, dryRun: false, all: false, failClosed: false, help: false, version: false, hook: null, hookArgs: [], given: new Set() };
  let hookTokens = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--" && positional[0] === "run") { hookTokens = argv.slice(i + 1); break; }
    const eq = /^(--[a-z-]+)=(.*)$/s.exec(a);
    const flag = eq ? eq[1] : a;
    if (Object.prototype.hasOwnProperty.call(VALUES, flag)) {
      const key = VALUES[flag];
      const value = eq ? eq[2] : argv[++i];
      if (value === undefined || (!eq && /^--?[A-Za-z]/.test(value) && key !== "matcher")) throw new UsageError(`${flag} needs a value`);
      o.given.add(key);
      if (key === "fixture") o.fixture.push(value); else o[key] = value;
    } else if (Object.prototype.hasOwnProperty.call(FLAGS, flag) && !eq) {
      o[FLAGS[flag]] = true;
      o.given.add(FLAGS[flag]);
    } else if (a.startsWith("-") && a !== "-") throw new UsageError(`unknown option ${a}`);
    else positional.push(a);
  }
  if (o.help || o.version) return o;
  if (!positional.length) throw new UsageError("no command given");
  o.command = positional[0];
  const spec = COMMANDS[o.command];
  if (!spec) throw new UsageError(`unknown command "${o.command}"`);
  for (const key of o.given) if (key !== "help" && key !== "version" && !spec.options.includes(key)) throw new UsageError(`${o.command} does not take --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  o.positional = positional.slice(1);
  if (o.positional.length > spec.positional) throw new UsageError(`${o.command} takes ${spec.positional === 0 ? "no name" : `at most ${spec.positional} name${spec.positional === 1 ? "" : "s"}`}, not "${o.positional.join(" ")}"`);
  if (o.agent !== null) {
    o.agent = list(o.agent);
    for (const a of o.agent) if (!isAgent(a)) throw new UsageError(`unknown agent "${a}" (${AGENTS.join(", ")})`);
    if (!o.agent.length) throw new UsageError("--agent needs at least one agent");
  }
  if (o.all && o.agent) throw new UsageError("--all and --agent do not go together");
  if (o.event !== null) {
    o.event = o.event === "all" ? [...EVENTS] : list(o.event);
    for (const e of o.event) if (!isEvent(e)) throw new UsageError(`unknown event "${e}" (${EVENTS.join(", ")}, or all)`);
    if (!o.event.length) throw new UsageError("--event needs at least one event");
  }
  if (!["user", "project"].includes(o.scope)) throw new UsageError('--scope is user or project');
  if (o.timeout !== undefined) {
    const n = Number(o.timeout);
    if (!Number.isFinite(n) || n <= 0 || n > 3600) throw new UsageError("--timeout is a number of seconds, more than 0 and at most 3600");
    o.timeout = n;
  }
  if (o.command === "run") {
    if (hookTokens === null || hookTokens.length === 0) throw new UsageError("run needs the hook after --:  run --agent <agent> --event <event> -- <hook> [args...]");
    if (!o.agent || o.agent.length !== 1) throw new UsageError("run needs exactly one --agent");
    if (!o.event || o.event.length !== 1) throw new UsageError("run needs exactly one --event");
    o.hook = hookTokens[0];
    o.hookArgs = hookTokens.slice(1);
  } else if (hookTokens !== null) throw new UsageError("-- is for run");
  if (["install", "uninstall", "bench"].includes(o.command)) {
    if (!o.positional.length) throw new UsageError(`${o.command} needs the hook: ${o.command} <hook>`);
    o.hook = o.positional[0];
  }
  if (o.command === "install" && !o.all && !o.agent) throw new UsageError("install needs the agents: --agent <a,b,...> or --all");
  if (o.command === "restore" && !o.all && !o.agent) throw new UsageError("restore needs the agents: --agent <a,b,...> or --all");
  if (o.command === "install" && (o.fixture.length || o.given.has("fixture"))) throw new UsageError("install does not take --fixture");
  if (o.command === "explain") {
    if (o.positional[0] && !isAgent(o.positional[0])) throw new UsageError(`explain takes an agent (${AGENTS.join(", ")}), not "${o.positional[0]}"`);
    if (o.positional[1] && !isEvent(o.positional[1])) throw new UsageError(`explain takes an event (${EVENTS.join(", ")}), not "${o.positional[1]}"`);
    if (o.positional[1] && !o.positional[0]) throw new UsageError("explain <agent> <event>: the agent comes first");
  }
  return o;
}

const errorDoc = (message) => ({ ok: false, error: message });

const readStdin = () => new Promise((resolve, reject) => {
  let data = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (c) => { data += c; });
  process.stdin.on("end", () => resolve(data));
  process.stdin.on("error", reject);
});

const debugOn = (env) => !!env.EVERYHOOK_DEBUG && env.EVERYHOOK_DEBUG !== "0";

/**
 * Runs the command line. `io` replaces the real machine for the tests: { env, cwd, stdin, platform, now, everyhook, stdout: { write }, stderr: { write } }.
 * Returns the exit code.
 */
export async function main(argv, io = {}) {
  const stdout = io.stdout || process.stdout;
  const stderr = io.stderr || process.stderr;
  const env = io.env || process.env;
  const cwd = io.cwd || process.cwd();
  const platform = io.platform || process.platform;
  const everyhook = io.everyhook || fileURLToPath(new URL("../bin/everyhook.mjs", import.meta.url));
  let o;
  try { o = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    if (argv.includes("--json")) stdout.write(`${JSON.stringify(errorDoc(e.message))}\n`);
    else stderr.write(`everyhook: ${e.message}\nRun everyhook --help for the commands.\n`);
    return 2;
  }
  if (o.help) { stdout.write(HELP); return 0; }
  if (o.version) { stdout.write(`everyhook ${VERSION}\n`); return 0; }
  const emit = (doc, text) => stdout.write(o.json ? `${JSON.stringify(doc, null, 2)}\n` : text);
  const refuse = (message, extra = {}) => {
    if (o.json) stdout.write(`${JSON.stringify({ ok: false, refused: message, ...extra }, null, 2)}\n`); else stderr.write(`everyhook: ${message}\n`);
    return 1;
  };
  try {
    const project = path.resolve(cwd, o.project === undefined ? "." : o.project);
    const agents = o.all || !o.agent ? [...AGENTS] : o.agent;

    if (o.command === "explain") {
      const target = resolveExplain(o.positional[0], o.positional[1]);
      emit(explainJson(target, { env, platform }), explainText(target, { env, platform }));
      return 0;
    }

    if (o.command === "run") {
      const timeoutMs = Math.round((o.timeout === undefined ? 25 : o.timeout) * 1000);
      const stdin = io.stdin !== undefined ? io.stdin : await readStdin();
      const r = await execute({ agent: o.agent[0], event: o.event[0], hook: path.resolve(cwd, o.hook), hookArgs: o.hookArgs, failClosed: o.failClosed, timeoutMs, nativeText: stdin, env, cwd, platform });
      if (debugOn(env)) {
        const log = (s) => stderr.write(`[everyhook] ${s}\n`);
        log(`agent ${o.agent[0]}, event ${o.event[0]} (native ${r.nativeEvent})`);
        if (r.doc) log(`document for the hook: ${JSON.stringify(r.doc).slice(0, 2000)}`);
        if (r.hook) log(`hook ${r.hook.status}${r.hook.code !== null && r.hook.code !== undefined ? ` code ${r.hook.code}` : ""} in ${r.hook.ms} ms; stdout ${JSON.stringify(r.hook.stdout.slice(0, 500))}; stderr ${JSON.stringify(r.hook.stderr.slice(0, 500))}`);
        if (r.failure) log(`failure: ${r.failure.kind}: ${r.failure.detail}`);
        log(`answer ${JSON.stringify(r.answer)}; effect ${r.effect}; ${r.native.stdout === null ? "nothing printed" : `printed ${r.native.stdout}`}`);
        for (const n of r.notes) log(`note: ${n}`);
      }
      if (o.json) { stdout.write(`${JSON.stringify({ ok: !r.failure, agent: o.agent[0], event: o.event[0], nativeEvent: r.nativeEvent, document: r.doc, hook: r.hook && { status: r.hook.status, exit: r.hook.code, ms: r.hook.ms, stdout: r.hook.stdout, stderr: r.hook.stderr, error: r.hook.error || null }, answer: r.answer, failure: r.failure, native: r.native, effect: r.effect, notes: r.notes }, null, 2)}\n`); return r.failure ? 1 : 0; }
      if (r.native.stdout !== null) stdout.write(`${r.native.stdout}\n`);
      return r.native.exit;
    }

    if (o.command === "list") {
      const res = listHooks({ env, platform, project, agents });
      emit(listJson(res), listText(res, env));
      return res.counts.problems > 0 ? 1 : 0;
    }

    if (o.command === "install" || o.command === "uninstall") {
      const hook = path.resolve(cwd, o.hook);
      let isFile = false;
      try { isFile = fs.statSync(hook).isFile(); } catch { /* not there */ }
      if (o.command === "install" && !isFile) return refuse(`the hook does not exist: ${hook}`);
      const ctx = { hook, scope: o.scope, dryRun: o.dryRun };
      if (o.command === "install") {
        const events = o.event || ["pre-tool"];
        const plan = planInstall({ hook, agents, events, scope: o.scope, project, matcher: o.matcher, timeout: o.timeout, failClosed: o.failClosed, everyhook, env, platform });
        if (!o.dryRun) applyPlan(plan, { now: io.now ? new Date(io.now) : new Date() });
        const needs = [...new Set(plan.results.filter((r) => r.action !== "refused").flatMap((r) => r.needs.map((n) => `${r.agent}: ${n}`)))];
        // `npx` runs a copy in npm's cache, which npm may delete; the entries name the path of this copy
        if (/[\\/]_npx[\\/]/.test(everyhook)) needs.unshift("everyhook runs from npm's temporary folder (_npx), which npm may delete, and the entries name it. Keep a copy that stays (git clone, or npm install -g github:nrzz/everyhook) and run install again from it.");
        emit(installJson(plan, { ...ctx, needs }), installText(plan, { ...ctx, needs }));
        return plan.results.some((r) => r.action === "refused") ? 1 : 0;
      }
      const plan = planUninstall({ hook, agents, events: o.event, scope: o.scope, project, env, platform });
      if (!o.dryRun) applyPlan(plan, { now: io.now ? new Date(io.now) : new Date() });
      emit(uninstallJson(plan, ctx), uninstallText(plan, ctx));
      return plan.results.some((r) => r.action === "refused") ? 1 : 0;
    }

    if (o.command === "restore") {
      const res = restoreAll({ agents, scope: o.scope, project, env, platform, dryRun: o.dryRun, now: io.now ? new Date(io.now) : new Date() });
      emit(restoreJson(res, { scope: o.scope, dryRun: o.dryRun }), restoreText(res, { scope: o.scope, dryRun: o.dryRun }));
      return 0;
    }

    if (o.command === "bench") {
      const hook = path.resolve(cwd, o.hook);
      if (!fs.existsSync(hook)) return refuse(`the hook does not exist: ${hook}`);
      const fixtures = o.fixture.length
        ? o.fixture.flatMap((f) => String(f).split(",")).map((f) => readFixture(path.resolve(cwd, f)))
        : loadFixtures({ agents: o.all || !o.agent ? AGENTS : o.agent, events: o.event || EVENTS });
      const filtered = o.fixture.length ? fixtures.filter((f) => !f.fixture || ((!o.agent || o.agent.includes(f.fixture.agent)) && (!o.event || o.event.includes(f.fixture.event)))) : fixtures;
      if (!filtered.length) return refuse("no fixture matches");
      const res = await bench({ hook, fixtures: filtered, failClosed: o.failClosed, timeoutMs: Math.round((o.timeout === undefined ? 25 : o.timeout) * 1000), project, home: homeDir(env, platform), env, platform });
      const ctx = { hook, failClosed: o.failClosed };
      emit(benchJson(res, ctx), benchText(res, ctx));
      return res.results.some((r) => r.error || r.failure) ? 1 : 0;
    }
    return 2;
  } catch (e) {
    if (o.json) stdout.write(`${JSON.stringify(errorDoc(String(e && e.message ? e.message : e)))}\n`);
    else stderr.write(`everyhook: ${e && e.message ? e.message : e}\n`);
    return o.command === "run" && !o.failClosed ? 1 : 2;
  }
}
