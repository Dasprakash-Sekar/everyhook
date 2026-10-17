// Running a hook: the one place in everyhook that starts a program. A hook is any executable: .mjs, .js and .cjs files run with the Node
// that runs everyhook, .ps1 with PowerShell, .sh with bash, .cmd and .bat with cmd.exe on Windows, anything else as it is. The hook reads one
// JSON document on stdin and may print one JSON document on stdout. The hook is stopped when it runs past its time, together with the
// programs it started.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const MAX_BYTES = 10 * 1024 * 1024;
const win = (platform) => platform === "win32";

/** Splits a PATH value the way the platform does. */
const pathList = (env, platform) => String(env.PATH ?? env.Path ?? "").split(win(platform) ? ";" : ":").filter(Boolean);

/** The first file of that name on PATH (with the PATHEXT extensions on Windows), or null. */
export function findOnPath(name, env = process.env, platform = process.platform) {
  const exts = win(platform) ? ["", ...String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  for (const dir of pathList(env, platform)) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext);
      try { if (fs.statSync(file).isFile()) return file; } catch { /* not here */ }
    }
  }
  return null;
}

/** A bash for a .sh hook on Windows: Git Bash, not the WSL launcher in System32 or the Store alias. `exists` is for the tests. */
export function findGitBash(env, exists = fs.existsSync) {
  const P = path.win32;
  for (const dir of pathList(env, "win32")) {
    if (/\\(system32|windowsapps)\\?$/i.test(dir)) continue;
    const file = P.join(dir, "bash.exe");
    if (exists(file)) return file;
    // a Git for Windows folder on PATH is often cmd or mingw64\bin: bash.exe is in bin next to them
    const near = P.join(dir, "..", "bin", "bash.exe");
    if (/\\(cmd|mingw64\\bin|usr\\bin)$/i.test(dir) && exists(near)) return P.normalize(near);
  }
  for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], "C:\\Program Files"]) {
    if (!base) continue;
    const file = P.join(base, "Git", "bin", "bash.exe");
    if (exists(file)) return file;
  }
  return null;
}

/**
 * The program and arguments that run a hook. Returns { file, args, verbatim } or { error }. `verbatim` is true when the argument line is
 * already quoted for cmd.exe.
 */
export function commandFor(hook, hookArgs = [], { env = process.env, platform = process.platform } = {}) {
  const ext = path.extname(hook).toLowerCase();
  if (ext === ".mjs" || ext === ".js" || ext === ".cjs") return { file: process.execPath, args: [hook, ...hookArgs] };
  if (ext === ".ps1") {
    const shell = win(platform) ? "powershell.exe" : "pwsh";
    return { file: shell, args: ["-NoProfile", "-NonInteractive", ...(win(platform) ? ["-ExecutionPolicy", "Bypass"] : []), "-File", hook, ...hookArgs] };
  }
  if (ext === ".sh") {
    if (win(platform)) {
      const bash = findGitBash(env);
      if (!bash) return { error: "a .sh hook needs bash, and no Git Bash was found on PATH or in Program Files" };
      return { file: bash, args: [hook, ...hookArgs] };
    }
    return { file: "bash", args: [hook, ...hookArgs] };
  }
  if (win(platform) && (ext === ".cmd" || ext === ".bat")) {
    const quote = (a) => `"${String(a).replace(/"/g, '""')}"`;
    return { file: env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${[hook, ...hookArgs].map(quote).join(" ")}"`], verbatim: true };
  }
  return { file: hook, args: hookArgs };
}

function killTree(child, platform) {
  try {
    if (win(platform)) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    else process.kill(-child.pid, "SIGKILL");
  } catch { try { child.kill("SIGKILL"); } catch { /* gone */ } }
}

/**
 * Runs a hook with `input` (a string) on its stdin. Resolves { status, code, stdout, stderr, ms, error }:
 *   status "exit"    the hook ran to the end; `code` is its exit code
 *   status "timeout" it was still running after timeoutMs and was stopped
 *   status "error"   it could not be started (or printed more than 10 MiB); `error` says why
 */
export function runHook(hook, hookArgs, input, { timeoutMs = 25000, env = process.env, cwd, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    if (!fs.existsSync(hook)) { resolve({ status: "error", code: null, stdout: "", stderr: "", ms: 0, error: `the hook does not exist: ${hook}` }); return; }
    const cmd = commandFor(hook, hookArgs, { env, platform });
    if (cmd.error) { resolve({ status: "error", code: null, stdout: "", stderr: "", ms: 0, error: cmd.error }); return; }
    let child;
    try {
      child = spawn(cmd.file, cmd.args, { env, cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], detached: !win(platform), ...(cmd.verbatim ? { windowsVerbatimArguments: true } : {}) });
    } catch (e) { resolve({ status: "error", code: null, stdout: "", stderr: "", ms: 0, error: `could not start the hook: ${e.message}` }); return; }
    let stdout = "";
    let stderr = "";
    let size = 0;
    let done = false;
    let timedOut = false;
    let tooBig = false;
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve({ stdout, stderr, ms: Date.now() - started, ...r }); };
    const take = (which) => (chunk) => {
      size += chunk.length;
      if (size > MAX_BYTES) { if (!tooBig) { tooBig = true; killTree(child, platform); } return; }
      if (which === "out") stdout += chunk; else stderr += chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", take("out"));
    child.stderr.on("data", take("err"));
    child.stdin.on("error", () => { /* a hook that does not read its stdin */ });
    child.on("error", (e) => finish({ status: "error", code: null, error: `could not start the hook: ${e.message}` }));
    const ended = (code) => {
      if (timedOut) finish({ status: "timeout", code: null });
      else if (tooBig) finish({ status: "error", code: null, error: "the hook printed more than 10 MiB" });
      else finish({ status: "exit", code });
    };
    child.on("close", ended);
    // a hook that leaves a background program holding its output open: do not wait for that program
    child.on("exit", (code) => { setTimeout(() => ended(code), 300); });
    const timer = setTimeout(() => { timedOut = true; killTree(child, platform); }, timeoutMs);
    try { child.stdin.end(input); } catch { /* the hook is gone */ }
  });
}
