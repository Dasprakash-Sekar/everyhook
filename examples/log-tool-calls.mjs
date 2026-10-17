#!/usr/bin/env node
// An everyhook example: append one JSON line per event to the file named in EVERYHOOK_LOG, and let everything through (it prints nothing, which
// is "no opinion": the agent's own permission rules stay in charge).
//
//   EVERYHOOK_LOG=~/everyhook.jsonl everyhook install examples/log-tool-calls.mjs --all --event all
//
// Each line is the contract's document with a time added: { loggedAt, everyhook, agent, event, tool, prompt, cwd, session, transcript, native }.
// A text longer than 8,000 characters is cut (EVERYHOOK_LOG_FULL=1 keeps it whole). Without EVERYHOOK_LOG it does nothing.
//
// The contract: this file reads the document on stdin and prints nothing.
import fs from "node:fs";

const LIMIT = 8000;
const full = process.env.EVERYHOOK_LOG_FULL === "1";
const cut = (v) => {
  if (typeof v === "string") return !full && v.length > LIMIT ? `${v.slice(0, LIMIT)}...[${v.length - LIMIT} more characters]` : v;
  if (Array.isArray(v)) return v.map(cut);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cut(x)]));
  return v;
};

const file = process.env.EVERYHOOK_LOG;
if (file) {
  let raw = "";
  try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
  let doc = null;
  try { doc = JSON.parse(raw); } catch { doc = { unparsed: raw }; }
  fs.appendFileSync(file, `${JSON.stringify({ loggedAt: new Date().toISOString(), ...cut(doc) })}\n`);
}
