// Gemini CLI against a fake Gemini API (the recipe of 17 October 2026): GEMINI_API_KEY and GOOGLE_GEMINI_BASE_URL pointed at 127.0.0.1, a
// home folder with .gemini/settings.json, `gemini -p ... --yolo --skip-trust --output-format json`. E2E_GEMINI names the binary. The CLI
// asks a "utility_router" role to classify the request before the main turn: the fake answers any request that wants JSON with a document
// built from the schema it sends, so the router succeeds at once (a reply that is not JSON makes the CLI retry for about 90 seconds).
// A script of steps says what the "model" does, one tool call per turn: { shell }, { write: { path, content } }, { edit }, { read }, { text }.
import path from "node:path";
import { world } from "./helpers.mjs";
import { binInfo, fakeServer, launch, put, resolveBin, scrubbedEnv, sse, textOf } from "./sandbox.mjs";

export const id = "gemini-cli";
export const label = "Gemini CLI";
export const envName = "E2E_GEMINI";
export const BIN = resolveBin(process.env.E2E_GEMINI || "");

let cached;
export function info() {
  if (!cached) cached = binInfo(BIN, "a Gemini CLI binary", envName, { GEMINI_CLI_NO_RELAUNCH: "1" });
  return cached;
}
export const skip = () => (info().ok ? false : info().reason);

/** A value that satisfies a JSON schema (types in either case), for the requests that want JSON back. */
export function fromSchema(s) {
  if (!s || typeof s !== "object") return {};
  const t = String(s.type || (s.properties ? "object" : "")).toLowerCase();
  if (Array.isArray(s.enum) && s.enum.length) return s.enum[0];
  if (t === "object" || s.properties) { const o = {}; for (const [k, v] of Object.entries(s.properties || {})) o[k] = fromSchema(v); return o; }
  if (t === "array") return [];
  if (t === "number" || t === "integer") return 1;
  if (t === "boolean") return false;
  return "x";
}

/** A step of the script as the tool call Gemini CLI understands. */
export function callFor(step) {
  if (step.shell !== undefined) return { name: "run_shell_command", args: { command: step.shell, description: "probe" } };
  if (step.write) return { name: "write_file", args: { file_path: step.write.path, content: step.write.content } };
  if (step.edit) return { name: "replace", args: { file_path: step.edit.path, instruction: "probe", old_string: step.edit.old, new_string: step.edit.new } };
  if (step.read) return { name: "read_file", args: { file_path: step.read } };
  return null;
}

const chunk = (part, usage = true) => ({ candidates: [{ content: { role: "model", parts: [part] }, finishReason: "STOP", index: 0 }], ...(usage ? { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } } : {}), modelVersion: "fake" });

/** The fake Gemini API. Returns { port, requests, mainRequests(), results(), close() }. */
export async function fake(script = []) {
  const api = await fakeServer((req, body, res, ctx) => {
    const url = req.url;
    if (url.includes(":countTokens")) { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ totalTokens: 1 })); return; }
    const gc = body.generationConfig || {};
    const wantsJson = gc.responseMimeType === "application/json" || gc.responseJsonSchema || gc.responseSchema;
    if (url.includes(":streamGenerateContent")) {
      const done = countResponses(body);
      const step = script[done];
      const call = step && callFor(step);
      const send = sse(res);
      send(null, chunk(call ? { functionCall: call } : { text: (step && step.text) || "PROBE-DONE" }));
      res.end();
      return;
    }
    if (url.includes(":generateContent")) {
      const text = wantsJson ? JSON.stringify(fromSchema(gc.responseJsonSchema || gc.responseSchema)) : "PROBE-DONE";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(chunk({ text })));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: `fake API: no route ${url}` } }));
  });
  api.mainRequests = () => api.requests.filter((r) => r.url.includes(":streamGenerateContent"));
  api.results = () => toolResultsOf(api.requests);
  return api;
}

const countResponses = (body) => (body.contents || []).reduce((n, c) => n + (c.parts || []).filter((p) => p.functionResponse).length, 0);

/** The tool results in the newest request that has any: [{ text }] in order. */
export function toolResultsOf(requests) {
  for (let i = requests.length - 1; i >= 0; i--) {
    const out = [];
    for (const c of requests[i].body.contents || []) for (const p of c.parts || []) if (p.functionResponse) out.push({ text: textOf(p.functionResponse.response) });
    if (out.length) return out;
  }
  return [];
}

/** A world for Gemini CLI: <home>/.gemini/settings.json, which `configure` fills. */
export function sandbox(label = "gemini") {
  const w = world(label);
  w.settings = path.join(w.gemini, "settings.json");
  return w;
}

/** The settings of a run: the API key as the sign-in, no statistics, and `extra` keys (hooks) merged at the top level. */
export function baseSettings(extra = {}) {
  return { security: { auth: { selectedType: "gemini-api-key" } }, privacy: { usageStatisticsEnabled: false }, general: { previewFeatures: false }, ...extra };
}

// GITHUB_SHA and SURFACE are removed: with either set (a GitHub Actions run) Gemini CLI starts hooks and tools with a short list of environment
// variables, so that the hook would not get EH_LOG; the one test about that (test/e2e-adapter.test.mjs) puts GITHUB_SHA back on purpose.
export function envFor(w, api, extra = {}) {
  return scrubbedEnv({
    HOME: w.home, USERPROFILE: w.home, GEMINI_CLI_HOME: w.home, APPDATA: w.env.APPDATA, LOCALAPPDATA: w.env.LOCALAPPDATA,
    GEMINI_API_KEY: "fake", GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${api.port}`, GEMINI_CLI_TRUST_WORKSPACE: "true", GEMINI_CLI_NO_RELAUNCH: "1", NO_BROWSER: "1", NO_COLOR: "1", GITHUB_SHA: undefined, SURFACE: undefined,
    ...extra,
  });
}

/** Runs `gemini -p`. Resolves { code, out, err, ms, result } (result: the --output-format json document). */
export async function run(w, api, { prompt = "hello", args = [], env = {}, timeout = 170000 } = {}) {
  const r = await launch(BIN, ["-p", prompt, "--yolo", "--skip-trust", "--output-format", "json", ...args], { env: envFor(w, api, env), cwd: w.work, timeout });
  let result = null;
  try { result = JSON.parse(r.out.slice(r.out.indexOf("{"))); } catch { /* not json */ }
  return { ...r, result };
}
