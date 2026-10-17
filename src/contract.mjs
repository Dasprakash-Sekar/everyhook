// The contract between everyhook and a hook: the names of the agents, the events and the kinds of tool; the document a hook reads on
// stdin; and the check of the answer it may print. Nothing here knows an agent: src/agents/*.mjs turn each agent's JSON into this document
// and the answer back into the agent's JSON.
import path from "node:path";

export const CONTRACT_VERSION = 1;
export const AGENTS = ["claude-code", "codex", "gemini-cli", "copilot-cli", "cursor"];
export const EVENTS = ["pre-tool", "post-tool", "prompt", "session-start", "session-end", "stop"];
export const KINDS = ["shell", "edit", "write", "read", "mcp", "other"];
export const DECISIONS = ["allow", "deny", "ask"];

/** What each event is, in one line each (for help and explain). */
export const EVENT_INFO = {
  "pre-tool": "before a tool runs; a hook can block it",
  "post-tool": "after a tool ran",
  prompt: "when the person sends a prompt",
  "session-start": "when a session begins",
  "session-end": "when a session ends",
  stop: "when the agent finishes a turn; a hook can send it back to work",
};

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * Builds the document a hook reads. `parts` come from an agent's normalize(): { tool, prompt, cwd, session, transcript }; `native` is the
 * agent's own JSON, whole. Fields that an event does not have are left out.
 */
export function buildDocument(agent, event, parts, native) {
  const doc = { everyhook: CONTRACT_VERSION, agent, event };
  if (parts.tool) doc.tool = parts.tool;
  if (typeof parts.prompt === "string") doc.prompt = parts.prompt;
  if (typeof parts.cwd === "string") doc.cwd = parts.cwd;
  if (typeof parts.session === "string") doc.session = parts.session;
  if (typeof parts.transcript === "string") doc.transcript = parts.transcript;
  doc.native = native === undefined ? null : native;
  return doc;
}

/**
 * Checks what a hook printed. Returns { ok: true, answer } where answer is { decision?, reason?, message?, context? } (unknown keys are
 * ignored, so that a hook can carry its own), or { ok: false, problem } when the text is not one JSON object of that shape. Empty output
 * is { ok: true, answer: {} }: no opinion.
 */
export function readAnswer(stdout) {
  const raw = typeof stdout === "string" ? stdout.replace(/^﻿/, "").trim() : "";
  if (raw === "") return { ok: true, answer: {}, empty: true };
  let value;
  try { value = JSON.parse(raw); } catch { return { ok: false, problem: "the hook printed text that is not one JSON object" }; }
  if (!isObject(value)) return { ok: false, problem: "the hook printed JSON that is not an object" };
  const answer = {};
  if (value.decision !== undefined) {
    if (!DECISIONS.includes(value.decision)) return { ok: false, problem: `"decision" is ${JSON.stringify(value.decision)}; it must be allow, deny or ask` };
    answer.decision = value.decision;
  }
  for (const key of ["reason", "message", "context"]) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "string") return { ok: false, problem: `"${key}" must be a string` };
    answer[key] = value[key];
  }
  return { ok: true, answer, empty: false };
}

/** The name a hook goes by in messages and in default reasons. */
export const hookName = (hook) => path.basename(String(hook || "hook")).replace(/\.[^.]+$/, "") || "hook";

export const isEvent = (e) => EVENTS.includes(e);
export const isAgent = (a) => AGENTS.includes(a);
