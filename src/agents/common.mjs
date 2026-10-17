// What the agent modules share: reading a tool call into the contract's `tool`, and the parts of the answer that every agent shapes alike.
import { KINDS } from "../contract.mjs";

export const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const str = (v) => (typeof v === "string" ? v : undefined);

/** A tool input as an object: an object stays, a JSON string is parsed (Cursor sends MCP input as a string), anything else is {}. */
export function inputOf(v) {
  if (isObject(v)) return v;
  if (typeof v === "string") { try { const p = JSON.parse(v); return isObject(p) ? p : {}; } catch { return {}; } }
  return {};
}

/** A tool result as one string: a string stays; { stdout, stderr } joins; { llmContent } and { textResultForLlm } give their text; the rest is JSON. */
export function outputText(v) {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (isObject(v)) {
    if (typeof v.stdout === "string" || typeof v.stderr === "string") return [str(v.stdout), str(v.stderr)].filter((s) => s).join("\n");
    if (typeof v.llmContent === "string") return v.llmContent;
    if (typeof v.textResultForLlm === "string") return v.textResultForLlm;
  }
  try { return JSON.stringify(v); } catch { return String(v); }
}

/** The kind of a tool name: from the agent's table of exact names, then its patterns; "other" for the rest. */
export function kindOf(table, patterns, name) {
  for (const [n, kind] of table) if (n === name) return kind;
  for (const [re, kind] of patterns) if (re.test(String(name))) return kind;
  return "other";
}

/**
 * The contract's `tool` of one call. `pick` says where this agent keeps the paths: pick(input) returns an array of paths (the first is
 * `path`, all are `paths` when there is more than one).
 */
export function makeTool({ name, input, response, kind, pick }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
  const tool = { name: typeof name === "string" ? name : String(name ?? ""), kind };
  const inp = inputOf(input);
  if (kind === "shell" && typeof inp.command === "string") tool.command = inp.command;
  if (kind === "edit" || kind === "write" || kind === "read") {
    const paths = (pick ? pick(inp) : []).filter((p) => typeof p === "string" && p !== "");
    if (paths.length) { tool.path = paths[0]; if (paths.length > 1) tool.paths = paths; }
  }
  tool.input = inp;
  const out = outputText(response);
  if (out !== undefined) tool.output = out;
  return tool;
}

/** The files an apply_patch patch (Codex) touches, and whether it only adds files. */
export function patchFiles(patch) {
  const files = [];
  let adds = 0;
  let others = 0;
  for (const line of String(patch || "").split(/\r?\n/)) {
    const m = /^\*\*\* (Add|Update|Delete) File: (.+)$/.exec(line);
    if (m) { files.push(m[2].trim()); if (m[1] === "Add") adds++; else others++; continue; }
    const mv = /^\*\*\* Move to: (.+)$/.exec(line);
    if (mv) { files.push(mv[1].trim()); others++; }
  }
  return { files, onlyAdds: adds > 0 && others === 0 };
}

/** Merges the pieces of a native answer: objects are merged key by key, so two pieces can both put something under hookSpecificOutput. */
export function mergeParts(...parts) {
  const out = {};
  for (const part of parts) {
    if (!part) continue;
    for (const [k, v] of Object.entries(part)) out[k] = isObject(v) && isObject(out[k]) ? mergeParts(out[k], v) : v;
  }
  return out;
}
