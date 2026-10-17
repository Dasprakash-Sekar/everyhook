// The hooks of one JSON file, in the layout an agent keeps them in (src/agents/*.mjs LAYOUT): reading every handler, adding one and taking
// one out by editing the text (src/jsonedit.mjs), so that the rest of the file does not move.
//
// "grouped": { "hooks": { "<Event>": [ { "matcher": "...", "hooks": [ handler ] } ] } }   Claude Code, Codex CLI, Gemini CLI
// "flat":    { "hooks": { "<event>": [ handler ] } }                                      Copilot CLI, Cursor
import { findMember, insertItem, insertMember, parseTree, removeElement, styleOf } from "./jsonedit.mjs";

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export class Refusal extends Error {}

/** Strips a byte-order mark; the text is otherwise untouched. */
const body = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

/**
 * Reads a file's text. Returns { ok: true, value, entries, problems } or { ok: false, problem }. An entry is
 * { event, matcher, handler, group } with `group` the matcher group (grouped layouts) or null. A problem is a sentence about the file's
 * structure ("hooks.BeforeTool is not an array") that the agent would trip over.
 */
export function readHooks(text, layout) {
  let value;
  try { value = JSON.parse(body(text)); } catch (e) { return { ok: false, problem: `not valid JSON: ${e.message}` }; }
  if (!isObject(value)) return { ok: false, problem: "the top level is not a JSON object" };
  const entries = [];
  const problems = [];
  const hooks = value[layout.root[0]];
  if (hooks === undefined) return { ok: true, value, entries, problems };
  if (!isObject(hooks)) return { ok: true, value, entries, problems: [`"${layout.root[0]}" is not an object`] };
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) { problems.push(`${layout.root[0]}.${event} is not an array (it is ${list === null ? "null" : typeof list})`); continue; }
    list.forEach((item, i) => {
      if (layout.shape === "grouped") {
        if (!isObject(item)) { problems.push(`${layout.root[0]}.${event}[${i}] is not an object`); return; }
        if (!Array.isArray(item.hooks)) { problems.push(`${layout.root[0]}.${event}[${i}] has no "hooks" array`); return; }
        item.hooks.forEach((handler, j) => {
          if (!isObject(handler)) { problems.push(`${layout.root[0]}.${event}[${i}].hooks[${j}] is not an object`); return; }
          entries.push({ event, matcher: typeof item.matcher === "string" ? item.matcher : null, handler, group: item });
        });
      } else if (!isObject(item)) problems.push(`${layout.root[0]}.${event}[${i}] is not an object`);
      else entries.push({ event, matcher: typeof item.matcher === "string" ? item.matcher : null, handler: item, group: null });
    });
  }
  return { ok: true, value, entries, problems };
}

/** The entry to write for a handler. */
export function entryFor(layout, handler, matcher) {
  if (layout.shape === "grouped") return { ...(matcher ? { matcher } : {}), hooks: [handler] };
  return matcher ? { ...handler, matcher } : handler;
}

/** Adds a handler under an event: a new `hooks` member, a new event, or one more item of the event's array. Throws Refusal if the file's structure is not usable. */
export function addEntry(text, layout, event, handler, matcher) {
  const st = styleOf(text);
  const tree = parseTree(text);
  if (tree.type !== "object") throw new Refusal("the top level is not a JSON object");
  const entry = entryFor(layout, handler, matcher);
  const key = layout.root[0];
  const hooksMember = findMember(tree, key);
  if (!hooksMember) return insertMember(text, tree, key, { [event]: [entry] }, st);
  if (hooksMember.value.type !== "object") throw new Refusal(`"${key}" is not an object`);
  const eventMember = findMember(hooksMember.value, event);
  if (!eventMember) return insertMember(text, hooksMember.value, event, [entry], st);
  if (eventMember.value.type !== "array") throw new Refusal(`${key}.${event} is not an array`);
  return insertItem(text, eventMember.value, entry, st);
}

/** Finds the first handler for which `match(handler, event)` is true: { eventMember, groupIndex, handlerIndex } or null. */
function findHandler(text, tree, layout, match) {
  const hooks = findMember(tree, layout.root[0]);
  if (!hooks || hooks.value.type !== "object") return null;
  for (const eventMember of hooks.value.members) {
    if (eventMember.value.type !== "array") continue;
    const items = eventMember.value.items;
    for (let gi = 0; gi < items.length; gi++) {
      const item = items[gi];
      if (item.type !== "object") continue;
      if (layout.shape === "grouped") {
        const list = findMember(item, "hooks");
        if (!list || list.value.type !== "array") continue;
        for (let hi = 0; hi < list.value.items.length; hi++) {
          const node = list.value.items[hi];
          if (node.type === "object" && match(JSON.parse(text.slice(node.start, node.end)), eventMember.key)) return { eventMember, groupIndex: gi, handlerIndex: hi, hooks, listNode: list.value };
        }
      } else if (match(JSON.parse(text.slice(item.start, item.end)), eventMember.key)) return { eventMember, groupIndex: gi, handlerIndex: -1, hooks, listNode: null };
    }
  }
  return null;
}

/**
 * Takes out every handler for which `match(handler, event)` is true. A matcher group left with no handler goes with it, an event left
 * with no group goes with its group, and a `hooks` object left empty goes too. Returns { text, removed }.
 */
export function removeEntries(text, layout, match) {
  let out = text;
  let removed = 0;
  for (let guard = 0; guard < 1000; guard++) {
    const tree = parseTree(out);
    if (tree.type !== "object") break;
    const found = findHandler(out, tree, layout, match);
    if (!found) break;
    const { eventMember, groupIndex, handlerIndex, hooks, listNode } = found;
    const events = eventMember.value;
    if (layout.shape === "grouped" && listNode.items.length > 1) {
      out = removeElement(out, listNode, handlerIndex);
    } else if (events.items.length > 1) {
      out = removeElement(out, events, groupIndex);
    } else if (hooks.value.members.length > 1) {
      out = removeElement(out, hooks.value, hooks.value.members.indexOf(eventMember));
    } else {
      // the last handler of the last event: the `hooks` member goes with it
      out = removeElement(out, tree, tree.members.indexOf(hooks));
    }
    removed++;
  }
  return { text: out, removed };
}
