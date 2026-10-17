// Shared test helpers: throwaway worlds (a home folder with a config folder for every agent, a project folder), and ways to run the CLI.
//
// SAFETY: nothing here reads or writes the real ~/.claude, ~/.codex, ~/.copilot, ~/.gemini or ~/.cursor. Importing this file points HOME,
// USERPROFILE, APPDATA, LOCALAPPDATA, CLAUDE_CONFIG_DIR, CODEX_HOME, COPILOT_HOME and GEMINI_CLI_HOME of the test process at an empty
// temporary folder, so even a test that forgets to pass its own environment cannot reach them. Every child process gets a world's
// environment, and runCli refuses to run when a home or config folder is outside the OS temp folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "bin", "everyhook.mjs");
export const IS_WIN = process.platform === "win32";
export const NOW = Date.parse("2026-10-17T12:00:00.000Z");

const made = [];
export function tmpDir(prefix = "eh-") {
  // the native real path: on Windows it also turns a short name (RUNNER~1) into the long one, which is what the agents see
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  made.push(dir);
  return dir;
}
process.on("exit", () => { for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* the OS cleans the temp folder eventually */ } } });

/** The variables that point an agent at its folders: all of them are set for every child of a test. */
export function homesOf(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
    CODEX_HOME: path.join(home, ".codex"),
    COPILOT_HOME: path.join(home, ".copilot"),
    GEMINI_CLI_HOME: home,
    // the folders of administrators' files: an empty place, so that a test never reads the machine's
    EVERYHOOK_SYSTEM_DIR: path.join(home, ".no-system-files"),
  };
}

// The guard: an empty home for this process.
const guard = tmpDir("eh-guard-");
export const GUARD = guard;
Object.assign(process.env, homesOf(guard), { NO_COLOR: "1" });
delete process.env.FORCE_COLOR;
// nothing of the machine's agent sessions may leak into a test (this suite is often run from inside Claude Code)
const AGENT_VARS = /^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|CODEX|COPILOT|GEMINI|GOOGLE_GEMINI|CURSOR|OPENAI|EVERYHOOK|E2E_FAKE)/i;
const KEEP = /^(E2E_(CLAUDE|CODEX|GEMINI|COPILOT|GIT_BASH)|CLAUDE_CONFIG_DIR|CODEX_HOME|COPILOT_HOME|GEMINI_CLI_HOME|EVERYHOOK_SYSTEM_DIR)$/;
for (const k of Object.keys(process.env)) if (AGENT_VARS.test(k) && !KEEP.test(k)) delete process.env[k];

const underTmp = (p) => path.resolve(p).toLowerCase().startsWith(fs.realpathSync.native(os.tmpdir()).toLowerCase());

const asText = (v) => (typeof v === "string" ? v : `${JSON.stringify(v, null, 2)}\n`);
export const put = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, asText(v)); return file; };
export const fwd = (p) => String(p).split(path.sep).join("/");
export const read = (file) => fs.readFileSync(file, "utf8");
export const exists = (file) => fs.existsSync(file);

/**
 * A throwaway world on the real disk. base/home is HOME (and USERPROFILE, and GEMINI_CLI_HOME), with .claude, .codex, .copilot,
 * .gemini and .cursor inside it; base/work/proj is the project folder; base/hooks holds hooks.
 */
export function world(name = "w") {
  const base = tmpDir(`eh-${name}-`);
  const home = path.join(base, "home");
  const work = path.join(base, "work", "proj");
  const hooks = path.join(base, "hooks");
  for (const d of [home, work, hooks]) fs.mkdirSync(d, { recursive: true });
  const env = { ...process.env, ...homesOf(home), NO_COLOR: "1" };
  delete env.FORCE_COLOR;
  const w = {
    base, home, work, hooks, env,
    claude: env.CLAUDE_CONFIG_DIR,
    codex: env.CODEX_HOME,
    copilot: env.COPILOT_HOME,
    gemini: path.join(home, ".gemini"),
    cursor: path.join(home, ".cursor"),
    write: (file, v) => put(file, v),
    read: (file) => fs.readFileSync(file, "utf8"),
    exists: (file) => fs.existsSync(file),
    readJson: (file) => JSON.parse(fs.readFileSync(file, "utf8")),
    /** A hook file in base/hooks (an executable script). */
    hook: (name, text) => put(path.join(hooks, name), text),
  };
  return w;
}

/** Copies a folder with everything in it (fs.cpSync is experimental before Node 22). */
export function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(from, e.name), path.join(to, e.name)); else fs.copyFileSync(path.join(from, e.name), path.join(to, e.name));
  }
}

/** Every file under a folder with its bytes, as { relative path: hex digest }, to compare two states of a folder. */
export function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out[path.relative(dir, p).split(path.sep).join("/")] = fs.readFileSync(p).toString("hex");
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}

/** Runs the real CLI in a child process. */
export function runCli(args, { cwd, env, input, timeout = 120000 } = {}) {
  const e = { ...process.env, ...env };
  for (const k of ["HOME", "USERPROFILE", "CLAUDE_CONFIG_DIR", "CODEX_HOME", "COPILOT_HOME", "GEMINI_CLI_HOME"]) {
    if (!underTmp(e[k] || "")) throw new Error(`runCli needs an environment from world(): ${k} must be a temporary folder`);
  }
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd, env: e, input: input ?? "", encoding: "utf8", windowsHide: true, timeout });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "", all: `${r.stdout || ""}${r.stderr || ""}` };
}

/**
 * Runs main() in this process and captures what it prints. `io` entries replace the real machine: { env, cwd, stdin, platform, now }.
 * The environment is the world's when one is given.
 */
export async function run(args, { w, cwd, env, stdin, platform, now = NOW, everyhook } = {}) {
  let out = "";
  let err = "";
  const code = await main(args, {
    env: env || (w ? w.env : process.env),
    cwd: cwd || (w ? w.work : process.cwd()),
    stdin: stdin === undefined ? "" : stdin,
    platform,
    now,
    everyhook,
    stdout: { write: (s) => { out += s; return true; } },
    stderr: { write: (s) => { err += s; return true; } },
  });
  return { code, out, err, all: out + err, json: () => JSON.parse(out) };
}
