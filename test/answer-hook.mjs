// An everyhook hook for the real-binary checks: it answers what the document asks for. At pre-tool and at prompt the first ANSWER-<kind> in
// the document picks the answer; at post-tool the first POST-<kind>; at session-start the kind in EH_SESSION_START; at stop the kind in
// EH_STOP. Every call is logged to EH_LOG as { event, kind, agent }. The kinds: deny, ask, allow, context, message, exit2, exit1,
// postdeny, postcontext, invalid, slow, none, stop-once (deny once, unless the agent says this stop was already sent back).
import fs from "node:fs";

// `node --test` also runs every file under test/: without EH_LOG this is not a hook run, so do nothing (reading stdin would block)
if (!process.env.EH_LOG) process.exit(0);

let raw = "";
try { raw = fs.readFileSync(0, "utf8"); } catch { raw = ""; }
let doc = {};
try { doc = JSON.parse(raw); } catch { doc = {}; }

const pick = (re) => (re.exec(raw) || [])[1];
let kind = "none";
if (doc.event === "pre-tool" || doc.event === "prompt") kind = pick(/ANSWER-([a-z0-9]+(?:-[a-z0-9]+)*)/) || "none";
else if (doc.event === "post-tool") kind = pick(/POST-([a-z0-9]+(?:-[a-z0-9]+)*)/) || "none";
else if (doc.event === "session-start") kind = process.env.EH_SESSION_START || "none";
else if (doc.event === "stop") kind = process.env.EH_STOP || "none";
fs.appendFileSync(process.env.EH_LOG, `${JSON.stringify({ event: doc.event, kind, agent: doc.agent, cmd: (doc.tool && doc.tool.command) || doc.prompt || null, stopActive: !!(doc.native && doc.native.stop_hook_active) })}\n`);

const out = (o) => fs.writeSync(1, JSON.stringify(o));
switch (kind) {
  case "deny": out({ decision: "deny", reason: "REASON-deny", message: "MSG-deny" }); break;
  case "postdeny": out({ decision: "deny", reason: "REASON-post" }); break;
  case "postcontext": out({ context: "CTX-post" }); break;
  case "ask": out({ decision: "ask", reason: "REASON-ask" }); break;
  case "allow": out({ decision: "allow" }); break;
  case "context": out({ context: "CTX-answer" }); break;
  case "message": out({ message: "MSG-answer" }); break;
  case "exit2": fs.writeSync(2, "REASON-exit2"); process.exitCode = 2; break;
  case "exit1": fs.writeSync(2, "REASON-exit1"); process.exitCode = 1; break;
  case "invalid": fs.writeSync(1, "not json at all"); break;
  case "slow": await new Promise((r) => setTimeout(r, 20000)); break;
  case "stop-once": if (!(doc.native && doc.native.stop_hook_active)) out({ decision: "deny", reason: "STOP-AGAIN" }); break;
  default: break;
}
