// A reader for the TOML that Codex CLI's config.toml uses, enough to list the [hooks] tables in it: tables, arrays of tables, dotted and
// quoted keys, basic / literal / multi-line strings, numbers, booleans, dates (kept as text), arrays and inline tables. It reads; it never
// writes. A file it cannot read is reported, not guessed at.

class TomlError extends Error {}

/** Parses TOML text into a plain object. Throws an Error that names the line when the text is not TOML this reader knows. */
export function parseToml(text) {
  const src = String(text).replace(/^﻿/, "").replace(/\r\n/g, "\n");
  let i = 0;
  let line = 1;
  const root = {};
  let table = root;
  const fail = (m) => { throw new TomlError(`line ${line}: ${m}`); };
  const skipSpace = () => { while (i < src.length && (src[i] === " " || src[i] === "\t")) i++; };
  const skipLine = () => { while (i < src.length && src[i] !== "\n") i++; };
  const skipBlank = () => { for (;;) { skipSpace(); if (src[i] === "#") skipLine(); if (src[i] === "\n") { i++; line++; } else break; } };

  function bareOrQuotedKey() {
    skipSpace();
    if (src[i] === '"') return basicString();
    if (src[i] === "'") return literalString();
    const m = /^[A-Za-z0-9_-]+/.exec(src.slice(i));
    if (!m) fail("a key was expected");
    i += m[0].length;
    return m[0];
  }
  function keyPath() {
    const keys = [bareOrQuotedKey()];
    for (;;) { skipSpace(); if (src[i] === ".") { i++; keys.push(bareOrQuotedKey()); } else break; }
    return keys;
  }
  function basicString() {
    if (src.startsWith('"""', i)) {
      i += 3;
      if (src[i] === "\n") { i++; line++; }
      let out = "";
      while (!src.startsWith('"""', i)) {
        if (i >= src.length) fail("a multi-line string is not closed");
        if (src[i] === "\\") { if (src[i + 1] === "\n") { i += 2; line++; while (/\s/.test(src[i] || "")) { if (src[i] === "\n") line++; i++; } continue; } out += escape(); continue; }
        if (src[i] === "\n") line++;
        out += src[i++];
      }
      i += 3;
      return out;
    }
    i++;
    let out = "";
    while (src[i] !== '"') {
      if (i >= src.length || src[i] === "\n") fail("a string is not closed");
      out += src[i] === "\\" ? escape() : src[i++];
    }
    i++;
    return out;
  }
  function escape() {
    i++;
    const c = src[i++];
    const map = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" };
    if (c in map) return map[c];
    if (c === "u" || c === "U") { const n = c === "u" ? 4 : 8; const hex = src.slice(i, i + n); i += n; return String.fromCodePoint(parseInt(hex, 16)); }
    return fail(`unknown escape \\${c}`);
  }
  function literalString() {
    if (src.startsWith("'''", i)) {
      i += 3;
      if (src[i] === "\n") { i++; line++; }
      const end = src.indexOf("'''", i);
      if (end < 0) fail("a multi-line string is not closed");
      const out = src.slice(i, end);
      line += (out.match(/\n/g) || []).length;
      i = end + 3;
      return out;
    }
    i++;
    const end = src.indexOf("'", i);
    if (end < 0 || src.slice(i, end).includes("\n")) fail("a string is not closed");
    const out = src.slice(i, end);
    i = end + 1;
    return out;
  }
  function value() {
    skipSpace();
    const c = src[i];
    if (c === '"') return basicString();
    if (c === "'") return literalString();
    if (c === "[") return array();
    if (c === "{") return inlineTable();
    const m = /^[^\s,\]}#]+/.exec(src.slice(i));
    if (!m) fail("a value was expected");
    i += m[0].length;
    const raw = m[0];
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (/^[+-]?(inf|nan)$/.test(raw)) return Number(raw.replace("inf", "Infinity").replace("nan", "NaN"));
    if (/^[+-]?(0|[1-9][0-9_]*)$/.test(raw)) return Number(raw.replace(/_/g, ""));
    if (/^0x[0-9a-fA-F_]+$/.test(raw)) return parseInt(raw.slice(2).replace(/_/g, ""), 16);
    if (/^0o[0-7_]+$/.test(raw)) return parseInt(raw.slice(2).replace(/_/g, ""), 8);
    if (/^0b[01_]+$/.test(raw)) return parseInt(raw.slice(2).replace(/_/g, ""), 2);
    if (/^[+-]?[0-9][0-9_]*(\.[0-9_]+)?([eE][+-]?[0-9_]+)?$/.test(raw)) return Number(raw.replace(/_/g, ""));
    if (/^\d{4}-\d{2}-\d{2}([Tt ]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?)?$/.test(raw) || /^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) return raw;
    return fail(`cannot read the value ${raw}`);
  }
  function array() {
    i++;
    const out = [];
    for (;;) {
      skipBlank();
      if (src[i] === "]") { i++; return out; }
      out.push(value());
      skipBlank();
      if (src[i] === ",") { i++; continue; }
      skipBlank();
      if (src[i] === "]") { i++; return out; }
      fail("an array was not closed");
    }
  }
  function inlineTable() {
    i++;
    const out = {};
    skipSpace();
    if (src[i] === "}") { i++; return out; }
    for (;;) {
      const keys = keyPath();
      skipSpace();
      if (src[i] !== "=") fail("= was expected");
      i++;
      assign(out, keys, value());
      skipSpace();
      if (src[i] === ",") { i++; skipSpace(); continue; }
      if (src[i] === "}") { i++; return out; }
      fail("an inline table was not closed");
    }
  }
  function descend(obj, keys) {
    let cur = obj;
    for (const k of keys) {
      if (!Object.prototype.hasOwnProperty.call(cur, k)) cur[k] = {};
      cur = Array.isArray(cur[k]) ? cur[k][cur[k].length - 1] : cur[k];
      if (cur === null || typeof cur !== "object") fail(`${k} is not a table`);
    }
    return cur;
  }
  function assign(obj, keys, v) {
    const parent = descend(obj, keys.slice(0, -1));
    const last = keys[keys.length - 1];
    if (Object.prototype.hasOwnProperty.call(parent, last)) fail(`${last} is defined twice`);
    parent[last] = v;
  }

  for (;;) {
    skipBlank();
    if (i >= src.length) break;
    if (src[i] === "[") {
      const isArray = src[i + 1] === "[";
      i += isArray ? 2 : 1;
      const keys = keyPath();
      skipSpace();
      if (src.slice(i, i + (isArray ? 2 : 1)) !== (isArray ? "]]" : "]")) fail("a table header was not closed");
      i += isArray ? 2 : 1;
      const parent = descend(root, keys.slice(0, -1));
      const last = keys[keys.length - 1];
      if (isArray) {
        if (!Object.prototype.hasOwnProperty.call(parent, last)) parent[last] = [];
        if (!Array.isArray(parent[last])) fail(`${last} is not an array of tables`);
        const t = {};
        parent[last].push(t);
        table = t;
      } else {
        if (!Object.prototype.hasOwnProperty.call(parent, last)) parent[last] = {};
        table = Array.isArray(parent[last]) ? parent[last][parent[last].length - 1] : parent[last];
      }
    } else {
      const keys = keyPath();
      skipSpace();
      if (src[i] !== "=") fail("= was expected");
      i++;
      assign(table, keys, value());
    }
    skipSpace();
    if (src[i] === "#") skipLine();
    if (i < src.length && src[i] !== "\n") fail("unexpected text after a value");
  }
  return root;
}
