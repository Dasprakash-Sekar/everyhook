// The words and the JSON of every command's report. Plain sentences, no colour, no emoji.
import path from "node:path";

const indent = (text, n = 2) => text.split("\n").map((l) => (l ? " ".repeat(n) + l : l)).join("\n");
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - String(s).length));
const home = (p, env) => {
  const h = env && (env.USERPROFILE || env.HOME);
  return h && String(p).toLowerCase().startsWith(String(h).toLowerCase()) ? `~${String(p).slice(String(h).length)}` : String(p);
};
const sec = (t) => (t ? `${t.value} ${t.unit}` : "-");

// ---- install, uninstall, restore ------------------------------------------------------------------------------

export function installJson(plan, ctx) {
  return {
    ok: plan.results.every((r) => r.action !== "refused"),
    dryRun: ctx.dryRun,
    hook: ctx.hook,
    scope: ctx.scope,
    results: plan.results.map((r) => ({
      agent: r.agent, scope: r.scope, file: r.file, action: r.action, backup: r.backup || null, refused: r.refused,
      entries: r.entries.map((e) => ({ event: e.event, native: e.native, matcher: e.matcher, timeout: e.timeout, can: e.can })),
      notes: r.notes,
    })),
    needs: ctx.needs,
  };
}

export function installText(plan, ctx) {
  const lines = [`everyhook install ${path.basename(ctx.hook)} (${ctx.scope} scope)${ctx.dryRun ? ", dry run: nothing is written" : ""}`, ""];
  for (const r of plan.results) {
    const verb = r.action === "created" ? (ctx.dryRun ? "would create" : "created") : r.action === "updated" ? (ctx.dryRun ? "would update" : "updated") : r.action === "unchanged" ? "unchanged (already installed)" : "refused";
    lines.push(`${pad(r.agent, 12)} ${verb}  ${r.file || "-"}`);
    if (r.refused) lines.push(indent(r.refused, 2));
    for (const e of r.entries) lines.push(`  ${pad(e.event, 14)} ${pad(e.native, 20)}${e.matcher ? ` matcher ${e.matcher}` : ""}  ${e.can.join(", ")}`);
    for (const n of r.notes) lines.push(`  note: ${n}`);
    if (r.backup) lines.push(`  backup: ${r.backup}`);
  }
  if (ctx.needs.length) {
    lines.push("", "Still to do:");
    for (const n of ctx.needs) lines.push(`  ${n}`);
  }
  return `${lines.join("\n")}\n`;
}

export function uninstallJson(plan, ctx) {
  return {
    ok: plan.results.every((r) => r.action !== "refused"),
    dryRun: ctx.dryRun,
    hook: ctx.hook,
    scope: ctx.scope,
    removed: plan.results.reduce((n, r) => n + r.removed, 0),
    results: plan.results.map((r) => ({ agent: r.agent, scope: r.scope, file: r.file, action: r.action, removed: r.removed, backup: r.backup || null, restoredFrom: r.restoredFrom, refused: r.refused, notes: r.notes })),
  };
}

export function uninstallText(plan, ctx) {
  const lines = [`everyhook uninstall ${path.basename(ctx.hook)} (${ctx.scope} scope)${ctx.dryRun ? ", dry run: nothing is written" : ""}`, ""];
  for (const r of plan.results) {
    const verb = r.action === "removed" ? `${ctx.dryRun ? "would remove" : "removed"} ${r.removed} ${r.removed === 1 ? "entry" : "entries"}` : r.action === "deleted" ? `${ctx.dryRun ? "would delete the file" : "deleted the file"} (it held only ${r.removed === 1 ? "this entry" : "these entries"})` : r.action === "unchanged" ? "nothing to remove" : "refused";
    lines.push(`${pad(r.agent, 12)} ${verb}  ${r.file || "-"}`);
    if (r.refused) lines.push(indent(r.refused, 2));
    for (const n of r.notes) lines.push(`  ${n}`);
    if (r.backup) lines.push(`  backup: ${r.backup}`);
  }
  return `${lines.join("\n")}\n`;
}

export function restoreJson(res, ctx) {
  return { ok: true, dryRun: ctx.dryRun, scope: ctx.scope, results: res.results };
}

export function restoreText(res, ctx) {
  const lines = [`everyhook restore (${ctx.scope} scope)${ctx.dryRun ? ", dry run: nothing is written" : ""}`, ""];
  for (const r of res.results) {
    if (r.reason) lines.push(`${pad(r.agent, 12)} no backup  ${r.file}`);
    else {
      lines.push(`${pad(r.agent, 12)} ${ctx.dryRun ? "would put back" : "put back"} ${path.basename(r.from)}  ${r.file}`);
      if (r.others) lines.push(`  ${r.others} older ${r.others === 1 ? "backup stays" : "backups stay"}`);
      if (r.savedCurrent) lines.push(`  the file as it was is saved as ${path.basename(r.savedCurrent)}`);
    }
  }
  if (!res.results.length) lines.push("nothing to restore");
  return `${lines.join("\n")}\n`;
}

// ---- list -----------------------------------------------------------------------------------------------------

export function listJson(res) {
  return { ok: res.counts.problems === 0, project: res.project, counts: res.counts, files: res.files.filter((f) => f.status !== "missing"), entries: res.entries };
}

export function listText(res, env) {
  const lines = [];
  const byAgent = new Map();
  for (const f of res.files) if (f.status !== "missing") (byAgent.get(f.agent) || byAgent.set(f.agent, { files: [], entries: [] }).get(f.agent)).files.push(f);
  for (const e of res.entries) (byAgent.get(e.agent) || byAgent.set(e.agent, { files: [], entries: [] }).get(e.agent)).entries.push(e);
  if (!byAgent.size) return "no agent has a hooks file on this machine or in this project\n";
  for (const [agent, g] of byAgent) {
    lines.push(agent);
    const files = new Set([...g.files.map((f) => f.file), ...g.entries.map((e) => e.file)]);
    for (const file of files) {
      const rec = g.files.find((f) => f.file === file);
      const entries = g.entries.filter((e) => e.file === file);
      lines.push(`  ${rec ? rec.scope : entries[0].scope}  ${home(file, env)}${rec && rec.status === "unreadable" ? "  (cannot be read)" : ""}${entries.length ? "" : "  (no hooks)"}`);
      for (const p of rec ? rec.problems : []) lines.push(`    problem: ${p}`);
      for (const e of entries) {
        lines.push(`    ${pad(e.event, 20)}${e.matcher ? ` matcher ${e.matcher}` : ""}  timeout ${sec(e.timeout)}${e.ours ? "  [everyhook]" : ""}${e.type !== "command" ? `  type ${e.type}` : ""}`);
        if (e.command) lines.push(`      ${e.command}`);
        for (const p of e.problems) lines.push(`      problem: ${p}`);
      }
    }
    lines.push("");
  }
  lines.push(`${res.counts.entries} ${res.counts.entries === 1 ? "hook" : "hooks"} in ${res.counts.files} ${res.counts.files === 1 ? "file" : "files"}, ${res.counts.ours} by everyhook; ${res.counts.problems} ${res.counts.problems === 1 ? "problem" : "problems"}`);
  return `${lines.join("\n")}\n`;
}

// ---- bench ----------------------------------------------------------------------------------------------------

export function benchJson(res, ctx) {
  return { ok: res.results.every((r) => !r.error && !r.failure), hook: ctx.hook, failClosed: ctx.failClosed, results: res.results.map((r) => (r.error ? { file: r.file, error: r.error } : { agent: r.agent, version: r.version, source: r.source, os: r.os, date: r.date, event: r.event, variant: r.variant, summary: r.summary, answer: r.answer, effect: r.effect, outcome: r.outcome, notes: r.notes, native: r.native, hook: r.hook })) };
}

export function benchText(res, ctx) {
  const lines = [`everyhook bench ${path.basename(ctx.hook)}${ctx.failClosed ? " (fail closed)" : ""}`];
  let last = "";
  const vw = Math.max(22, ...res.results.filter((x) => !x.error).map((x) => x.variant.length));
  for (const r of res.results) {
    if (r.error) { lines.push("", `${r.file}: ${r.error}`); continue; }
    const head = r.source === "recorded" ? `${r.agent} ${r.version}  recorded ${r.date}, ${r.os}` : `${r.agent}  documented, not recorded`;
    if (head !== last) { lines.push("", head); last = head; }
    lines.push(`  ${pad(r.event, 12)} ${pad(r.variant, vw)} ${pad(r.answer, 14)} ${r.outcome}`);
    lines.push(`      ${r.native.stdout === null ? "(nothing printed)" : r.native.stdout}`);
    if (r.hook && r.hook.stderr && r.hook.exit !== 0) lines.push(`      hook stderr: ${r.hook.stderr}`);
  }
  return `${lines.join("\n")}\n`;
}
