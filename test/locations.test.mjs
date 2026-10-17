// Where each agent keeps its hooks, on each system, from the environment alone (a pretend machine: nothing here touches a disk).
import "./helpers.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { homeDir, installFile, locations } from "../src/locations.mjs";
import { AGENTS } from "../src/contract.mjs";

const win = { platform: "win32", env: { USERPROFILE: "C:\\Users\\me", HOME: "C:\\wrong", ProgramData: "C:\\ProgramData", ProgramFiles: "C:\\Program Files" }, project: "D:\\code\\shop" };
const mac = { platform: "darwin", env: { HOME: "/Users/me" }, project: "/Users/me/shop" };
const linux = { platform: "linux", env: { HOME: "/home/me" }, project: "/home/me/shop" };
const files = (agent, o, scope) => locations(agent, o).filter((l) => l.scope === scope).map((l) => l.file || l.dir);

test("homeDir: USERPROFILE on Windows, HOME elsewhere", () => {
  assert.equal(homeDir(win.env, "win32"), "C:\\Users\\me");
  assert.equal(homeDir(linux.env, "linux"), "/home/me");
  assert.equal(homeDir({ USERPROFILE: "C:\\u" }, "darwin") !== "C:\\u", true, "not USERPROFILE off Windows");
});

test("Claude Code: settings.json in the config folder, in the project and local, and the managed file", () => {
  assert.deepEqual(files("claude-code", win, "user"), ["C:\\Users\\me\\.claude\\settings.json"]);
  assert.deepEqual(files("claude-code", linux, "project"), ["/home/me/shop/.claude/settings.json"]);
  assert.deepEqual(files("claude-code", linux, "local"), ["/home/me/shop/.claude/settings.local.json"]);
  assert.deepEqual(files("claude-code", win, "managed"), ["C:\\Program Files\\ClaudeCode\\managed-settings.json"]);
  assert.deepEqual(files("claude-code", mac, "managed"), ["/Library/Application Support/ClaudeCode/managed-settings.json"]);
  assert.deepEqual(files("claude-code", linux, "managed"), ["/etc/claude-code/managed-settings.json"]);
  assert.deepEqual(files("claude-code", { ...linux, env: { HOME: "/home/me", CLAUDE_CONFIG_DIR: "/data/claude" } }, "user"), ["/data/claude/settings.json"], "CLAUDE_CONFIG_DIR replaces ~/.claude");
});

test("Codex CLI: hooks.json and config.toml in CODEX_HOME and in <project>/.codex", () => {
  assert.deepEqual(files("codex", linux, "user"), ["/home/me/.codex/hooks.json", "/home/me/.codex/config.toml"]);
  assert.deepEqual(files("codex", win, "project"), ["D:\\code\\shop\\.codex\\hooks.json", "D:\\code\\shop\\.codex\\config.toml"]);
  assert.deepEqual(files("codex", { ...linux, env: { HOME: "/home/me", CODEX_HOME: "/tmp/ch" } }, "user"), ["/tmp/ch/hooks.json", "/tmp/ch/config.toml"]);
  assert.deepEqual(locations("codex", linux).filter((l) => l.format === "toml").map((l) => l.install), [false, false]);
});

test("Gemini CLI: ~/.gemini/settings.json (GEMINI_CLI_HOME replaces ~), the project, and the system settings", () => {
  assert.deepEqual(files("gemini-cli", mac, "user"), ["/Users/me/.gemini/settings.json"]);
  assert.deepEqual(files("gemini-cli", { ...linux, env: { HOME: "/home/me", GEMINI_CLI_HOME: "/tmp/g" } }, "user"), ["/tmp/g/.gemini/settings.json"]);
  assert.deepEqual(files("gemini-cli", linux, "project"), ["/home/me/shop/.gemini/settings.json"]);
  assert.deepEqual(files("gemini-cli", linux, "managed"), ["/etc/gemini-cli/settings.json"]);
  assert.deepEqual(files("gemini-cli", { ...linux, env: { HOME: "/h", GEMINI_CLI_SYSTEM_SETTINGS_PATH: "/x/s.json" } }, "managed"), ["/x/s.json"]);
});

test("Copilot CLI: hooks files in COPILOT_HOME/hooks and .github/hooks, inline hooks in settings files, the policy folder, and Claude's project files", () => {
  const user = files("copilot-cli", linux, "user");
  assert.deepEqual(user, ["/home/me/.copilot/hooks/everyhook.json", "/home/me/.copilot/hooks", "/home/me/.copilot/settings.json"]);
  assert.deepEqual(files("copilot-cli", { ...linux, env: { HOME: "/home/me", COPILOT_HOME: "/tmp/c" } }, "user")[0], "/tmp/c/hooks/everyhook.json");
  assert.deepEqual(files("copilot-cli", win, "project"), ["D:\\code\\shop\\.github\\hooks\\everyhook.json", "D:\\code\\shop\\.github\\hooks", "D:\\code\\shop\\.github\\copilot\\settings.json", "D:\\code\\shop\\.claude\\settings.json"]);
  assert.deepEqual(locations("copilot-cli", linux).filter((l) => l.crossTool).map((l) => [l.file, l.crossTool]), [["/home/me/shop/.claude/settings.json", "claude-code"], ["/home/me/shop/.claude/settings.local.json", "claude-code"]]);
  assert.deepEqual(files("copilot-cli", win, "managed"), ["C:\\ProgramData\\GitHub\\Copilot\\policy.d"]);
  assert.deepEqual(files("copilot-cli", linux, "managed"), ["/etc/github-copilot/policy.d"]);
});

test("Cursor: ~/.cursor/hooks.json, the project's .cursor/hooks.json and the enterprise file", () => {
  assert.deepEqual(files("cursor", win, "user"), ["C:\\Users\\me\\.cursor\\hooks.json"]);
  assert.deepEqual(files("cursor", linux, "project"), ["/home/me/shop/.cursor/hooks.json"]);
  assert.deepEqual(files("cursor", win, "managed"), ["C:\\ProgramData\\Cursor\\hooks.json"]);
  assert.deepEqual(files("cursor", mac, "managed"), ["/Library/Application Support/Cursor/hooks.json"]);
  assert.deepEqual(files("cursor", linux, "managed"), ["/etc/cursor/hooks.json"]);
});

test("EVERYHOOK_SYSTEM_DIR replaces the folders of administrators' files (the tests use it)", () => {
  const o = { ...linux, env: { HOME: "/home/me", EVERYHOOK_SYSTEM_DIR: "/sys" } };
  assert.deepEqual(files("claude-code", o, "managed"), ["/sys/claude/managed-settings.json"]);
  assert.deepEqual(files("gemini-cli", o, "managed"), ["/sys/gemini/settings.json"]);
  assert.deepEqual(files("copilot-cli", o, "managed"), ["/sys/copilot/policy.d"]);
  assert.deepEqual(files("cursor", o, "managed"), ["/sys/cursor/hooks.json"]);
});

test("without a project there are no project files; install writes exactly one file per agent and scope", () => {
  for (const agent of AGENTS) {
    assert.ok(locations(agent, { platform: "linux", env: { HOME: "/h" } }).every((l) => l.scope !== "project" && l.scope !== "local" || l.crossTool), `${agent} has no project file without a project`);
    for (const scope of ["user", "project"]) {
      const writes = locations(agent, linux).filter((l) => l.install && l.scope === scope);
      assert.equal(writes.length, 1, `${agent} ${scope}`);
      assert.equal(installFile(agent, scope, linux), writes[0].file);
    }
    assert.equal(installFile(agent, "managed", linux), null, "install never writes an administrator's file");
  }
  assert.throws(() => locations("nobody", linux), /unknown agent/);
});

test("a relative CLAUDE_CONFIG_DIR is read from the project folder", () => {
  assert.deepEqual(files("claude-code", { ...linux, env: { HOME: "/h", CLAUDE_CONFIG_DIR: "cfg" } }, "user"), ["/home/me/shop/cfg/settings.json"]);
});
