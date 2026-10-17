// Recording what each real agent sends a hook: fixtures/<agent>/*.json. The recording installs examples/log-tool-calls.mjs into the agent
// with `everyhook install --event all`, runs the agent against its fake API with a script that makes it read a file, edit it, write .env, run
// `git push --force origin main` and run a harmless command, and turns the log into one fixture per event and kind of call. The paths of the
// throwaway folder become <project>, <home> and <tmp>. It is also the install check for log-tool-calls: the log exists only because the
// installed entries fired.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, run } from "./helpers.mjs";
import { TESTED } from "./conformance.mjs";
import { agentModule } from "../src/agents/index.mjs";

export const LOG_HOOK = path.join(ROOT, "examples", "log-tool-calls.mjs");

/** The steps of the recording script for a world: a file to read, to edit, .env to write, a force push, a harmless command. */
export function steps(agent, w) {
  const notes = path.join(w.work, "notes.txt");
  // Gemini CLI refuses to read or write a file whose name starts with .env before any hook runs (Path not in workspace), so it gets another name
  const env = path.join(w.work, agent === "gemini-cli" ? "app.env" : ".env");
  const all = [
    { read: notes },
    { edit: { path: notes, old: "old line", new: "new line" } },
    { write: { path: env, content: "SECRET=1\n" } },
    { shell: "git push --force origin main" },
    { shell: "echo harmless" },
  ];
  // Codex CLI has no tool that only reads a file
  return agent === "codex" ? all.filter((s) => !s.read) : all;
}

const scrub = (v, repl) => {
  if (typeof v === "string") { let s = v; for (const [from, to] of repl) s = s.split(from).join(to); return s; }
  if (Array.isArray(v)) return v.map((x) => scrub(x, repl));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x, repl)]));
  return v;
};

/** The variant name of one logged document. */
export function variantOf(doc) {
  if (doc.event === "session-start") return "startup";
  if (doc.event === "prompt") return "prompt";
  if (doc.event === "stop") return "end-turn";
  if (doc.event === "session-end") return "exit";
  const t = doc.tool || {};
  if (t.kind === "shell") return /push\s+--force/.test(t.command || "") ? "shell-force-push" : "shell-harmless";
  if (t.kind === "write") return /(^|[\\/])\.env$/.test(t.path || "") ? "write-env" : "write";
  return t.kind || "other";
}

const summaryOf = (doc) => (doc.tool ? (doc.tool.command || doc.tool.path || doc.tool.name) : doc.prompt || doc.event);

/** Runs the recording for one agent. Returns { agent, version, docs (the logged contract documents), files: { name: fixture } }. */
export async function recordAgent(agent) {
  const mod = TESTED[agent];
  const sb = mod.sandbox("record");
  const log = path.join(sb.base, "everyhook.jsonl");
  fs.writeFileSync(path.join(sb.work, "notes.txt"), "old line\n");
  const api = await mod.fake(steps(agent, sb));
  let r;
  try {
    if (agent === "gemini-cli") sb.write(sb.settings, mod.baseSettings());
    if (agent === "codex") mod.configure(sb, api);
    const i = await run(["install", LOG_HOOK, "--agent", agent, "--event", "all"], { w: sb });
    if (i.code !== 0) throw new Error(`install failed: ${i.all}`);
    const env = { EVERYHOOK_LOG: log };
    if (agent === "claude-code") r = await mod.run(sb, api, { env, timeout: 200000 });
    else if (agent === "codex") r = await mod.run(sb, { env, timeout: 200000 });
    else r = await mod.run(sb, api, { env, timeout: 200000 });
  } finally { await api.close(); }
  const docs = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  const date = new Date().toISOString().slice(0, 10);
  // the slug Claude Code makes of a folder name (every character but letters and digits becomes -) carries the folder name too
  const slug = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
  const repl = [[slug(sb.work), "<project>"], [slug(sb.base), "<tmp>"], [sb.work.replace(/\\/g, "/"), "<project>"], [sb.work, "<project>"], [sb.home.replace(/\\/g, "/"), "<home>"], [sb.home, "<home>"], [sb.base.replace(/\\/g, "/"), "<tmp>"], [sb.base, "<tmp>"]];
  const files = {};
  const seen = new Set();
  for (const doc of docs) {
    const variant = variantOf(doc);
    const name = `${doc.event}.${variant}.json`;
    if (seen.has(name)) continue;
    seen.add(name);
    files[name] = {
      everyhookFixture: 1,
      agent,
      agentVersion: mod.info().number,
      source: "recorded",
      os: `${process.platform} ${process.arch}, ${os.version()} ${os.release()}`,
      node: process.versions.node,
      date,
      event: doc.event,
      nativeEvent: (doc.native && doc.native.hook_event_name) || agentModule(agent).NATIVE[doc.event],
      variant,
      summary: String(scrub(summaryOf(doc), repl)).replace(/\s+/g, " ").slice(0, 120),
      stdin: scrub(doc.native, repl),
    };
  }
  // a fixture is published: it must not carry the name of whoever recorded it
  const user = os.userInfo().username;
  for (const [name, fx] of Object.entries(files)) if (user && JSON.stringify(fx).toLowerCase().includes(user.toLowerCase())) throw new Error(`${agent}/${name} still holds the user name "${user}"`);
  return { agent, version: mod.info().number, code: r.code, ms: r.ms, docs, files, stderr: String(r.err).slice(0, 400) };
}
