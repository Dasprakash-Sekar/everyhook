// Claude Code against a fake Messages API (the recipe of claude-windows-doctor/test/claude-sandbox.mjs), for the checks that need the real
// binary: E2E_CLAUDE names it. A script of steps says what the "model" does, one tool call per turn: { shell }, { write: { path, content } },
// { edit: { path, old, new } }, { read }, { text }.
import fs from "node:fs";
import path from "node:path";
import { IS_WIN, world } from "./helpers.mjs";
import { binInfo, fakeServer, findGitBash, launch, put, resolveBin, scrubbedEnv, sse, textOf } from "./sandbox.mjs";

export const id = "claude-code";
export const label = "Claude Code";
export const envName = "E2E_CLAUDE";

/** The binary: E2E_CLAUDE as a path, else the first `claude` found. An npm install puts claude.cmd next to the native binary: start that one. */
export function resolveClaude(name = process.env.E2E_CLAUDE || "") {
  const bin = resolveBin(name);
  if (!bin || !IS_WIN || !/\.cmd$/i.test(bin)) return bin;
  const native = path.join(path.dirname(bin), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  return fs.existsSync(native) ? native : bin;
}
export const BIN = resolveClaude();

let cached;
export function info() {
  if (!cached) cached = binInfo(BIN, "a Claude Code binary", envName, { DISABLE_AUTOUPDATER: "1" });
  return cached;
}
export const skip = () => (info().ok ? false : info().reason);

const USAGE = { input_tokens: 1, output_tokens: 1 };
const msgStart = (id, model) => ["message_start", { type: "message_start", message: { id, type: "message", role: "assistant", model: model || "x", content: [], stop_reason: null, usage: USAGE } }];

/** SSE events of an assistant message holding the given blocks: { text } or { tool, input, id }. */
export function message(id, model, blocks) {
  const ev = [msgStart(id, model)];
  blocks.forEach((b, i) => {
    if (b.text !== undefined) {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } }]);
    } else {
      ev.push(["content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: b.id || `toolu_${id}_${i}`, name: b.tool, input: {} } }]);
      ev.push(["content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(b.input) } }]);
    }
    ev.push(["content_block_stop", { type: "content_block_stop", index: i }]);
  });
  ev.push(["message_delta", { type: "message_delta", delta: { stop_reason: blocks.some((b) => b.tool) ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }]);
  ev.push(["message_stop", { type: "message_stop" }]);
  return ev;
}

/** A step of the script as the tool call Claude Code understands. */
export function toolFor(step) {
  if (step.shell !== undefined) return { tool: "Bash", input: { command: step.shell, description: "probe" } };
  if (step.write) return { tool: "Write", input: { file_path: step.write.path, content: step.write.content } };
  if (step.edit) return { tool: "Edit", input: { file_path: step.edit.path, old_string: step.edit.old, new_string: step.edit.new } };
  if (step.read) return { tool: "Read", input: { file_path: step.read } };
  return null;
}

/** The fake Messages API. Returns { port, requests, results(), close() }; results() are the tool results the last request carried, in order. */
export async function fake(script = []) {
  const api = await fakeServer((req, body, res, ctx) => {
    if (!req.url.includes("/v1/messages")) { res.writeHead(404, { "content-type": "application/json" }); res.end("{}"); return; }
    if (body.stream === false) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: `msg_${ctx.n}`, type: "message", role: "assistant", model: body.model || "x", content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage: USAGE }));
      return;
    }
    const turn = (body.messages || []).filter((m) => m.role === "assistant").length;
    const step = script[turn];
    const call = step && toolFor(step);
    const events = call ? message(`msg_${ctx.n}`, body.model, [{ tool: call.tool, id: `toolu_${turn}`, input: call.input }]) : message(`msg_${ctx.n}`, body.model, [{ text: (step && step.text) || "PROBE-DONE" }]);
    const send = sse(res);
    for (const [ev, data] of events) send(ev, data);
    res.end();
  });
  api.results = () => toolResultsOf(api.requests);
  return api;
}

/** The tool results in the newest request that has any: [{ text, error }] in order. */
export function toolResultsOf(requests) {
  for (let i = requests.length - 1; i >= 0; i--) {
    const out = [];
    for (const m of requests[i].body.messages || []) {
      if (m.role !== "user" || !Array.isArray(m.content)) continue;
      for (const b of m.content) if (b.type === "tool_result") out.push({ text: textOf(b.content), error: !!b.is_error });
    }
    if (out.length) return out;
  }
  return [];
}

/** A world for Claude Code: the config folder already onboarded and the project trusted. */
export function sandbox(label = "claude") {
  const w = world(label);
  const trust = { hasTrustDialogAccepted: true, allowedTools: [] };
  put(path.join(w.claude, ".claude.json"), { hasCompletedOnboarding: true, projects: { [w.work]: trust, [w.work.replace(/\\/g, "/")]: trust } });
  w.settings = path.join(w.claude, "settings.json");
  return w;
}

/** The environment of a run: scrubbed, the fake API as the endpoint, no updates and no telemetry. */
export function envFor(w, api, extra = {}) {
  const gitBash = findGitBash();
  return scrubbedEnv({
    CLAUDE_CONFIG_DIR: w.claude, HOME: w.home, USERPROFILE: w.home, APPDATA: w.env.APPDATA, LOCALAPPDATA: w.env.LOCALAPPDATA,
    ANTHROPIC_API_KEY: "sk-ant-probe", ANTHROPIC_BASE_URL: `http://127.0.0.1:${api.port}`,
    DISABLE_AUTOUPDATER: "1", DISABLE_TELEMETRY: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1", NO_COLOR: "1",
    ...(IS_WIN ? { CLAUDE_CODE_USE_POWERSHELL_TOOL: "0", ...(gitBash ? { CLAUDE_CODE_GIT_BASH_PATH: gitBash } : {}) } : {}),
    ...extra,
  });
}

/**
 * Runs `claude -p` in the world's project folder. Resolves { code, out, err, ms, result } (result: the --output-format json document).
 * `args` replace the default permission flags.
 */
export async function run(w, api, { prompt = "PROBE-MAIN hello", args, env = {}, timeout = 150000 } = {}) {
  const flags = args || ["--permission-mode", "bypassPermissions"];
  const r = await launch(BIN, ["-p", prompt, "--output-format", "json", "--max-turns", "20", ...flags], { env: envFor(w, api, env), cwd: w.work, timeout });
  let result = null;
  try { result = JSON.parse(r.out); } catch { /* not json */ }
  return { ...r, result };
}
