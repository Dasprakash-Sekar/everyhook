// Editing JSON by its text: where the nodes are, adding a member or an item in the layout of the file, taking one out so that the text
// goes back to what it was, and a seeded fuzz of both over many layouts.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { findMember, insertItem, insertMember, nodeAt, parseTree, removeElement, styleOf } from "../src/jsonedit.mjs";

test("parseTree: offsets of objects, arrays, strings with escapes and literals", () => {
  const text = '{"a": [1, "x\\"y", true, null], "b": {"c": -2.5e3}}';
  const t = parseTree(text);
  assert.equal(t.type, "object");
  assert.equal(text.slice(t.start, t.end), text);
  const a = findMember(t, "a");
  assert.equal(text.slice(a.value.start, a.value.end), '[1, "x\\"y", true, null]');
  assert.deepEqual(a.value.items.map((i) => i.type), ["literal", "string", "literal", "literal"]);
  assert.equal(a.value.items[1].value, 'x"y');
  assert.equal(text.slice(a.value.items[1].start, a.value.items[1].end), '"x\\"y"');
  assert.equal(a.comma, text.indexOf(","  , text.indexOf("null")), "the comma after a member");
  assert.equal(nodeAt(t, ["b", "c"]).value, -2500);
  assert.equal(nodeAt(t, ["a", 2]).value, true);
  assert.equal(nodeAt(t, ["nope"]), null);
});

test("parseTree: a byte-order mark is skipped, and text that is not JSON throws", () => {
  const t = parseTree('﻿{"a":1}');
  assert.equal(t.start, 1);
  assert.throws(() => parseTree("{a:1}"));
  assert.throws(() => parseTree("{\"a\":1,}"));
  assert.throws(() => parseTree("{\"a\":1} // c"));
  assert.throws(() => parseTree(""));
});

test("styleOf: the line ending that most breaks are, and the indentation", () => {
  assert.deepEqual(styleOf('{\n  "a": 1\n}\n'), { eol: "\n", unit: "  " });
  assert.deepEqual(styleOf('{\r\n    "a": 1\r\n}\r\n'), { eol: "\r\n", unit: "    " });
  assert.deepEqual(styleOf('{\n\t"a": 1\n}'), { eol: "\n", unit: "\t" });
  assert.deepEqual(styleOf("{}"), { eol: "\n", unit: "  " });
});

test("insertMember: into an empty object, a one-line object, and objects written over several lines", () => {
  const add = (text, key, value) => insertMember(text, parseTree(text), key, value);
  assert.equal(add("{}", "hooks", { a: 1 }), '{\n  "hooks": {\n    "a": 1\n  }\n}');
  assert.equal(add('{"a":1}', "b", 2), '{"a":1, "b": 2}');
  assert.equal(add('{\n  "a": 1\n}\n', "b", [1, 2]), '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}\n');
  assert.equal(add('{\n    "a": 1\n}', "b", "x"), '{\n    "a": 1,\n    "b": "x"\n}');
  assert.equal(add('{\n\t"a": 1\n}', "b", "x"), '{\n\t"a": 1,\n\t"b": "x"\n}');
  assert.equal(add('{\r\n  "a": 1\r\n}\r\n', "b", "x"), '{\r\n  "a": 1,\r\n  "b": "x"\r\n}\r\n');
  assert.equal(add('{\n  "a": 1}', "b", "x"), '{\n  "a": 1,\n  "b": "x"}', "the closing brace on the line of the last member");
});

test("insertItem: into an empty array, a one-line array, and arrays written over several lines", () => {
  const add = (text, value) => insertItem(text, parseTree(text), value);
  assert.equal(add("[]", { a: 1 }), '[\n  {\n    "a": 1\n  }\n]');
  assert.equal(add("[1, 2]", 3), "[1, 2, 3]");
  assert.equal(add("[\n  1,\n  2\n]\n", 3), "[\n  1,\n  2,\n  3\n]\n");
  assert.equal(add('[\n  "a"\n]', "b"), '[\n  "a",\n  "b"\n]');
});

test("insertMember into a nested object keeps the indentation of its parent", () => {
  const text = '{\n  "outer": {\n    "k": 1\n  },\n  "z": 0\n}\n';
  const tree = parseTree(text);
  const outer = findMember(tree, "outer").value;
  assert.equal(insertMember(text, outer, "n", { p: [1] }), '{\n  "outer": {\n    "k": 1,\n    "n": {\n      "p": [\n        1\n      ]\n    }\n  },\n  "z": 0\n}\n');
});

test("removeElement: first, middle, last and only elements, on their own lines and sharing a line", () => {
  const rm = (text, path, k) => { const t = parseTree(text); const c = path.length ? nodeAt(t, path) : t; return removeElement(text, c, k); };
  assert.equal(rm('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n', [], 0), '{\n  "b": 2,\n  "c": 3\n}\n');
  assert.equal(rm('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n', [], 1), '{\n  "a": 1,\n  "c": 3\n}\n');
  assert.equal(rm('{\n  "a": 1,\n  "b": 2,\n  "c": 3\n}\n', [], 2), '{\n  "a": 1,\n  "b": 2\n}\n', "the last one takes the comma before it");
  assert.equal(rm('{\n  "a": 1\n}\n', [], 0), "{}\n", "the only one leaves an empty object");
  assert.equal(rm('{"a": 1, "b": 2, "c": 3}', [], 1), '{"a": 1, "c": 3}');
  assert.equal(rm('{"a": 1, "b": 2, "c": 3}', [], 2), '{"a": 1, "b": 2}');
  assert.equal(rm("[1, 2, 3]", [], 0), "[2, 3]");
  assert.equal(rm('{\n  "k": [\n    {\n      "x": 1\n    },\n    {\n      "y": 2\n    }\n  ]\n}\n', ["k"], 1), '{\n  "k": [\n    {\n      "x": 1\n    }\n  ]\n}\n', "a member that spans lines");
});

// ---- fuzz --------------------------------------------------------------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** A random JSON value of small depth. */
function value(r, depth) {
  const k = r();
  if (depth <= 0 || k < 0.35) return [1, "text", true, null, 2.5, "q\"uote", "unié"][Math.floor(r() * 7)];
  if (k < 0.65) return Array.from({ length: Math.floor(r() * 4) }, () => value(r, depth - 1));
  return Object.fromEntries(Array.from({ length: Math.floor(r() * 4) }, (_, i) => [`k${i}${Math.floor(r() * 9)}`, value(r, depth - 1)]));
}

/** Writes a value as text in a chosen style. `compactArrays` keeps arrays of scalars on one line. */
function write(v, st, level = 0) {
  const pad = (n) => st.unit.repeat(n);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    if (st.compactArrays && v.every((x) => x === null || typeof x !== "object")) return `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
    return `[${st.eol}${v.map((x) => pad(level + 1) + write(x, st, level + 1)).join(`,${st.eol}`)}${st.eol}${pad(level)}]`;
  }
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) return "{}";
    return `{${st.eol}${keys.map((k) => `${pad(level + 1)}${JSON.stringify(k)}: ${write(v[k], st, level + 1)}`).join(`,${st.eol}`)}${st.eol}${pad(level)}}`;
  }
  return JSON.stringify(v);
}

test("fuzz: adding a member and taking it out gives back the same bytes, over 400 random files in 24 layouts", () => {
  const r = rng(20261017);
  const styles = [];
  for (const unit of ["  ", "    ", "\t"]) for (const eol of ["\n", "\r\n"]) for (const compactArrays of [false, true]) for (const finalEol of [true, false]) styles.push({ unit, eol, compactArrays, finalEol });
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const st = styles[n % styles.length];
    const base = Object.fromEntries(Array.from({ length: 1 + Math.floor(r() * 4) }, (_, i) => [`key${i}`, value(r, 3)]));
    if (r() < 0.1) for (const k of Object.keys(base)) delete base[k];
    const text = write(base, st) + (st.finalEol ? st.eol : "");
    const tree = parseTree(text);
    const member = value(r, 2);
    const inserted = insertMember(text, tree, "added", member);
    const back = parseTree(inserted);
    assert.deepEqual(JSON.parse(inserted), { ...base, added: member }, `layout ${n}: the data after insert`);
    assert.equal(findMember(back, "added").value.type, Array.isArray(member) ? "array" : member && typeof member === "object" ? "object" : typeof member === "string" ? "string" : "literal");
    const restored = removeElement(inserted, back, back.members.length - 1);
    assert.equal(restored, text, `layout ${n} (${JSON.stringify(st)}): insert then remove is the original, for ${JSON.stringify(base)}`);
    checked++;
    // the same for an item added to an array member
    const arr = { list: [1, 2], other: base };
    const t2 = write(arr, st) + (st.finalEol ? st.eol : "");
    const node = nodeAt(parseTree(t2), ["list"]);
    const ins2 = insertItem(t2, node, { x: member });
    assert.deepEqual(JSON.parse(ins2).list, [1, 2, { x: member }]);
    const node2 = nodeAt(parseTree(ins2), ["list"]);
    assert.equal(removeElement(ins2, node2, 2), t2, `layout ${n}: item added then removed`);
  }
  assert.equal(checked, 400);
});
