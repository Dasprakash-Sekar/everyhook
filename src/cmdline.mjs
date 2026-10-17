// The command line that install writes into an agent's configuration, and the reading of it back (uninstall and list find their own
// entries by parsing it). The line is  node "<everyhook>/bin/everyhook.mjs" run --agent <agent> --event <event> -- "<hook>"  with
// forward slashes on Windows (every shell and node take them), so that it means the same to Git Bash, PowerShell and cmd.exe.
import path from "node:path";

/** Characters that no shell quotes the same way inside double quotes: a path with one of them is refused. */
const UNSAFE = /["$`%]/;

/** A path in the form the command line holds it: forward slashes on Windows, as it is elsewhere. */
export const pathForLine = (p, platform) => (platform === "win32" ? String(p).replace(/\\/g, "/") : String(p));

/** Throws if a path cannot be written between double quotes for every shell. */
export function checkQuotable(p, what) {
  if (UNSAFE.test(p) || /[\r\n]/.test(p)) throw new Error(`the path of ${what} contains a character that shells quote differently (a double quote, $, a backtick or %): ${p}. Move it to a path without one.`);
}

const q = (p) => `"${p}"`;

/**
 * The words of the line, without quoting: ["node", <everyhook>, "run", "--agent", ...]. Copilot takes these as exec and args, with no
 * shell involved; the others get them as one string from runLine.
 */
export function runWords({ everyhook, agent, event, hook, failClosed = false, timeout, platform = process.platform }) {
  const words = ["node", pathForLine(everyhook, platform), "run", "--agent", agent, "--event", event];
  if (failClosed) words.push("--fail-closed");
  if (timeout !== undefined) words.push("--timeout", String(timeout));
  words.push("--", pathForLine(hook, platform));
  return words;
}

/** The command line as one string, the paths in double quotes. */
export function runLine(opts) {
  checkQuotable(opts.everyhook, "everyhook");
  checkQuotable(opts.hook, "the hook");
  const w = runWords(opts);
  return `${w[0]} ${q(w[1])} ${w.slice(2, -1).join(" ")} ${q(w[w.length - 1])}`;
}

/** Splits a command line into words, honouring double and single quotes. Backslashes are kept as they are (they are Windows path separators). */
export function splitLine(line) {
  const words = [];
  let cur = "";
  let started = false;
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && line[i + 1] === '"') { cur += '"'; i++; } else cur += c;
    } else if (c === '"' || c === "'") { quote = c; started = true; } else if (/\s/.test(c)) {
      if (started || cur) { words.push(cur); cur = ""; started = false; }
    } else { cur += c; started = true; }
  }
  if (started || cur) words.push(cur);
  return words;
}

/**
 * Reads a command line (or the words of an exec form) that everyhook wrote: { everyhook, agent, event, hook, failClosed, timeout } or null
 * when it is something else.
 */
export function parseRun(lineOrWords) {
  const w = Array.isArray(lineOrWords) ? lineOrWords.map(String) : splitLine(String(lineOrWords || ""));
  if (w.length < 8) return null;
  if (!/^node(\.exe)?$/i.test(path.basename(w[0].replace(/\\/g, "/")))) return null;
  if (!/(^|[\\/])everyhook\.mjs$/i.test(w[1]) || w[2] !== "run") return null;
  const sep = w.indexOf("--");
  if (sep < 0 || sep !== w.length - 2) return null;
  const out = { everyhook: w[1], agent: null, event: null, hook: w[w.length - 1], failClosed: false, timeout: undefined };
  for (let i = 3; i < sep; i++) {
    if (w[i] === "--agent") out.agent = w[++i];
    else if (w[i] === "--event") out.event = w[++i];
    else if (w[i] === "--fail-closed") out.failClosed = true;
    else if (w[i] === "--timeout") out.timeout = Number(w[++i]);
    else return null;
  }
  return out.agent && out.event ? out : null;
}

/** A key that two spellings of one path share: slashes forward, no trailing slash, case folded on Windows. */
export function pathKey(p, platform = process.platform) {
  const s = String(p).replace(/\\/g, "/").replace(/\/+$/, "");
  return platform === "win32" ? s.toLowerCase() : s;
}
