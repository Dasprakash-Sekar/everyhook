// Records the fixtures and the conformance answers from the real binaries:
//   RECORD_FIXTURES=1 E2E_CLAUDE=... E2E_CODEX=... E2E_GEMINI=... E2E_COPILOT=... node test/record.mjs fixtures [agent ...]
//   RECORD_FIXTURES=1 E2E_...=...                                                  node test/record.mjs conformance [agent ...]
// `fixtures` writes fixtures/<agent>/<event>.<variant>.json for each agent whose binary is named, and the documented fixtures of Cursor.
// `conformance` puts the cases of test/conformance.mjs to each binary and writes fixtures/conformance/<agent>.json.
// Every run uses throwaway home folders. `node --test` also runs this file: without RECORD_FIXTURES it does nothing.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (!process.env.RECORD_FIXTURES) process.exit(0);

const { ROOT } = await import("./helpers.mjs");
const { TESTED, runCases } = await import("./conformance.mjs");
const { recordAgent } = await import("./recording.mjs");
const { CURSOR_FIXTURES } = await import("./cursor-docs.mjs");

const mode = process.argv[2];
const wanted = process.argv.slice(3);
const agents = Object.keys(TESTED).filter((a) => (!wanted.length || wanted.includes(a)));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); };
const date = new Date().toISOString().slice(0, 10);
const osName = `${process.platform} ${process.arch}, ${os.version()} ${os.release()}`;

if (mode === "fixtures") {
  for (const agent of agents) {
    const mod = TESTED[agent];
    if (mod.skip()) { console.log(`${agent}: skipped (${mod.skip()})`); continue; }
    const r = await recordAgent(agent);
    const dir = path.join(ROOT, "fixtures", agent);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [name, fx] of Object.entries(r.files)) write(path.join(dir, name), fx);
    console.log(`${agent} ${r.version}: exit ${r.code} in ${r.ms} ms, ${r.docs.length} documents, ${Object.keys(r.files).length} fixtures: ${Object.keys(r.files).join(", ")}`);
    if (r.stderr && /error/i.test(r.stderr)) console.log(`  stderr: ${r.stderr.replace(/\s+/g, " ")}`);
  }
  if (!wanted.length || wanted.includes("cursor")) {
    const dir = path.join(ROOT, "fixtures", "cursor");
    fs.rmSync(dir, { recursive: true, force: true });
    for (const [event, variant, nativeEvent, summary, stdin] of CURSOR_FIXTURES) {
      write(path.join(dir, `${event}.${variant}.json`), { everyhookFixture: 1, agent: "cursor", agentVersion: "documented", source: "documented", os: "any", date: "2026-10-17", event, nativeEvent, variant, summary, stdin });
    }
    console.log(`cursor: ${CURSOR_FIXTURES.length} documented fixtures`);
  }
} else if (mode === "conformance") {
  for (const agent of agents) {
    const mod = TESTED[agent];
    if (mod.skip()) { console.log(`${agent}: skipped (${mod.skip()})`); continue; }
    const r = await runCases(agent, { parent: process.platform === "win32" });
    const cases = Object.fromEntries(Object.entries(r.cases).map(([id, c]) => [id, { outcome: c.outcome, ...(c.stopped !== undefined ? { stopped: c.stopped } : {}) }]));
    const parent = r.parent ? { name: r.parent.name, commandLine: r.parent.commandLine.replace(/\\?"?[A-Za-z]:[\\/][^" ]*record-hook\.mjs\\?"?/g, "<record-hook>") } : null;
    write(path.join(ROOT, "fixtures", "conformance", `${agent}.json`), { agent, agentVersion: r.version, os: osName, node: process.versions.node, date, hookTimeoutSeconds: 10, cases, ...(parent ? { windowsShell: parent } : {}) });
    console.log(`${agent} ${r.version}: ${Object.keys(cases).length} cases in ${r.ms} ms`);
  }
} else {
  console.log("usage: RECORD_FIXTURES=1 node test/record.mjs fixtures|conformance [agent ...]");
  process.exitCode = 2;
}
