// The recorded documents: what each agent really sent a hook, kept in fixtures/<agent>/<event>.<variant>.json with the agent, its version,
// the system and the date (test/record.mjs records them from the real binaries; Cursor's are written from its reference and say so).
// A fixture holds the agent's JSON in `stdin`; the paths of the recording folder are `<project>` and `<home>` and are filled in when the
// fixture is used.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, EVENTS } from "./contract.mjs";

export const FIXTURE_VERSION = 1;
export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Checks one fixture document. Returns a list of sentences; empty when it is fine. */
export function checkFixture(f) {
  const bad = [];
  if (!isObject(f)) return ["not an object"];
  if (f.everyhookFixture !== FIXTURE_VERSION) bad.push(`everyhookFixture must be ${FIXTURE_VERSION}`);
  if (!AGENTS.includes(f.agent)) bad.push(`agent "${f.agent}" is not one of ${AGENTS.join(", ")}`);
  if (!EVENTS.includes(f.event)) bad.push(`event "${f.event}" is not one of ${EVENTS.join(", ")}`);
  if (f.source !== "recorded" && f.source !== "documented") bad.push('source must be "recorded" or "documented"');
  for (const k of ["agentVersion", "os", "date", "variant", "nativeEvent", "summary"]) if (typeof f[k] !== "string" || !f[k]) bad.push(`${k} must be a non-empty string`);
  if (typeof f.date === "string" && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) bad.push("date must be YYYY-MM-DD");
  if (!isObject(f.stdin)) bad.push("stdin must be an object: the agent's JSON");
  return bad;
}

/** Fills the placeholders of a recorded document: <project> and <home>. */
export function fillPlaceholders(value, { project, home }) {
  if (typeof value === "string") return value.split("<project>").join(project).split("<home>").join(home);
  if (Array.isArray(value)) return value.map((v) => fillPlaceholders(v, { project, home }));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillPlaceholders(v, { project, home })]));
  return value;
}

/** Reads one fixture file. Returns { file, fixture } or { file, error }. */
export function readFixture(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { file, error: `cannot read it: ${e.message}` }; }
  const bad = checkFixture(doc);
  return bad.length ? { file, error: bad.join("; ") } : { file, fixture: doc };
}

/** Every fixture of the package (fixtures/<agent>/*.json), in a stable order, optionally for some agents and events. */
export function loadFixtures({ agents = AGENTS, events = EVENTS, dir = FIXTURES_DIR } = {}) {
  const out = [];
  for (const agent of AGENTS) {
    if (!agents.includes(agent)) continue;
    let names = [];
    try { names = fs.readdirSync(path.join(dir, agent)).filter((n) => n.endsWith(".json")).sort(); } catch { continue; }
    for (const n of names) {
      const r = readFixture(path.join(dir, agent, n));
      if (r.fixture && !events.includes(r.fixture.event)) continue;
      out.push(r);
    }
  }
  const order = (r) => (r.fixture ? EVENTS.indexOf(r.fixture.event) : 99);
  return out.sort((a, b) => AGENTS.indexOf(a.fixture ? a.fixture.agent : "") - AGENTS.indexOf(b.fixture ? b.fixture.agent : "") || order(a) - order(b) || a.file.localeCompare(b.file));
}
