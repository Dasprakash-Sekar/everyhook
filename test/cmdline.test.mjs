// The command line that install writes, and reading it back: paths with spaces and backslashes, paths no shell quotes alike, and the
// words that Copilot takes as exec and args.
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { checkQuotable, parseRun, pathForLine, pathKey, runLine, runWords, splitLine } from "../src/cmdline.mjs";

const base = { everyhook: "/opt/every hook/bin/everyhook.mjs", agent: "codex", event: "pre-tool", hook: "/home/me/my hooks/block.mjs", timeout: 28, platform: "linux" };

test("runLine: node, the quoted everyhook, run, the agent, the event, the timeout, --, the quoted hook", () => {
  assert.equal(runLine(base), 'node "/opt/every hook/bin/everyhook.mjs" run --agent codex --event pre-tool --timeout 28 -- "/home/me/my hooks/block.mjs"');
  assert.equal(runLine({ ...base, failClosed: true }), 'node "/opt/every hook/bin/everyhook.mjs" run --agent codex --event pre-tool --fail-closed --timeout 28 -- "/home/me/my hooks/block.mjs"');
  assert.equal(runLine({ ...base, timeout: undefined }), 'node "/opt/every hook/bin/everyhook.mjs" run --agent codex --event pre-tool -- "/home/me/my hooks/block.mjs"');
});

test("on Windows the paths go in with forward slashes, which every shell and node take", () => {
  const line = runLine({ ...base, everyhook: "D:\\Projects\\every hook\\bin\\everyhook.mjs", hook: "C:\\Users\\me\\hooks dir\\block.mjs", platform: "win32" });
  assert.equal(line, 'node "D:/Projects/every hook/bin/everyhook.mjs" run --agent codex --event pre-tool --timeout 28 -- "C:/Users/me/hooks dir/block.mjs"');
  assert.equal(pathForLine("C:\\a\\b", "win32"), "C:/a/b");
  assert.equal(pathForLine("/a/b\\c", "linux"), "/a/b\\c", "a backslash is a letter of a name elsewhere");
});

test("runWords: the same line as words, with no quoting, for exec + args", () => {
  assert.deepEqual(runWords(base), ["node", "/opt/every hook/bin/everyhook.mjs", "run", "--agent", "codex", "--event", "pre-tool", "--timeout", "28", "--", "/home/me/my hooks/block.mjs"]);
});

test("a path with a double quote, $, a backtick or % is refused: shells quote those differently", () => {
  for (const bad of ['/a/b"c', "/a/$HOME/c", "/a/`x`/c", "C:/a/%PATH%/c"]) {
    assert.throws(() => checkQuotable(bad, "the hook"), /contains a character that shells quote differently/, bad);
    assert.throws(() => runLine({ ...base, hook: bad }), /the path of the hook/);
    assert.throws(() => runLine({ ...base, everyhook: bad }), /the path of everyhook/);
  }
  assert.doesNotThrow(() => checkQuotable("/a/it's here/(x)/c&d", "the hook"), "quotes, parentheses and & are fine inside double quotes");
});

test("splitLine: double and single quotes group, backslashes are kept", () => {
  assert.deepEqual(splitLine('node "C:\\Program Files\\x.mjs" run -- \'a b\' c'), ["node", "C:\\Program Files\\x.mjs", "run", "--", "a b", "c"]);
  assert.deepEqual(splitLine('a "b \\" c" d'), ["a", 'b " c', "d"]);
  assert.deepEqual(splitLine("  a   b  "), ["a", "b"]);
  assert.deepEqual(splitLine('a "" b'), ["a", "", "b"]);
});

test("parseRun reads back what runLine wrote, and the exec words", () => {
  const r = parseRun(runLine({ ...base, failClosed: true }));
  assert.deepEqual(r, { everyhook: base.everyhook, agent: "codex", event: "pre-tool", hook: base.hook, failClosed: true, timeout: 28 });
  assert.deepEqual(parseRun(runWords(base)), { everyhook: base.everyhook, agent: "codex", event: "pre-tool", hook: base.hook, failClosed: false, timeout: 28 });
  assert.equal(parseRun(runLine({ ...base, timeout: undefined })).timeout, undefined);
});

test("parseRun reads a line that was edited by hand in Windows style, and ignores everything that is not ours", () => {
  assert.equal(parseRun('node.exe "C:\\x\\bin\\everyhook.mjs" run --agent cursor --event stop -- "C:\\h.mjs"').hook, "C:\\h.mjs");
  for (const other of [
    "", "echo hi", "node script.mjs", 'node "/x/other.mjs" run --agent codex --event stop -- "/h.mjs"',
    'python "/x/everyhook.mjs" run --agent codex --event stop -- "/h.mjs"', 'node "/x/everyhook.mjs" list', 'node "/x/everyhook.mjs" run --agent codex -- "/h.mjs"',
    'node "/x/everyhook.mjs" run --agent codex --event stop "/h.mjs"', 'node "/x/everyhook.mjs" run --agent codex --event stop --bogus -- "/h.mjs"',
  ]) assert.equal(parseRun(other), null, other);
  assert.equal(parseRun(null), null);
});

test("pathKey: two spellings of one path share a key (case folded on Windows only)", () => {
  assert.equal(pathKey("C:\\A\\b\\", "win32"), pathKey("c:/a/B", "win32"));
  assert.notEqual(pathKey("/a/B", "linux"), pathKey("/a/b", "linux"));
});
