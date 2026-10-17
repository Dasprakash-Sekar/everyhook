#!/usr/bin/env node
// An everyhook example: deny edits and writes to `.env` files and to paths you list, with a reason the model can act on.
//
//   everyhook install examples/protect-env-files.mjs --all
//
// Protected: every file named .env or .env.something (not .env.example, .env.sample or .env.template, which are meant to be edited), and
// every path in EVERYHOOK_PROTECT: a list separated by ; on Windows and : elsewhere, like PATH. An entry is a file, a folder (everything under
// it) or a pattern with * (inside a name) and ** (any number of folders); a relative entry is read from the folder the agent works in.
// Only the agent's own edit and write tools are looked at (kinds edit and write, which include Codex's apply_patch): a shell command that
// redirects into a file is not.
//
// The contract: this file reads the document on stdin ({ tool: { kind, path, paths }, cwd, ... }) and prints one JSON answer, or nothing.
import fs from "node:fs";
import path from "node:path";

const WIN = process.platform === "win32";
const norm = (p) => { const s = String(p).replace(/\\/g, "/").replace(/\/+$/, ""); return WIN ? s.toLowerCase() : s; };

const isEnvFile = (p) => {
  const base = path.basename(String(p).replace(/\\/g, "/"));
  return /^\.env(\..+)?$/i.test(base) && !/\.(example|sample|template)$/i.test(base);
};

/** A pattern of EVERYHOOK_PROTECT as a regular expression over normalised paths; a folder also matches everything under it. */
function patternOf(entry, cwd) {
  const abs = path.isAbsolute(entry) || /^[A-Za-z]:[\\/]/.test(entry) ? entry : path.join(cwd || ".", entry);
  const segments = norm(abs).split("/");
  let src = "";
  segments.forEach((seg, i) => {
    const last = i === segments.length - 1;
    if (seg === "**") src += last ? ".*" : "(?:.*/)?"; // any number of folders, also none
    else src += seg.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + (last ? "" : "/");
  });
  return new RegExp(`^${src}(/.*)?$`);
}

function answerFor(doc) {
  const tool = doc && doc.tool;
  if (!tool || (tool.kind !== "edit" && tool.kind !== "write")) return null;
  const cwd = typeof doc.cwd === "string" ? doc.cwd : "";
  const listed = (process.env.EVERYHOOK_PROTECT || "").split(path.delimiter).map((s) => s.trim()).filter(Boolean).map((e) => patternOf(e, cwd));
  const targets = Array.isArray(tool.paths) && tool.paths.length ? tool.paths : tool.path ? [tool.path] : [];
  for (const p of targets) {
    const abs = path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p) ? p : path.join(cwd, p);
    if (isEnvFile(p) || listed.some((re) => re.test(norm(abs)))) {
      return { decision: "deny", reason: `"${path.basename(String(p).replace(/\\/g, "/"))}" is protected and cannot be ${tool.kind === "write" ? "written" : "edited"}. Ask the person to change it, or leave it as it is.` };
    }
  }
  return null;
}

let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
let doc = null;
try { doc = JSON.parse(raw); } catch { doc = null; }
const answer = answerFor(doc);
if (answer) fs.writeSync(1, `${JSON.stringify(answer)}\n`);
