// Running the real agents at zero cost: what every agent's sandbox shares (test/agent-claude.mjs, agent-codex.mjs, agent-gemini.mjs,
// agent-copilot.mjs). An agent runs only when its E2E_* variable (E2E_CLAUDE, E2E_CODEX, E2E_GEMINI, E2E_COPILOT) names its binary
// ("codex" on a CI machine after `npm install -g @openai/codex`, or the full path to codex.cmd). Otherwise the check is skipped, and
// `npm test` needs nothing but Node.
//
// Each agent runs in a throwaway world (a home folder, its config folder, a project folder) with an environment scrubbed of every
// variable of the machine's agent sessions, and with its API pointed at a tiny server on 127.0.0.1 that answers from a script. No
// request leaves the machine, no token is spent, no login is needed. The binary is started with spawn (asynchronous) and with stdin
// ignored: a spawnSync would block the event loop that the fake server lives in, and `-p`-style runs wait for input on an open stdin.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { IS_WIN, tmpDir } from "./helpers.mjs";

/** The binary a check runs: the variable's value as it is when it is a path, else the first command of that name the PATH finds, as a full path. */
export function resolveBin(name) {
  if (!name) return "";
  if (/[\\/]/.test(name)) return name;
  const found = (IS_WIN ? spawnSync("where.exe", [name], { encoding: "utf8", windowsHide: true }) : spawnSync("which", [name], { encoding: "utf8" })).stdout || "";
  const list = found.split(/\r?\n/).filter(Boolean);
  if (!list.length) return name;
  if (IS_WIN) return list.find((f) => /\.(cmd|exe)$/i.test(f)) || list[0];
  return list[0];
}

const viaShell = (bin) => IS_WIN && !/\.exe$/i.test(bin);

/** One argument for a command line that cmd.exe will split. */
export const quote = (a) => (/[\s"&|<>^()%!]/.test(a) || a === "" ? `"${String(a).replace(/"/g, '\\"')}"` : String(a));

function killTree(child) {
  try {
    if (IS_WIN) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/** Runs a binary with stdin ignored. Resolves { code, out, err, ms, timedOut }. */
export function launch(bin, args, { env, cwd, timeout = 120000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = viaShell(bin)
      ? spawn([quote(bin), ...args.map(quote)].join(" "), [], { cwd, env, shell: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      : spawn(bin, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN });
    let out = "";
    let err = "";
    let timedOut = false;
    child.on("error", (e) => { err += String(e); });
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeout);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out, err, ms: Date.now() - started, timedOut }); });
  });
}

/** An environment scrubbed of the machine's agent sessions; `extra` entries win; an undefined value removes a variable (in any case). */
export function scrubbedEnv(extra = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|CLAUDECODE|AI_AGENT|MCP_|ENABLE_TOOL_SEARCH|CODEX|COPILOT|GEMINI|GOOGLE_GEMINI|CURSOR|OPENAI|FAKE_API|EVERYHOOK)/i.test(k) || /^(CLAUDE_CONFIG_DIR|CODEX_HOME|COPILOT_HOME|GEMINI_CLI_HOME)$/.test(k)) env[k] = v;
  for (const [k, v] of Object.entries(extra)) setVar(env, k, v);
  return env;
}

/** Sets a variable whatever the case of an existing spelling (Windows keeps `Path`); an undefined value removes it. */
export function setVar(env, name, value) {
  const lower = String(name).toLowerCase();
  for (const k of Object.keys(env)) if (k.toLowerCase() === lower) delete env[k];
  if (value !== undefined && value !== null) env[name] = value;
  return env;
}

/**
 * A fake API server on 127.0.0.1. handler(req, body, res, ctx) answers; every request is recorded whole in `requests`
 * ({ method, url, headers, body }). Returns { port, requests, close() }.
 */
export function fakeServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw); } catch { /* empty */ }
      const rec = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(rec);
      try { handler(req, body, res, { n: requests.length, requests, rec }); } catch (e) { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: String(e && e.stack ? e.stack : e) } })); }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    resolve({ port: server.address().port, requests, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }) });
  }));
}

export const sse = (res) => {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  return (event, data) => res.write(`${event ? `event: ${event}\n` : ""}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
};

/** Writes a file (an object as JSON, a string as it is), making its folder. */
export function put(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

/** The first Git Bash this machine has, for Claude Code on Windows (its Bash tool needs one). */
export function findGitBash() {
  if (!IS_WIN) return "";
  const fromEnv = process.env.E2E_GIT_BASH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv.replace(/\\/g, "/");
  const where = spawnSync("where.exe", ["git"], { encoding: "utf8", windowsHide: true }).stdout || "";
  const candidates = ["C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"];
  for (const g of where.split(/\r?\n/).filter(Boolean)) candidates.push(path.join(path.dirname(path.dirname(g)), "bin", "bash.exe").replace(/\\/g, "/"), path.join(path.dirname(path.dirname(path.dirname(g))), "bin", "bash.exe").replace(/\\/g, "/"));
  return candidates.find((c) => fs.existsSync(c)) || "";
}

/** { ok, version, number, reason } for a binary: whether it runs and prints a version. */
export function binInfo(bin, label, envName, extraEnv = {}) {
  if (!bin) return { ok: false, version: "", number: "", reason: `${envName} is not set (point it at ${label} to run the checks against the real thing)` };
  const home = tmpDir("eh-e2e-probe-");
  const env = scrubbedEnv({ HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), CODEX_HOME: path.join(home, ".codex"), COPILOT_HOME: path.join(home, ".copilot"), GEMINI_CLI_HOME: home, COPILOT_AUTO_UPDATE: "false", DISABLE_AUTOUPDATER: "1", NO_COLOR: "1", ...extraEnv });
  const r = viaShell(bin)
    ? spawnSync([quote(bin), "--version"].join(" "), { shell: true, encoding: "utf8", timeout: 90000, windowsHide: true, input: "", env })
    : spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 90000, windowsHide: true, input: "", env });
  const version = `${r.stdout || ""}`.trim().split(/\r?\n/).filter((l) => /\d+\.\d+\.\d+/.test(l))[0] || "";
  return r.status === 0 && version ? { ok: true, version, number: (/\d+\.\d+\.\d+/.exec(version) || [""])[0], reason: "" } : { ok: false, version: "", number: "", reason: `${envName} (${bin}) did not run: ${(r.error && r.error.message) || (r.stderr || "").trim().slice(0, 120)}` };
}

/** Pretty one-line text of a tool result as a request carries it, from any of the shapes. */
export function textOf(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(textOf).join("\n");
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (v.content !== undefined) return textOf(v.content);
    if (v.output !== undefined) return textOf(v.output);
    if (v.response !== undefined) return textOf(v.response);
    return JSON.stringify(v);
  }
  return String(v);
}
