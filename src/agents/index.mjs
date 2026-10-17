// The five agents, by id.
import * as claudeCode from "./claude-code.mjs";
import * as codex from "./codex.mjs";
import * as geminiCli from "./gemini-cli.mjs";
import * as copilotCli from "./copilot-cli.mjs";
import * as cursor from "./cursor.mjs";
import { AGENTS } from "../contract.mjs";

export const MODULES = { "claude-code": claudeCode, codex, "gemini-cli": geminiCli, "copilot-cli": copilotCli, cursor };

/** The module of an agent, or null. */
export const agentModule = (id) => (Object.prototype.hasOwnProperty.call(MODULES, id) ? MODULES[id] : null);

/** The forms (what an agent can take) for an event; Cursor's depend on the native event. */
export function formsOf(mod, event, nativeEvent) {
  const forms = typeof mod.formsFor === "function" ? mod.formsFor(event, nativeEvent) : mod.FORMS[event];
  return forms || {};
}

/** The contract event of a native event name for an agent, or null. */
export function contractEventOf(mod, nativeName) {
  return Object.prototype.hasOwnProperty.call(mod.ALIASES, nativeName) ? mod.ALIASES[nativeName] : null;
}

export { AGENTS };
