// Changing a JSON file by editing its text, so that nothing else in it moves: the key order, the indentation, the line endings and the
// layout of everything that is not touched stay as they are. (Parse, change, stringify would rewrite the whole file: escapes, numbers,
// the arrays kept on one line.) The model is claude-settings-doctor's src/jsonedit.mjs, for strict JSON, which is what these settings
// files are.
//
// parseTree(text) gives a tree whose nodes know where they start and end; the edit functions take the text and a node and return the new
// text. After an edit the old nodes are out of date: parse again before the next one. Only text that JSON.parse accepts is parsed.

const WS = new Set([" ", "\t", "\n", "\r"]);

/** The text as a tree of nodes with offsets, or throws if it is not JSON. A byte-order mark at the start is skipped. */
export function parseTree(text) {
  JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const ws = () => { while (i < text.length && WS.has(text[i])) i++; };
  function str() {
    const start = i;
    i++;
    while (text[i] !== '"') { if (text[i] === "\\") i++; i++; }
    i++;
    return { type: "string", start, end: i, value: JSON.parse(text.slice(start, i)) };
  }
  function literal() {
    const start = i;
    while (i < text.length && !WS.has(text[i]) && text[i] !== "," && text[i] !== "]" && text[i] !== "}") i++;
    return { type: "literal", start, end: i, value: JSON.parse(text.slice(start, i)) };
  }
  function object() {
    const node = { type: "object", start: i, end: 0, members: [] };
    i++;
    ws();
    if (text[i] === "}") { i++; node.end = i; return node; }
    for (;;) {
      ws();
      const k = str();
      ws();
      i++;
      const v = value();
      ws();
      const m = { key: k.value, keyStart: k.start, start: k.start, end: v.end, value: v, comma: null };
      node.members.push(m);
      if (text[i] === ",") { m.comma = i; i++; continue; }
      break;
    }
    ws();
    i++;
    node.end = i;
    return node;
  }
  function array() {
    const node = { type: "array", start: i, end: 0, items: [] };
    i++;
    ws();
    if (text[i] === "]") { i++; node.end = i; return node; }
    for (;;) {
      const v = value();
      v.comma = null;
      ws();
      node.items.push(v);
      if (text[i] === ",") { v.comma = i; i++; continue; }
      break;
    }
    ws();
    i++;
    node.end = i;
    return node;
  }
  function value() {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return str();
    return literal();
  }
  const root = value();
  return root;
}

/** The member of an object node with that key (the last one, as JSON.parse reads duplicates), or null. */
export function findMember(node, key) {
  if (!node || node.type !== "object") return null;
  let found = null;
  for (const m of node.members) if (m.key === key) found = m;
  return found;
}

/** { eol, unit }: "\r\n" when most line breaks are, and one level of indentation (a tab, or the smallest indentation). */
export function styleOf(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  let tabs = false;
  let least = Infinity;
  for (const m of text.matchAll(/^([ \t]+)\S/gm)) {
    if (m[1].includes("\t")) tabs = true;
    else least = Math.min(least, m[1].length);
  }
  return { eol: crlf > lf ? "\r\n" : "\n", unit: tabs ? "\t" : " ".repeat(Number.isFinite(least) ? Math.min(least, 8) : 2) };
}

const lineStart = (text, pos) => text.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (text, pos) => { const i = text.indexOf("\n", pos); return i === -1 ? text.length : i + 1; };
const indentOf = (text, pos) => /^[ \t]*/.exec(text.slice(lineStart(text, pos)))[0];
const startsLine = (text, pos) => /^[ \t]*$/.test(text.slice(lineStart(text, pos), pos));
const restOfLineBlank = (text, pos) => /^[ \t]*(\r?\n|$)/.test(text.slice(pos));

/** A JSON value written in the file's style, its continuation lines starting with `indent`. */
const pretty = (value, indent, st) => JSON.stringify(value, null, st.unit).replace(/\n/g, st.eol + indent);

const elementsOf = (node) => (node.type === "object" ? node.members : node.items);
const afterComma = (el) => (el.comma !== null ? el.comma + 1 : el.end);

/**
 * Add an element (`key` and `value` for an object, `value` alone for an array) after the last one. The new element follows the style of
 * the container: on its own line in a container written over several lines, after a comma in one written on a line.
 */
function insertElement(text, container, render, st) {
  const els = elementsOf(container);
  const open = container.type === "object" ? "{" : "[";
  const close = container.type === "object" ? "}" : "]";
  const closeAt = container.end - 1;
  const parentIndent = indentOf(text, container.start);
  if (els.length === 0) {
    const indent = parentIndent + st.unit;
    return `${text.slice(0, container.start)}${open}${st.eol}${indent}${render(indent)}${st.eol}${parentIndent}${close}${text.slice(container.end)}`;
  }
  const last = els[els.length - 1];
  const multiline = text.slice(container.start + 1, els[0].start).includes("\n");
  if (!multiline) return `${text.slice(0, last.end)}, ${render("", true)}${text.slice(last.end)}`;
  const indent = startsLine(text, last.start) ? indentOf(text, last.start) : indentOf(text, els[0].start);
  const body = `${indent}${render(indent)}`;
  // the closing bracket is on the line of the last element: break the line there
  if (!text.slice(last.end, closeAt).includes("\n")) return `${text.slice(0, last.end)},${st.eol}${body}${text.slice(last.end)}`;
  const eolAt = lineEnd(text, afterComma(last));
  return `${text.slice(0, last.end)},${text.slice(last.end, eolAt)}${body}${st.eol}${text.slice(eolAt)}`;
}

/** Add `"key": value` to an object node (after its last member, in the layout of the others). */
export function insertMember(text, obj, key, value, st = styleOf(text)) {
  return insertElement(text, obj, (indent, compact) => `${JSON.stringify(key)}: ${compact ? JSON.stringify(value) : pretty(value, indent, st)}`, st);
}

/** Add a value to an array node. */
export function insertItem(text, arr, value, st = styleOf(text)) {
  return insertElement(text, arr, (indent, compact) => (compact ? JSON.stringify(value) : pretty(value, indent, st)), st);
}

/**
 * Take the k-th element out of an object or array node. Taking out the last element also takes the comma of the one before it, so no
 * comma is left dangling; taking out the only element leaves `{}` or `[]`.
 */
export function removeElement(text, container, k) {
  const els = elementsOf(container);
  const el = els[k];
  const prev = els[k - 1];
  const next = els[k + 1];
  if (els.length === 1) return text.slice(0, container.start + 1) + text.slice(container.end - 1);
  const alone = startsLine(text, el.start) && restOfLineBlank(text, afterComma(el));
  if (alone) {
    const from = lineStart(text, el.start);
    const to = lineEnd(text, afterComma(el));
    let out = text.slice(0, from) + text.slice(to);
    if (!next && el.comma === null && prev && prev.comma !== null) out = out.slice(0, prev.comma) + out.slice(prev.comma + 1);
    return out;
  }
  // an element sharing its line with others
  if (next) return text.slice(0, el.start) + text.slice(next.start);
  return text.slice(0, prev.end) + text.slice(el.end);
}

/** The node at a path of keys (and indexes for arrays), or null. */
export function nodeAt(root, keys) {
  let node = root;
  for (const k of keys) {
    if (!node) return null;
    if (node.type === "object") { const m = findMember(node, k); node = m ? m.value : null; } else if (node.type === "array" && Number.isInteger(k)) node = node.items[k] || null;
    else return null;
  }
  return node;
}
