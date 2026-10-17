// GitHub Copilot CLI against a fake OpenAI-style provider (the recipe of 17 October 2026): COPILOT_OFFLINE with a bring-your-own-key provider
// pointed at 127.0.0.1, COPILOT_HOME in a temporary folder, `copilot -p ... --allow-all-tools -s`. E2E_COPILOT names the binary. No GitHub
// login is needed. A script of steps says what the "model" does, one tool call per turn: { shell }, { write }, { edit }, { read }, { text }.
import path from "node:path";
import { IS_WIN, world } from "./helpers.mjs";
import { binInfo, fakeServer, launch, resolveBin, scrubbedEnv, sse, textOf } from "./sandbox.mjs";

export const id = "copilot-cli";
export const label = "GitHub Copilot CLI";
export const envName = "E2E_COPILOT";
export const BIN = resolveBin(process.env.E2E_COPILOT || "");

let cached;
export function info() {
  if (!cached) cached = binInfo(BIN, "a GitHub Copilot CLI binary", envName, { COPILOT_AUTO_UPDATE: "false" });
  return cached;
}
export const skip = () => (info().ok ? false : info().reason);

/** The shell tool of this system's Copilot CLI. */
export const SHELL_TOOL = IS_WIN ? "powershell" : "bash";

/** A step of the script as the tool call Copilot CLI understands (names of the tools in its first request). */
export function callFor(step, tools) {
  const names = tools || [];
  const shell = names.find((t) => /^(powershell|bash)$/i.test(t)) || SHELL_TOOL;
  if (step.shell !== undefined) return { name: shell, args: { command: step.shell, description: "probe" } };
  if (step.write) return { name: "create", args: { path: step.write.path, file_text: step.write.content } };
  if (step.edit) return { name: "edit", args: { path: step.edit.path, old_str: step.edit.old, new_str: step.edit.new } };
  if (step.read) return { name: "view", args: { path: step.read } };
  return null;
}

const toolNamesOf = (body) => (body.tools || []).map((t) => (t.function && t.function.name) || t.name);

/** The fake provider. Returns { port, requests, results(), close() }. */
export async function fake(script = []) {
  const api = await fakeServer((req, body, res, ctx) => {
    if (req.url.includes("/chat/completions")) {
      const done = (body.messages || []).filter((m) => m.role === "tool").length;
      const step = script[done];
      const call = step && callFor(step, toolNamesOf(body));
      const base = { id: `c_${ctx.n}`, object: "chat.completion.chunk", created: 0, model: body.model };
      if (body.stream) {
        const send = sse(res);
        send(null, { ...base, choices: [{ index: 0, delta: call ? { role: "assistant", tool_calls: [{ index: 0, id: `call_${ctx.n}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: "assistant", content: (step && step.text) || "PROBE-DONE" }, finish_reason: null }] });
        send(null, { ...base, choices: [{ index: 0, delta: {}, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });
        send(null, "[DONE]");
        res.end();
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ...base, object: "chat.completion", choices: [{ index: 0, message: call ? { role: "assistant", content: null, tool_calls: [{ id: `call_${ctx.n}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { role: "assistant", content: "PROBE-DONE" }, finish_reason: call ? "tool_calls" : "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
      }
      return;
    }
    if (req.url.includes("/models")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ object: "list", data: [{ id: "gpt-4.1", object: "model" }] })); return; }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `fake API: no route ${req.url}` } }));
  });
  api.results = () => toolResultsOf(api.requests);
  return api;
}

/** The tool results in the newest request that has any: [{ text }] in order. */
export function toolResultsOf(requests) {
  for (let i = requests.length - 1; i >= 0; i--) {
    const out = (requests[i].body.messages || []).filter((m) => m.role === "tool").map((m) => ({ text: textOf(m.content) }));
    if (out.length) return out;
  }
  return [];
}

/** A world for Copilot CLI: COPILOT_HOME with a hooks folder. */
export function sandbox(label = "copilot") {
  const w = world(label);
  w.hooksDir = path.join(w.copilot, "hooks");
  return w;
}

export function envFor(w, api, extra = {}) {
  return scrubbedEnv({
    COPILOT_HOME: w.copilot, HOME: w.home, USERPROFILE: w.home, APPDATA: w.env.APPDATA, LOCALAPPDATA: w.env.LOCALAPPDATA,
    COPILOT_OFFLINE: "true", COPILOT_PROVIDER_BASE_URL: `http://127.0.0.1:${api.port}/v1`, COPILOT_PROVIDER_TYPE: "openai", COPILOT_PROVIDER_WIRE_API: "completions",
    COPILOT_PROVIDER_API_KEY: "fake", COPILOT_MODEL: "gpt-4.1", COPILOT_PROVIDER_MAX_PROMPT_TOKENS: "100000", COPILOT_PROVIDER_MAX_OUTPUT_TOKENS: "4000",
    COPILOT_ALLOW_ALL: "true", COPILOT_AUTO_UPDATE: "false", NO_COLOR: "1",
    ...extra,
  });
}

/** Runs `copilot -p`. Resolves { code, out, err, ms }. */
export function run(w, api, { prompt = "hello", args = [], env = {}, timeout = 120000 } = {}) {
  return launch(BIN, ["-p", prompt, "--allow-all-tools", "-s", "-C", w.work, ...args], { env: envFor(w, api, env), cwd: w.work, timeout });
}
