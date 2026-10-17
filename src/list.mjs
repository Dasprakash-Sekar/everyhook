// list: every hook configured in every agent, on this machine and in this project, from every file each agent reads, with the problems the
// agent would trip over or quietly ignore. It reads; it starts no program. Only simple commands are checked for a missing executable.
import fs from "node:fs";
import path from "node:path";
import { AGENTS } from "./contract.mjs";
import { agentModule } from "./agents/index.mjs";
import { splitLine } from "./cmdline.mjs";
import { findOnPath } from "./hookproc.mjs";
import { readHooks } from "./hooksdoc.mjs";
import { runOf } from "./install.mjs";
import { locations, pathFor } from "./locations.mjs";
import { parseToml } from "./toml.mjs";

/** The event names each agent documents, to catch a misspelt one (they are case sensitive and an unknown one is ignored). */
export const KNOWN_EVENTS = {
  "claude-code": ["SessionStart", "Setup", "InstructionsLoaded", "UserPromptSubmit", "UserPromptExpansion", "MessageDisplay", "PreToolUse", "PermissionRequest", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "PermissionDenied", "Notification", "SubagentStart", "SubagentStop", "TaskCreated", "TaskCompleted", "Stop", "StopFailure", "TeammateIdle", "ConfigChange", "CwdChanged", "DirectoryAdded", "FileChanged", "WorktreeCreate", "WorktreeRemove", "PreCompact", "PostCompact", "PreModelSwitch", "PostModelSwitch", "SessionEnd", "Elicitation", "ElicitationResult"],
  codex: ["SessionStart", "SessionEnd", "PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "UserPromptSubmit", "SubagentStart", "SubagentStop", "Stop", "Interrupt"],
  "gemini-cli": ["SessionStart", "SessionEnd", "BeforeAgent", "AfterAgent", "BeforeModel", "AfterModel", "BeforeToolSelection", "BeforeTool", "AfterTool", "PreCompress", "Notification"],
  "copilot-cli": ["sessionStart", "sessionEnd", "userPromptSubmitted", "userPromptTransformed", "preToolUse", "postToolUse", "postToolUseFailure", "agentStop", "subagentStart", "subagentStop", "errorOccurred", "preCompact", "permissionRequest", "notification", "SessionStart", "SessionEnd", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SubagentStop", "ErrorOccurred", "PreCompact", "PermissionRequest"],
  cursor: ["sessionStart", "sessionEnd", "preToolUse", "postToolUse", "postToolUseFailure", "subagentStart", "subagentStop", "beforeShellExecution", "afterShellExecution", "beforeMCPExecution", "afterMCPExecution", "beforeReadFile", "afterFileEdit", "beforeSubmitPrompt", "preCompact", "stop", "afterAgentResponse", "afterAgentThought", "beforeTabFileRead", "afterTabFileEdit", "workspaceOpen"],
};

const SHELL_WORDS = new Set(["echo", "cd", "exit", "test", "[", "true", "false", "set", "export", "source", ".", "exec", "eval", "if", "for", "while", "type", "command", "cmd", "start"]);
const INTERPRETERS = new Set(["node", "node.exe", "python", "python3", "py", "bash", "sh", "zsh", "pwsh", "powershell", "powershell.exe", "ruby", "deno", "bun", "perl"]);

const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch { return null; } };
const exists = (file) => { try { fs.statSync(file); return true; } catch { return false; } };
const isAbs = (p, platform) => pathFor(platform).isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p);

/** A sentence about a command whose program or script is not there, or null. Only simple commands are checked. */
export function missingProgram(line, { env, platform }) {
  if (typeof line !== "string" || !line.trim()) return null;
  if (/&&|\|\||[;|<>`]|\$\(|%[A-Za-z_]+%/.test(line)) return null;
  const words = splitLine(line);
  const first = words[0];
  if (!first || /[$~=]/.test(first) || first.startsWith("&") || SHELL_WORDS.has(first)) return null;
  if (/[\\/]/.test(first)) {
    if (!isAbs(first, platform)) return null;
    return exists(first) || (platform === "win32" && [".exe", ".cmd", ".bat", ".com"].some((x) => exists(first + x))) ? null : `the program does not exist: ${first}`;
  }
  if (!findOnPath(first, env, platform)) return `the program is not on PATH: ${first}`;
  const base = path.basename(first).toLowerCase();
  if (INTERPRETERS.has(base)) {
    const script = words.slice(1).find((w) => !w.startsWith("-"));
    if (script && isAbs(script, platform) && !exists(script)) return `the script does not exist: ${script}`;
  }
  return null;
}

function timeoutOf(agent, handler) {
  if (agent === "gemini-cli") return typeof handler.timeout === "number" ? { value: handler.timeout, unit: "ms", seconds: handler.timeout / 1000 } : null;
  if (agent === "copilot-cli") { const v = typeof handler.timeoutSec === "number" ? handler.timeoutSec : handler.timeout; return typeof v === "number" ? { value: v, unit: "s", seconds: v } : null; }
  return typeof handler.timeout === "number" ? { value: handler.timeout, unit: "s", seconds: handler.timeout } : null;
}

/** Problems of one entry: what the agent would ignore, mis-read or fail on. */
function entryProblems(mod, agent, e, ctx) {
  const problems = [];
  const known = KNOWN_EVENTS[agent];
  if (known && !known.includes(e.event)) {
    const near = known.find((k) => k.toLowerCase() === e.event.toLowerCase());
    problems.push(`${e.event} is not an event name ${mod.name} documents${near ? ` (did you mean ${near}? names are case sensitive)` : ""}; it is ignored`);
  }
  if (e.matcher) { try { new RegExp(e.matcher); } catch { problems.push(`the matcher ${JSON.stringify(e.matcher)} is not a valid regular expression`); } }
  if (e.timeout) {
    if (agent === "gemini-cli" && e.timeout.value > 0 && e.timeout.value < 1000) problems.push(`timeout ${e.timeout.value} is read as milliseconds by Gemini CLI: ${e.timeout.value} ms; did you mean ${e.timeout.value * 1000}?`);
    if (agent !== "gemini-cli" && e.timeout.value > 3600) problems.push(`timeout ${e.timeout.value} is read as seconds by ${mod.name}: more than an hour; did you mean ${Math.round(e.timeout.value / 1000)}?`);
  }
  if (agent === "gemini-cli" && e.type && e.type !== "command") problems.push(`Gemini CLI supports only hooks of type "command", not "${e.type}"`);
  if (e.type && e.type !== "command" && agent !== "gemini-cli") return problems;
  if (e.command === null && e.type !== "mcp_tool" && e.type !== "http" && e.type !== "prompt" && e.type !== "agent") problems.push("the entry has no command");
  if (typeof e.command === "string") {
    const m = missingProgram(e.command, ctx);
    if (m) problems.push(m);
  }
  return problems;
}

/**
 * Lists every hook. `opts`: { env, platform, project, agents }. Returns
 * { project, files: [ { agent, scope, file, status, problems } ], entries: [ ... ], counts }.
 */
export function listHooks({ env = process.env, platform = process.platform, project, agents = AGENTS } = {}) {
  const ctx = { env, platform };
  const files = [];
  const entries = [];
  for (const agent of agents) {
    const mod = agentModule(agent);
    const layout = mod.LAYOUT;
    const seen = new Set();
    const codexHooksIn = {};
    for (const loc of locations(agent, { env, platform, project })) {
      if (loc.crossTool) continue;
      const targets = [];
      if (loc.dir) {
        let names = [];
        try { names = fs.readdirSync(loc.dir).filter((n) => /\.json$/i.test(n)).sort(); } catch { /* no folder */ }
        for (const n of names) targets.push(pathFor(platform).join(loc.dir, n));
      } else targets.push(loc.file);
      for (const file of targets) {
        if (seen.has(file)) continue;
        seen.add(file);
        const rec = { agent, scope: loc.scope, file, format: loc.format, status: "missing", problems: [] };
        files.push(rec);
        const text = readText(file);
        if (text === null) continue;
        rec.status = "found";
        let parsed;
        if (loc.format === "toml") {
          try {
            const value = parseToml(text);
            const hooks = value && value.hooks;
            parsed = { ok: true, value, entries: [], problems: [] };
            if (hooks && typeof hooks === "object") {
              for (const [event, groups] of Object.entries(hooks)) {
                if (!Array.isArray(groups)) continue; // managed_dir and friends are settings, not events
                for (const g of groups) for (const handler of (g && Array.isArray(g.hooks) ? g.hooks : [])) parsed.entries.push({ event, matcher: typeof g.matcher === "string" ? g.matcher : null, handler, group: g });
              }
            }
          } catch (e) { rec.status = "unreadable"; rec.problems.push(`config.toml is not TOML this reader knows (${e.message}); its hooks are not listed`); continue; }
        } else {
          parsed = readHooks(text, layout);
          if (!parsed.ok) { rec.status = "unreadable"; rec.problems.push(`${parsed.problem}; ${mod.name} cannot read it`); continue; }
          if (agent === "copilot-cli" && parsed.value.hooks !== undefined && parsed.value.version !== 1 && /[\\/]hooks[\\/][^\\/]+\.json$/i.test(file)) rec.problems.push(`"version" is ${JSON.stringify(parsed.value.version)}: Copilot CLI hook files need "version": 1, and rejects the whole file otherwise`);
          for (const p of parsed.problems) rec.problems.push(agent === "gemini-cli" ? `${p}: Gemini CLI rejects the settings ("Expected array")` : p);
        }
        if (agent === "codex" && parsed.entries.length) (codexHooksIn[path.dirname(file)] = codexHooksIn[path.dirname(file)] || []).push(rec);
        for (const raw of parsed.entries) {
          const run = runOf(mod, raw.handler);
          const handler = raw.handler;
          const e = {
            agent, scope: loc.scope, file, event: raw.event, contractEvent: mod.ALIASES[raw.event] || null, matcher: raw.matcher,
            type: typeof handler.type === "string" ? handler.type : "command",
            command: raw.handler && (handler.type === "mcp_tool" ? null : mod.commandOf(handler)),
            timeout: timeoutOf(agent, handler), ours: !!run, hook: run ? run.hook : null, alsoRunBy: [], problems: [],
          };
          e.problems = entryProblems(mod, agent, e, ctx);
          if (run) {
            if (!exists(run.everyhook)) e.problems.push(`everyhook is not at ${run.everyhook} any more`);
            if (!exists(run.hook)) e.problems.push(`the hook does not exist: ${run.hook}`);
          }
          if (agent === "claude-code" && (loc.scope === "project" || loc.scope === "local")) {
            e.alsoRunBy.push("copilot-cli");
            e.problems.push("Copilot CLI also reads this file and will run this hook (with its own spelling of the payload)");
          }
          entries.push(e);
        }
      }
    }
    // a Codex layer with hooks in hooks.json and in config.toml
    for (const recs of Object.values(codexHooksIn)) {
      const kinds = new Set(recs.map((r) => r.format));
      if (kinds.has("json") && kinds.has("toml")) for (const r of recs) r.problems.push("this layer defines hooks in hooks.json and in config.toml: Codex merges them and warns at startup; keep one");
    }
  }
  const problemCount = files.reduce((n, f) => n + f.problems.length, 0) + entries.reduce((n, e) => n + e.problems.length, 0);
  return { project: project || null, files, entries, counts: { files: files.filter((f) => f.status !== "missing").length, entries: entries.length, ours: entries.filter((e) => e.ours).length, problems: problemCount } };
}
