// A hook's answer in the contract's words, turned into what one agent understands at one event. The agent modules say what each event can
// take (FORMS); this decides what to print. It prints JSON on stdout and exits 0 in every case: that is the only form that delivers the
// reason on all four recorded binaries and on Windows (exit code 2 does not reach Codex there, and Copilot drops the text).
import { mergeParts } from "./agents/common.mjs";
import { formsOf } from "./agents/index.mjs";
import { hookName } from "./contract.mjs";

/** What an answer does at an event, in one word each (bench prints them; explain describes them). */
export const EFFECTS = {
  blocked: "the action is blocked",
  asked: "the person is asked",
  allowed: "the action is approved",
  feedback: "the reason goes to the model in place of the result",
  continue: "the agent is sent back to work with the reason",
  context: "context is added",
  message: "a message is shown to the person",
  none: "nothing changes",
};

/**
 * Translates `answer` ({ decision?, reason?, message?, context? }) for the agent module `mod` at the contract event `event`.
 * Returns { stdout (JSON text or null), exit: 0, effect, notes: [what was changed or dropped, in words] }.
 */
export function translate(mod, event, answer, { nativeEvent, hook } = {}) {
  const forms = formsOf(mod, event, nativeEvent);
  const notes = [];
  const label = mod.name;
  const a = { ...answer };
  let decision = a.decision;

  if (decision === "ask" && !forms.ask) {
    if (forms.deny) { notes.push(`ask became deny: ${label} cannot ask at ${event}`); decision = "deny"; } else { notes.push(`ask has no effect: ${label} can neither ask nor deny at ${event}`); decision = undefined; }
  }
  if (decision === "deny" && !forms.deny) {
    notes.push(`deny has no effect: ${label} cannot deny at ${event}`);
    // an agent that cannot refuse here can still tell the person
    if (forms.message && !a.message && a.reason) a.message = a.reason;
    decision = undefined;
  }
  if (decision === "allow" && !forms.allow) {
    notes.push(`allow has no effect: ${label} has no approval to give at ${event}`);
    decision = undefined;
  }
  if ((decision === "deny" || decision === "ask") && !a.reason) a.reason = decision === "deny" ? `Blocked by the everyhook hook "${hookName(hook)}".` : `The everyhook hook "${hookName(hook)}" asks you to confirm.`;

  const parts = [];
  let effect = "none";
  if (decision && forms[decision]) {
    parts.push(forms[decision](a));
    effect = decision === "deny" ? (forms.effects && forms.effects.deny) || "blocked" : decision === "ask" ? "asked" : "allowed";
  }
  if (a.context) {
    if (forms.context) { parts.push(forms.context(a)); if (effect === "none") effect = "context"; } else notes.push(`context dropped: ${label} takes no added context at ${event}`);
  }
  if (a.message) {
    if (forms.message) { parts.push(forms.message(a)); if (effect === "none") effect = "message"; } else if (!(forms.messageWith === "deny" && decision === "deny")) notes.push(`message dropped: ${label} shows no message to the person at ${event}`);
  }
  if (!parts.length && forms.neutral) parts.push(forms.neutral(a));
  return { stdout: parts.length ? JSON.stringify(mergeParts(...parts)) : null, exit: 0, effect, notes };
}
