// The hooks of one JSON file in the two layouts the agents use: reading every handler with the problems in the structure, adding one, and
// taking out only the ones asked for (with the groups, events and `hooks` objects that would be left empty).
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { Refusal, addEntry, entryFor, readHooks, removeEntries } from "../src/hooksdoc.mjs";

const GROUPED = { shape: "grouped", root: ["hooks"] };
const FLAT = { shape: "flat", root: ["hooks"] };
const J = (o) => `${JSON.stringify(o, null, 2)}\n`;
const handler = (n) => ({ type: "command", command: `run ${n}`, timeout: 30 });
const mine = (n) => (h) => h.command === `run ${n}`;

test("readHooks: grouped layout gives one entry per handler, with its matcher", () => {
  const text = J({ model: "x", hooks: { PreToolUse: [{ matcher: "Bash", hooks: [handler(1), handler(2)] }, { hooks: [handler(3)] }], Stop: [{ hooks: [handler(4)] }] } });
  const r = readHooks(text, GROUPED);
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries.map((e) => [e.event, e.matcher, e.handler.command]), [["PreToolUse", "Bash", "run 1"], ["PreToolUse", "Bash", "run 2"], ["PreToolUse", null, "run 3"], ["Stop", null, "run 4"]]);
  assert.deepEqual(r.problems, []);
});

test("readHooks: flat layout gives one entry per handler", () => {
  const r = readHooks(J({ version: 1, hooks: { preToolUse: [{ ...handler(1), matcher: "bash" }, handler(2)] } }), FLAT);
  assert.deepEqual(r.entries.map((e) => [e.event, e.matcher, e.handler.command]), [["preToolUse", "bash", "run 1"], ["preToolUse", null, "run 2"]]);
});

test("readHooks: no hooks key is no entries; text that is not JSON, or not an object, is not ok", () => {
  assert.deepEqual(readHooks("{}", GROUPED), { ok: true, value: {}, entries: [], problems: [] });
  assert.equal(readHooks("{ not json", GROUPED).ok, false);
  assert.match(readHooks("{ not json", GROUPED).problem, /^not valid JSON/);
  assert.equal(readHooks("[]", GROUPED).ok, false);
  assert.equal(readHooks("// c\n{}", GROUPED).ok, false, "a comment is not JSON");
  assert.equal(readHooks("﻿{}", GROUPED).ok, true, "a byte-order mark is fine");
});

test("readHooks: names the structure problems an agent would trip over", () => {
  const p = (v) => readHooks(J({ hooks: v }), GROUPED).problems;
  assert.deepEqual(p({ BeforeTool: true }), ["hooks.BeforeTool is not an array (it is boolean)"]);
  assert.deepEqual(p({ BeforeTool: null }), ["hooks.BeforeTool is not an array (it is null)"]);
  assert.deepEqual(p({ Stop: ["x"] }), ["hooks.Stop[0] is not an object"]);
  assert.deepEqual(p({ Stop: [{ matcher: "x" }] }), ['hooks.Stop[0] has no "hooks" array']);
  assert.deepEqual(p({ Stop: [{ hooks: ["x"] }] }), ["hooks.Stop[0].hooks[0] is not an object"]);
  assert.deepEqual(readHooks(J({ hooks: [] }), GROUPED).problems, ['"hooks" is not an object']);
  assert.deepEqual(readHooks(J({ hooks: { a: [1] } }), FLAT).problems, ["hooks.a[0] is not an object"]);
});

test("entryFor: a group around the handler (with the matcher), or the handler with the matcher in it", () => {
  assert.deepEqual(entryFor(GROUPED, handler(1)), { hooks: [handler(1)] });
  assert.deepEqual(entryFor(GROUPED, handler(1), "Bash"), { matcher: "Bash", hooks: [handler(1)] });
  assert.deepEqual(entryFor(FLAT, handler(1)), handler(1));
  assert.deepEqual(entryFor(FLAT, handler(1), "bash"), { ...handler(1), matcher: "bash" });
});

test("addEntry: a new hooks key, a new event, and one more item of an event", () => {
  let t = "{\n  \"model\": \"x\"\n}\n";
  t = addEntry(t, GROUPED, "PreToolUse", handler(1));
  assert.deepEqual(JSON.parse(t), { model: "x", hooks: { PreToolUse: [{ hooks: [handler(1)] }] } });
  t = addEntry(t, GROUPED, "Stop", handler(2), undefined);
  t = addEntry(t, GROUPED, "PreToolUse", handler(3), "Bash");
  assert.deepEqual(JSON.parse(t).hooks.PreToolUse.map((g) => g.hooks[0].command), ["run 1", "run 3"]);
  assert.deepEqual(Object.keys(JSON.parse(t).hooks), ["PreToolUse", "Stop"]);
  assert.equal(JSON.parse(t).hooks.PreToolUse[1].matcher, "Bash");
  assert.ok(t.startsWith("{\n  \"model\": \"x\",\n  \"hooks\": {"), "the first line and the layout of the file are kept");
});

test("addEntry refuses a file whose structure it cannot use, and says why", () => {
  assert.throws(() => addEntry("[]", GROUPED, "Stop", handler(1)), Refusal);
  assert.throws(() => addEntry(J({ hooks: [] }), GROUPED, "Stop", handler(1)), /"hooks" is not an object/);
  assert.throws(() => addEntry(J({ hooks: { Stop: true } }), GROUPED, "Stop", handler(1)), /hooks.Stop is not an array/);
});

test("removeEntries: only the matching handler goes; its group goes when it was the only handler in it", () => {
  const text = J({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [handler(1), handler(2)] }, { hooks: [handler(3)] }] } });
  const one = removeEntries(text, GROUPED, mine(1));
  assert.equal(one.removed, 1);
  assert.deepEqual(JSON.parse(one.text).hooks.PreToolUse[0].hooks.map((h) => h.command), ["run 2"]);
  const three = removeEntries(text, GROUPED, mine(3));
  assert.deepEqual(JSON.parse(three.text).hooks.PreToolUse.length, 1, "the group that held only it is gone");
  const none = removeEntries(text, GROUPED, mine(9));
  assert.equal(none.removed, 0);
  assert.equal(none.text, text);
});

test("removeEntries: an event with nothing left goes, then the hooks key, and the rest of the file stays", () => {
  const text = J({ model: "x", hooks: { Stop: [{ hooks: [handler(1)] }], PreToolUse: [{ hooks: [handler(2)] }] } });
  const a = removeEntries(text, GROUPED, mine(1));
  assert.deepEqual(JSON.parse(a.text), { model: "x", hooks: { PreToolUse: [{ hooks: [handler(2)] }] } });
  const b = removeEntries(a.text, GROUPED, mine(2));
  assert.deepEqual(JSON.parse(b.text), { model: "x" });
  assert.equal(b.text, J({ model: "x" }));
  const only = removeEntries(J({ hooks: { Stop: [{ hooks: [handler(1)] }] } }), GROUPED, mine(1));
  assert.equal(only.text, "{}\n");
});

test("removeEntries in a flat layout, several at once", () => {
  const text = J({ version: 1, hooks: { preToolUse: [handler(1), handler(2)], postToolUse: [handler(1)] } });
  const r = removeEntries(text, FLAT, mine(1));
  assert.equal(r.removed, 2);
  assert.deepEqual(JSON.parse(r.text), { version: 1, hooks: { preToolUse: [handler(2)] } });
  const all = removeEntries(r.text, FLAT, mine(2));
  assert.deepEqual(JSON.parse(all.text), { version: 1 });
});

test("removeEntries leaves other agents' handlers alone even when they look alike", () => {
  const text = J({ hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }, handler(1)] }] } });
  const r = removeEntries(text, GROUPED, mine(1));
  assert.deepEqual(JSON.parse(r.text).hooks.Stop[0].hooks, [{ type: "command", command: "other" }]);
});
