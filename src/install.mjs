// install, uninstall and restore: what to write into each agent's configuration, and how to take exactly that out again.
//
// planInstall and planUninstall only read: they return what each file would become. applyPlan writes (through src/write.mjs, after a
// backup). Nothing is written for --dry-run.
//
// Uninstall takes out the entries that install wrote (found by their command line) with text edits, and then, if a backup of the file holds
// the very settings the file now holds, writes that backup's bytes: the file is then byte for byte what it was before install. If the file
// changed in some other way since, its other changes stay and only the entries go. A hooks file that install created and that is empty
// again is deleted.
import fs from "node:fs";
import path from "node:path";
import { agentModule, formsOf } from "./agents/index.mjs";
import { parseRun, pathKey, runLine, runWords } from "./cmdline.mjs";
import { Refusal, addEntry, readHooks, removeEntries } from "./hooksdoc.mjs";
import { installFile } from "./locations.mjs";
import { backupFile, listBackups, removeFile, restoreBackup, writeAtomic } from "./write.mjs";

const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT" || e.code === "ENOTDIR") return null; throw e; } };

/** The run command line of a handler that everyhook wrote, parsed; null for any other handler. */
export function runOf(mod, handler) {
  if (handler && typeof handler.exec === "string" && Array.isArray(handler.args)) return parseRun([handler.exec, ...handler.args]);
  const line = mod.commandOf(handler);
  return line ? parseRun(line) : null;
}

/** What an agent does with the answers of a hook at an event: the words of the table install prints. */
export function canDo(mod, event) {
  const f = formsOf(mod, event);
  const can = [];
  if (f.deny) can.push(event === "stop" ? "deny sends the agent back to work" : event === "post-tool" ? "deny gives the model the reason" : "deny blocks");
  if (f.ask) can.push("ask asks"); else if (f.deny) can.push("ask becomes deny");
  if (f.allow) can.push("allow approves");
  if (f.context) can.push("context");
  if (f.message || f.messageWith) can.push("message");
  return can;
}

/** What still needs the person after install, per agent and scope: facts from the references, said once. */
function needsFor(agent, scope) {
  const out = [];
  if (agent === "codex") out.push("Codex runs a hook only after you trust it: open /hooks in Codex and trust the everyhook entries (for one run, codex exec --dangerously-bypass-hook-trust).");
  if (agent === "gemini-cli" && scope === "project") out.push("Gemini CLI fingerprints project hooks: it asks before it runs a hook it has not seen, and again when the entry changes.");
  if (agent === "copilot-cli" && scope === "project") out.push("Copilot CLI loads project hooks only in a trusted folder.");
  if (agent === "claude-code") out.push("Claude Code reads its settings when a session starts: start a new session.");
  if (agent === "cursor") out.push("Cursor watches hooks.json and reloads it; if the hook does not fire, restart Cursor.");
  if (scope === "project") out.push(`The entries hold absolute paths of this machine (${agent === "copilot-cli" || agent === "cursor" ? "this file" : "this settings file"} is meant for you; do not commit it for a team).`);
  return out;
}

/**
 * Plans install. `opts`: { hook, agents, events, scope, project, matcher, timeout, failClosed, everyhook, env, platform }.
 * Returns { results: [ { agent, scope, file, existed, action, before, text, entries, notes, needs, refused } ] }.
 */
export function planInstall(opts) {
  const { hook, agents, events, scope, project, matcher, timeout = 30, failClosed = false, everyhook, env, platform } = opts;
  const results = [];
  for (const agent of agents) {
    const mod = agentModule(agent);
    const layout = mod.LAYOUT;
    const file = installFile(agent, scope, { env, platform, project });
    const res = { agent, scope, file, existed: false, action: "unchanged", before: null, text: null, entries: [], notes: [], needs: needsFor(agent, scope), refused: null };
    results.push(res);
    if (!file) { res.action = "refused"; res.refused = `${agent} has no ${scope} file for hooks`; continue; }
    const before = readText(file);
    res.existed = before !== null;
    res.before = before;
    let text = before;
    try {
      if (text !== null) {
        const read = readHooks(text, layout);
        if (!read.ok) throw new Refusal(`${file} is ${read.problem}; everyhook leaves a file it cannot read alone`);
        if (read.problems.length) throw new Refusal(`${file} has a problem in its hooks (${read.problems[0]}); fix it first`);
      } else text = `${JSON.stringify(layout.empty(), null, 2)}\n`;
      // the entries of this hook for these events are replaced, so that a second install changes nothing and a changed option takes effect
      const key = pathKey(hook, platform);
      const match = (handler) => { const run = runOf(mod, handler); return !!run && pathKey(run.hook, platform) === key && run.agent === agent && events.includes(run.event); };
      const removal = removeEntries(text, layout, match);
      text = removal.text;
      for (const event of events) {
        const native = mod.NATIVE[event];
        const useMatcher = matcher && (event === "pre-tool" || event === "post-tool") ? matcher : undefined;
        if (matcher && !useMatcher) res.notes.push(`--matcher is for tool events: ignored for ${event}`);
        // the agent's limit for this event, and a little less for the hook itself, so that everyhook stops it before the agent stops everyhook
        const limit = Math.min(timeout, (layout.maxTimeout && layout.maxTimeout[event]) || Infinity);
        if (limit < timeout) res.notes.push(`${event}: ${mod.name} allows ${limit} seconds, so the timeout is ${limit}, not ${timeout}`);
        const runTimeout = Math.max(1, limit - 2);
        const words = runWords({ everyhook, agent, event, hook, failClosed, timeout: runTimeout, platform });
        const handler = layout.handler({ command: runLine({ everyhook, agent, event, hook, failClosed, timeout: runTimeout, platform }), exec: words[0], args: words.slice(1), timeout: limit, failClosed, name: `everyhook ${path.basename(hook)}` });
        text = addEntry(text, layout, native, handler, useMatcher);
        res.entries.push({ event, native, matcher: useMatcher || null, timeout: limit, can: canDo(mod, event) });
      }
      if (failClosed && agent === "gemini-cli") res.notes.push("--fail-closed: Gemini CLI has no switch for it; everyhook turns a hook that fails or times out into a deny itself");
      if (failClosed && agent === "codex") res.notes.push("--fail-closed: Codex CLI has no switch for it; everyhook turns a hook that fails or times out into a deny itself");
      if (failClosed && agent === "copilot-cli") res.notes.push("--fail-closed: Copilot CLI already denies when a preToolUse hook errors; everyhook also denies on a timeout");
      if (failClosed && agent === "claude-code") res.notes.push("--fail-closed: writes onFailure: block, which Claude Code 2.1.295 and newer read");
      res.text = text;
      res.action = before === null ? "created" : text === before ? "unchanged" : "updated";
    } catch (e) {
      if (e instanceof Refusal || /^the path of /.test(e.message)) { res.action = "refused"; res.refused = e.message; } else throw e;
    }
  }
  return { results };
}

/** True when two JSON texts hold the same data. */
function sameData(a, b) {
  try { return JSON.stringify(canon(JSON.parse(a.replace(/^﻿/, "")))) === JSON.stringify(canon(JSON.parse(b.replace(/^﻿/, "")))); } catch { return false; }
}
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])]));
  return v;
}

/**
 * Plans uninstall. `opts`: { hook, agents, events (or null for every event), scope, project, env, platform }.
 * Returns { results: [ { agent, scope, file, existed, action, before, text, removed, remove, notes, restoredFrom } ] }: action is "removed",
 * "deleted" (the file only held the entries), "unchanged" (nothing of this hook there) or "refused".
 */
export function planUninstall(opts) {
  const { hook, agents, events, scope, project, env, platform } = opts;
  const results = [];
  for (const agent of agents) {
    const mod = agentModule(agent);
    const layout = mod.LAYOUT;
    const file = installFile(agent, scope, { env, platform, project });
    const res = { agent, scope, file, existed: false, action: "unchanged", before: null, text: null, removed: 0, remove: false, notes: [], restoredFrom: null, refused: null };
    results.push(res);
    if (!file) { res.action = "refused"; res.refused = `${agent} has no ${scope} file for hooks`; continue; }
    const before = readText(file);
    if (before === null) continue;
    res.existed = true;
    res.before = before;
    const read = readHooks(before, layout);
    if (!read.ok) { res.action = "refused"; res.refused = `${file} is ${read.problem}; everyhook leaves a file it cannot read alone`; continue; }
    const key = pathKey(hook, platform);
    const match = (handler) => { const run = runOf(mod, handler); return !!run && pathKey(run.hook, platform) === key && run.agent === agent && (!events || events.includes(run.event)); };
    const removal = removeEntries(before, layout, match);
    if (!removal.removed) continue;
    res.removed = removal.removed;
    let text = removal.text;
    // the backup that holds these very settings gives the file back byte for byte
    const dir = path.dirname(file);
    for (const name of listBackups(file).reverse()) {
      const backup = readText(path.join(dir, name));
      if (backup !== null && sameData(backup, text)) { text = backup; res.restoredFrom = path.join(dir, name); break; }
    }
    const skeleton = `${JSON.stringify(layout.empty(), null, 2)}\n`;
    if (!res.restoredFrom && sameData(text, skeleton)) { res.remove = true; res.action = "deleted"; res.text = null; } else { res.action = "removed"; res.text = text; }
    if (res.restoredFrom) res.notes.push("the file is back to its bytes from before install");
  }
  return { results };
}

/** Writes a plan: a backup of every file that changes, then the new text (or the deletion). Mutates each result with `backup`. */
export function applyPlan(plan, { now = new Date() } = {}) {
  for (const r of plan.results) {
    if (r.action === "unchanged" || r.action === "refused") continue;
    if (r.existed) r.backup = backupFile(r.file, now);
    if (r.remove) removeFile(r.file); else writeAtomic(r.file, r.text);
  }
  return plan;
}

/**
 * Plans restore: for each file install writes (every agent, one scope) that has an everyhook backup, the newest backup comes back.
 * Returns { results: [ { agent, scope, file, from, others, restored, reason } ] }. With apply, it does it.
 */
export function restoreAll({ agents, scope, project, env, platform, dryRun = false, now = new Date() }) {
  const results = [];
  for (const agent of agents) {
    const file = installFile(agent, scope, { env, platform, project });
    if (!file) continue;
    const backups = listBackups(file);
    if (!backups.length) { results.push({ agent, scope, file, from: null, others: 0, restored: false, reason: "no backup" }); continue; }
    const r = restoreBackup(file, { now, dryRun });
    results.push({ agent, scope, file, from: r.from, others: r.others, restored: !dryRun && r.restored, wouldRestore: dryRun, savedCurrent: r.savedCurrent || null, reason: null });
  }
  return { results };
}

