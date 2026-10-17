// Codex CLI against a fake Responses API (the recipe of 17 October 2026): CODEX_HOME in a temporary folder, a config.toml that points a
// model provider at 127.0.0.1, `codex exec --json`. E2E_CODEX names the binary. A script of steps says what the "model" does, one tool
// call per turn: { shell }, { write: { path, content } }, { edit: { path, old, new } }, { text }.
import path from "node:path";
import { world } from "./helpers.mjs";
import { binInfo, fakeServer, launch, put, resolveBin, scrubbedEnv, sse, textOf } from "./sandbox.mjs";

export const id = "codex";
export const label = "Codex CLI";
export const envName = "E2E_CODEX";
export const BIN = resolveBin(process.env.E2E_CODEX || "");

let cached;
export function info() {
  if (!cached) cached = binInfo(BIN, "a Codex CLI binary", envName);
  return cached;
}
export const skip = () => (info().ok ? false : info().reason);

const USAGE = { input_tokens: 1, output_tokens: 1, total_tokens: 2 };

/** A patch in the format of apply_patch. */
export function patchFor(step) {
  if (step.write) return `*** Begin Patch\n*** Add File: ${step.write.path}\n${step.write.content.split("\n").filter((l, i, a) => i < a.length - 1 || l !== "").map((l) => `+${l}`).join("\n")}\n*** End Patch\n`;
  if (step.edit) return `*** Begin Patch\n*** Update File: ${step.edit.path}\n@@\n-${step.edit.old}\n+${step.edit.new}\n*** End Patch\n`;
  return "";
}

/** The output item for a step: a function call, or a custom (freeform) tool call, as the request's tool definitions say. */
export function itemFor(step, n, tools) {
  if (step.shell !== undefined) return { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: "exec_command", arguments: JSON.stringify({ cmd: step.shell }), status: "completed" };
  if (step.write || step.edit) {
    const def = (tools || []).find((t) => t.name === "apply_patch");
    const patch = patchFor(step);
    if (def && def.type === "custom") return { type: "custom_tool_call", id: `ct_${n}`, call_id: `call_${n}`, name: "apply_patch", input: patch, status: "completed" };
    return { type: "function_call", id: `fc_${n}`, call_id: `call_${n}`, name: "apply_patch", arguments: JSON.stringify({ input: patch }), status: "completed" };
  }
  return null;
}

/** The fake Responses API. Returns { port, requests, results(), close() }. */
export async function fake(script = []) {
  const api = await fakeServer((req, body, res, ctx) => {
    if (!req.url.includes("/responses")) { res.writeHead(404, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: `fake API: no route ${req.url}` } })); return; }
    const done = (body.input || []).filter((i) => i.type === "function_call_output" || i.type === "custom_tool_call_output").length;
    const step = script[done];
    const item = step && itemFor(step, ctx.n, body.tools);
    const send = sse(res);
    send("response.created", { type: "response.created", response: { id: `resp_${ctx.n}`, status: "in_progress", output: [] } });
    const out = item || { type: "message", id: `msg_${ctx.n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: (step && step.text) || "PROBE-DONE", annotations: [] }] };
    send("response.output_item.added", { type: "response.output_item.added", output_index: 0, item: out });
    if (!item) send("response.output_text.delta", { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: out.content[0].text });
    send("response.output_item.done", { type: "response.output_item.done", output_index: 0, item: out });
    send("response.completed", { type: "response.completed", response: { id: `resp_${ctx.n}`, status: "completed", output: [out], usage: USAGE } });
    res.end();
  });
  api.results = () => toolResultsOf(api.requests);
  return api;
}

/** The tool results in the newest request that has any: [{ text }] in order. */
export function toolResultsOf(requests) {
  for (let i = requests.length - 1; i >= 0; i--) {
    const out = (requests[i].body.input || []).filter((x) => x.type === "function_call_output" || x.type === "custom_tool_call_output").map((x) => ({ text: textOf(x.output) }));
    if (out.length) return out;
  }
  return [];
}

/** A world for Codex: CODEX_HOME/config.toml with the fake provider (the port is filled in by configure). */
export function sandbox(label = "codex") {
  const w = world(label);
  w.configToml = path.join(w.codex, "config.toml");
  w.hooksJson = path.join(w.codex, "hooks.json");
  return w;
}

/** Writes config.toml: the fake provider, no approvals, no sandbox, and `extra` TOML after it (inline hooks, for instance). */
export function configure(w, api, extra = "") {
  put(w.configToml, [
    'model = "gpt-5.5"',
    'model_provider = "fake"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
    "",
    "[model_providers.fake]",
    'name = "fake"',
    `base_url = "http://127.0.0.1:${api.port}/v1"`,
    'env_key = "FAKE_API_KEY"',
    'wire_api = "responses"',
    "",
    extra,
  ].join("\n"));
}

export function envFor(w, extra = {}) {
  return scrubbedEnv({ CODEX_HOME: w.codex, HOME: w.home, USERPROFILE: w.home, APPDATA: w.env.APPDATA, LOCALAPPDATA: w.env.LOCALAPPDATA, FAKE_API_KEY: "fake", NO_COLOR: "1", ...extra });
}

/** Runs `codex exec --json`; hooks are trusted for the run (--dangerously-bypass-hook-trust) unless trust: false. Resolves { code, out, err, ms, events }. */
export async function run(w, { prompt = "hello", args = [], env = {}, trust = true, timeout = 120000 } = {}) {
  const r = await launch(BIN, ["exec", "--skip-git-repo-check", ...(trust ? ["--dangerously-bypass-hook-trust"] : []), "-C", w.work, "--json", ...args, prompt], { env: envFor(w, env), cwd: w.work, timeout });
  const events = [];
  for (const line of r.out.split(/\r?\n/)) { try { events.push(JSON.parse(line)); } catch { /* not an event */ } }
  return { ...r, events };
}
