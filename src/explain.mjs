// explain: how the five agents differ, as text and as JSON, with the basis of every statement (binary: a real run saw it; docs: the
// agent's documentation says so). `explain` is the whole table, `explain <agent>` one column of it with the config paths on each system,
// `explain <agent> <event>` what everyhook prints for each answer at that event.
import { AGENTS, EVENTS, EVENT_INFO } from "./contract.mjs";
import { MODULES, formsOf } from "./agents/index.mjs";
import { ROWS } from "./conformance.mjs";
import { locations } from "./locations.mjs";
import { EFFECTS, translate } from "./translate.mjs";

/** The target of an explain: { agent, event } with null for what was not named. */
export const resolveExplain = (agent, event) => ({ agent: agent || null, event: event || null });

const SAMPLES = [
  ["deny", { decision: "deny", reason: "<reason>", message: "<message>" }],
  ["ask", { decision: "ask", reason: "<reason>" }],
  ["allow", { decision: "allow" }],
  ["context", { context: "<context>" }],
  ["message", { message: "<message>" }],
  ["(no opinion)", {}],
];

/** What everyhook prints at one event for each kind of answer. */
export function eventTable(agent, event) {
  const mod = MODULES[agent];
  return SAMPLES.map(([name, answer]) => {
    const out = translate(mod, event, answer, { hook: "hook.mjs" });
    return { answer: name, native: out.stdout, effect: out.effect, notes: out.notes };
  });
}

const FAKE_HOME = { win32: "C:\\Users\\you", darwin: "/Users/you", linux: "/home/you" };

/** The files an agent reads hooks from, on each system, with <project> for the folder you work in. */
export function pathsTable(agent) {
  const out = {};
  for (const platform of ["win32", "darwin", "linux"]) {
    const env = platform === "win32" ? { USERPROFILE: FAKE_HOME.win32 } : { HOME: FAKE_HOME[platform] };
    const project = platform === "win32" ? "<project>" : "<project>";
    out[platform] = locations(agent, { env, platform, project }).map((l) => ({ scope: l.scope, path: l.file || `${l.dir}${platform === "win32" ? "\\" : "/"}*.json`, format: l.format, install: l.install, crossTool: l.crossTool || null })).map((l) => ({ ...l, path: l.path.replace(/<project>[\\/]/, platform === "win32" ? "<project>\\" : "<project>/") }));
  }
  return out;
}

export function explainJson(target, ctx = {}) {
  const rows = ROWS.map((r) => ({ id: r.id, title: r.title, cells: target.agent ? { [target.agent]: r.cells[target.agent] } : r.cells }));
  const doc = { ok: true, agents: target.agent ? [target.agent] : AGENTS, rows };
  if (target.agent) {
    const mod = MODULES[target.agent];
    doc.agent = target.agent;
    doc.name = mod.name;
    doc.native = mod.NATIVE;
    doc.tools = { names: mod.TOOLS.map(([name, kind]) => ({ name, kind })), patterns: mod.TOOL_PATTERNS.map(([, kind, shown]) => ({ pattern: shown, kind })) };
    doc.paths = pathsTable(target.agent);
    doc.events = Object.fromEntries((target.event ? [target.event] : EVENTS).map((e) => [e, { native: mod.NATIVE[e], info: EVENT_INFO[e], answers: eventTable(target.agent, e) }]));
  }
  return doc;
}

const wrap = (text, width, indent) => {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > width) { lines.push(cur); cur = w; } else cur = `${cur} ${w}`.trim();
  }
  if (cur) lines.push(cur);
  return lines.join(`\n${" ".repeat(indent)}`);
}

export function explainText(target) {
  const lines = [];
  if (!target.agent) {
    lines.push("How the five coding agents differ on hooks. [binary] = a real run of the agent saw it, [docs] = its documentation says so.", "");
    for (const r of ROWS) {
      lines.push(r.title);
      for (const a of AGENTS) lines.push(`  ${a.padEnd(12)} ${`[${r.cells[a].basis}]`.padEnd(8)} ${wrap(r.cells[a].text, 92, 24)}`);
      lines.push("");
    }
    lines.push("Run everyhook explain <agent> for the config paths on each system, and everyhook explain <agent> <event> for what everyhook prints for each answer.");
    return `${lines.join("\n")}\n`;
  }
  const mod = MODULES[target.agent];
  if (!target.event) {
    lines.push(`${mod.name} (${target.agent})`, "");
    for (const r of ROWS) lines.push(`${r.title}`, `  ${`[${r.cells[target.agent].basis}]`.padEnd(8)} ${wrap(r.cells[target.agent].text, 92, 11)}`, "");
    lines.push("Tool names and their kind:");
    for (const [name, kind] of mod.TOOLS) lines.push(`  ${name.padEnd(20)} ${kind}`);
    for (const [, kind, shown] of mod.TOOL_PATTERNS) lines.push(`  ${shown.padEnd(20)} ${kind}`);
    lines.push("  (any other)          other", "");
    lines.push("Files it reads hooks from (<project> is the folder you work in; install writes the ones marked *):");
    const paths = pathsTable(target.agent);
    for (const [platform, label] of [["win32", "Windows"], ["darwin", "macOS"], ["linux", "Linux"]]) {
      lines.push(`  ${label}`);
      for (const p of paths[platform]) lines.push(`    ${p.install ? "*" : " "} ${p.scope.padEnd(8)} ${p.path}${p.crossTool ? `  (a ${p.crossTool} file this agent also reads)` : ""}`);
    }
    lines.push("", `Events: ${EVENTS.map((e) => `${e} = ${mod.NATIVE[e]}`).join(", ")}`);
    return `${lines.join("\n")}\n`;
  }
  const f = formsOf(mod, target.event);
  lines.push(`${mod.name}, ${target.event} (${mod.NATIVE[target.event]}): ${EVENT_INFO[target.event]}`, "", "What everyhook prints for each answer of the hook:");
  for (const row of eventTable(target.agent, target.event)) {
    lines.push(`  ${row.answer.padEnd(13)} ${row.native === null ? "(nothing)" : row.native}`);
    lines.push(`  ${"".padEnd(13)} ${wrap(`${EFFECTS[row.effect] || row.effect}${row.notes.length ? `; ${row.notes.join("; ")}` : ""}`, 90, 16)}`);
  }
  lines.push("", `It can take: ${["deny", "ask", "allow", "context", "message"].filter((k) => f[k] || (k === "message" && f.messageWith)).join(", ") || "nothing"}.`);
  return `${lines.join("\n")}\n`;
}
