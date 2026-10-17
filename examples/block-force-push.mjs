#!/usr/bin/env node
// An everyhook example: deny `git push --force`, `git push -f` and a `+refspec` push to a protected branch, with a reason the model can act on.
//
//   everyhook install examples/block-force-push.mjs --all
//
// The protected branches are main and master; EVERYHOOK_PROTECTED_BRANCHES (a comma-separated list, `*` is a wildcard) replaces them.
// `--force-with-lease` is not blocked. A force push that names no branch pushes the current branch, which is looked up with git in the
// folder of the command; when that fails, the push is denied because the branch is not known.
//
// The contract: this file reads the document on stdin ({ tool: { kind, command }, cwd, ... }) and prints one JSON answer, or nothing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const protectedBranches = (process.env.EVERYHOOK_PROTECTED_BRANCHES || "main,master").split(",").map((s) => s.trim()).filter(Boolean);
const isProtected = (branch) => protectedBranches.some((p) => new RegExp(`^${p.split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(branch));

/** Splits a command line into simple commands (on && || ; | and line breaks outside quotes), each one a list of words without quotes. */
function simpleCommands(line) {
  const commands = [];
  let words = [];
  let word = "";
  let has = false;
  let quote = null;
  const endWord = () => { if (has) words.push(word); word = ""; has = false; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && (line[i + 1] === '"' || line[i + 1] === "\\")) word += line[++i];
      else word += c;
    } else if (c === '"' || c === "'") { quote = c; has = true; } else if (/\s/.test(c)) {
      if (c === "\n") endCommand(); else endWord();
    } else if (c === ";" || c === "|" || c === "&") {
      endCommand();
      if ((c === "&" || c === "|") && line[i + 1] === c) i++;
    } else { word += c; has = true; }
  }
  endCommand();
  return commands;
}

const GLOBAL_WITH_VALUE = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-prefix", "--config-env", "--exec-path"]);
const PUSH_WITH_VALUE = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);

/**
 * The force pushes in a command line: [{ dir, all, branches }]. `branches` is null when the push names none (it then pushes the current
 * branch of `dir`), and has a null in it for `HEAD`.
 */
function forcePushes(line) {
  const found = [];
  for (const command of simpleCommands(line)) {
    let i = 0;
    while (i < command.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(command[i])) i++;
    if (!/^git(\.exe)?$/i.test((command[i] || "").split(/[\\/]/).pop())) continue;
    i++;
    let dir = null;
    while (i < command.length && command[i].startsWith("-")) {
      if (command[i] === "-C") dir = command[i + 1] ?? dir;
      i += GLOBAL_WITH_VALUE.has(command[i]) ? 2 : 1;
    }
    if (command[i] !== "push") continue;
    const words = command.slice(i + 1);
    let force = false;
    let all = false;
    const operands = [];
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (w === "--") { operands.push(...words.slice(k + 1)); break; }
      if (PUSH_WITH_VALUE.has(w)) k++;
      else if (w === "--force" || w === "-f") force = true;
      else if (w === "--all" || w === "--mirror") all = true;
      else if (/^-[A-Za-z]+$/.test(w) && w.slice(1).includes("f")) force = true;
      else if (!w.startsWith("-")) operands.push(w);
    }
    const specs = operands.slice(1); // the first operand is the remote
    const branches = [];
    for (const spec of specs) {
      const plus = spec.startsWith("+");
      if (plus) force = true;
      const body = plus ? spec.slice(1) : spec;
      if (body.startsWith(":")) continue; // a deletion
      const dst = body.includes(":") ? body.split(":").pop() : body;
      branches.push(dst === "HEAD" ? null : dst.replace(/^refs\/heads\//, ""));
    }
    if (force) found.push({ dir, all, branches: specs.length ? branches : null });
  }
  return found;
}

function currentBranch(dir, cwd) {
  const where = dir ? path.resolve(cwd || ".", dir) : cwd || ".";
  const r = spawnSync("git", ["-C", where, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  const name = r.status === 0 ? (r.stdout || "").trim() : "";
  return name && name !== "HEAD" ? name : null;
}

/** The answer for a contract document: { decision: "deny", reason } or null. */
function answerFor(doc) {
  const command = doc && doc.tool && doc.tool.kind === "shell" ? doc.tool.command : null;
  if (typeof command !== "string" || !/git/i.test(command) || !/push/.test(command)) return null;
  for (const push of forcePushes(command)) {
    if (push.all) return { decision: "deny", reason: "Force-pushing every branch is blocked. Push without --force, or ask the person to allow it." };
    let branches = push.branches === null ? [null] : push.branches;
    if (branches.includes(null)) {
      const current = currentBranch(push.dir, doc.cwd);
      if (!current) return { decision: "deny", reason: "A force push that names no branch is blocked because the current branch is not known. Name the branch, and do not force-push main or master." };
      branches = branches.map((b) => b || current);
    }
    const hit = branches.find((b) => isProtected(b));
    if (hit) return { decision: "deny", reason: `Force-pushing the protected branch "${hit}" is blocked. Push without --force, or ask the person to allow it.` };
  }
  return null;
}

let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
let doc = null;
try { doc = JSON.parse(raw); } catch { doc = null; }
const answer = answerFor(doc);
if (answer) fs.writeSync(1, `${JSON.stringify(answer)}\n`);
