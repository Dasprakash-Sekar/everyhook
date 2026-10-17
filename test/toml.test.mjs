// The TOML reader that list uses for Codex's config.toml: tables, arrays of tables, strings, numbers, arrays, inline tables; and a clear
// error for what it does not read.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { parseToml } from "../src/toml.mjs";

test("the hooks of the Codex reference parse into the shape list expects", () => {
  const t = parseToml([
    "model = \"gpt-5.5\"",
    "",
    "[[hooks.SessionStart]]",
    "matcher = \"^compact$\"",
    "",
    "[[hooks.SessionStart.hooks]]",
    "type = \"command\"",
    "command = '/usr/bin/python3 \"$(git rev-parse --show-toplevel)/.codex/hooks/session_start.py\"'",
    "additionalContextLimit = 5000",
    "",
    "[[hooks.PreToolUse]]",
    "matcher = \"^Bash$\"",
    "[[hooks.PreToolUse.hooks]]",
    "type = \"command\"",
    "command = \"node \\\"C:/x y/everyhook.mjs\\\" run\"",
    "timeout = 30",
    "async = true",
  ].join("\n"));
  assert.equal(t.model, "gpt-5.5");
  assert.equal(t.hooks.SessionStart[0].matcher, "^compact$");
  assert.equal(t.hooks.SessionStart[0].hooks[0].command, '/usr/bin/python3 "$(git rev-parse --show-toplevel)/.codex/hooks/session_start.py"');
  assert.equal(t.hooks.SessionStart[0].hooks[0].additionalContextLimit, 5000);
  assert.equal(t.hooks.PreToolUse[0].hooks[0].command, 'node "C:/x y/everyhook.mjs" run');
  assert.equal(t.hooks.PreToolUse[0].hooks[0].timeout, 30);
  assert.equal(t.hooks.PreToolUse[0].hooks[0].async, true);
});

test("tables, dotted and quoted keys, comments, numbers, booleans, dates, arrays (also over several lines) and inline tables", () => {
  const t = parseToml([
    "# a comment",
    "a = 1 # trailing",
    "b.c = -2.5e1",
    "\"quoted key\" = true",
    "when = 2026-10-17T12:00:00Z",
    "hex = 0xFF",
    "big = 1_000",
    "list = [1, 2,",
    "  3, # three",
    "]",
    "names = [\"x\", 'y']",
    "inline = { k = \"v\", n = { deep = 1 } }",
    "",
    "[model_providers.fake]",
    "name = \"fake\"",
    "",
    "[model_providers.fake.headers]",
    "x = \"1\"",
  ].join("\n"));
  assert.deepEqual(t.b, { c: -25 });
  assert.equal(t["quoted key"], true);
  assert.equal(t.when, "2026-10-17T12:00:00Z");
  assert.equal(t.hex, 255);
  assert.equal(t.big, 1000);
  assert.deepEqual(t.list, [1, 2, 3]);
  assert.deepEqual(t.names, ["x", "y"]);
  assert.deepEqual(t.inline, { k: "v", n: { deep: 1 } });
  assert.deepEqual(t.model_providers.fake, { name: "fake", headers: { x: "1" } });
});

test("basic strings: escapes and unicode; multi-line strings in both kinds", () => {
  const t = parseToml('s = "tab\\there \\u00e9 \\"q\\" \\\\ end"\nm = """\nline one\nline "two"\\\n   continued"""\nl = \'\'\'\nraw \\n stays\n\'\'\'\n');
  assert.equal(t.s, 'tab\there \u00e9 "q" \\ end');
  assert.equal(t.m, 'line one\nline "two"continued');
  assert.equal(t.l, "raw \\n stays\n");
});

test("CRLF text and a byte-order mark are read", () => {
  const t = parseToml('\uFEFFa = 1\r\n[t]\r\nb = "x"\r\n');
  assert.deepEqual(t, { a: 1, t: { b: "x" } });
});

test("what it does not read is an error that names the line", () => {
  assert.throws(() => parseToml("a = 1\nb = \n"), /line 2/);
  assert.throws(() => parseToml("a = \"open\n"), /line 1: a string is not closed/);
  assert.throws(() => parseToml("a = 1\na = 2\n"), /line 2: a is defined twice/);
  assert.throws(() => parseToml("[t\n"), /a table header was not closed/);
  assert.throws(() => parseToml("a = 1 b = 2\n"), /unexpected text/);
  assert.throws(() => parseToml("a = [1, 2\n"), /an array was not closed/);
  assert.throws(() => parseToml("a = nope\n"), /cannot read the value nope/);
  assert.throws(() => parseToml("a = \"\\q\"\n"), /unknown escape/);
  assert.throws(() => parseToml("a = 1\n[[a]]\n"), /is not an array of tables/);
});

test("an empty file and a file of comments are empty tables", () => {
  assert.deepEqual(parseToml(""), {});
  assert.deepEqual(parseToml("# nothing\n\n"), {});
});
