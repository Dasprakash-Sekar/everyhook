// One session of a real agent in a world, whichever agent it is: prepare its configuration for the fake API, and run it.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT, copyDir } from "./helpers.mjs";
import { TESTED } from "./conformance.mjs";

/** Writes what the agent needs to talk to the fake API (Codex's config.toml, Gemini CLI's sign-in), leaving the hooks to install. */
export function prepare(agent, sb, api) {
  const mod = TESTED[agent];
  if (agent === "gemini-cli") sb.write(sb.settings, mod.baseSettings());
  if (agent === "codex") mod.configure(sb, api);
}

/** Runs the agent. `permissions` is for Claude Code (its flags), `trust` for Codex (--dangerously-bypass-hook-trust). */
export function go(agent, sb, api, { env = {}, prompt, timeout = 240000, permissions, trust = true } = {}) {
  const mod = TESTED[agent];
  const base = { env, timeout, ...(prompt ? { prompt } : {}) };
  if (agent === "claude-code") return mod.run(sb, api, { ...base, ...(permissions ? { args: permissions } : {}) });
  if (agent === "codex") return mod.run(sb, { ...base, trust });
  return mod.run(sb, api, base);
}

/** A copy of everyhook (bin, src, package.json) in a folder with a space in its name, so that every install is also a quoting test. */
export function copyEveryhook(w) {
  const copy = path.join(w.base, "every hook");
  for (const d of ["bin", "src"]) copyDir(path.join(ROOT, d), path.join(copy, d));
  fs.copyFileSync(path.join(ROOT, "package.json"), path.join(copy, "package.json"));
  return path.join(copy, "bin", "everyhook.mjs");
}

/** Copies a hook into a folder with a space in its name and returns the copy. */
export function copyHook(w, source, name = path.basename(source)) {
  const dir = path.join(w.base, "my hooks");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.copyFileSync(source, file);
  return file;
}

/** Runs `everyhook <args>` as the copy of the CLI at `bin`, for the world; returns { code, out, err }. */
export async function everyhook(w, bin, args) {
  const r = spawnSync(process.execPath, [bin, ...args], { env: w.env, cwd: w.work, encoding: "utf8", windowsHide: true, timeout: 120000 });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}

