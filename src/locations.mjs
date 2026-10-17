// Where each agent keeps its hooks, on each system: the files install writes and the files list reads. Pure: nothing here touches a disk.
//
// A location is { agent, scope, file | dir, format, install }:
//   scope    user (the home folder), project (the folder you are in), local (not for the team), managed (an administrator's)
//   file     a JSON file with a `hooks` object (format "json"), or a TOML file whose [hooks] tables are read (format "toml")
//   dir      a folder of JSON files, each one a hooks file (Copilot CLI)
//   install  true for the one file per scope that `install` writes
import os from "node:os";
import path from "node:path";

export const pathFor = (platform) => (platform === "win32" ? path.win32 : path.posix);

/** The home folder as the agents see it: USERPROFILE on Windows, HOME elsewhere. */
export function homeDir(env, platform) {
  const v = platform === "win32" ? env.USERPROFILE || env.HOME : env.HOME;
  return v || os.homedir();
}

/** The folder administrators' files live in, for the agents that have one. EVERYHOOK_SYSTEM_DIR replaces it (the tests use it). */
function systemRoots(env, platform) {
  if (env.EVERYHOOK_SYSTEM_DIR) {
    const P = pathFor(platform);
    const d = env.EVERYHOOK_SYSTEM_DIR;
    return { claude: P.join(d, "claude", "managed-settings.json"), gemini: P.join(d, "gemini", "settings.json"), copilot: P.join(d, "copilot", "policy.d"), cursor: P.join(d, "cursor", "hooks.json") };
  }
  if (platform === "win32") {
    const data = env.ProgramData || "C:\\ProgramData";
    const files = env.ProgramFiles || "C:\\Program Files";
    return { claude: path.win32.join(files, "ClaudeCode", "managed-settings.json"), gemini: path.win32.join(data, "gemini-cli", "settings.json"), copilot: path.win32.join(data, "GitHub", "Copilot", "policy.d"), cursor: path.win32.join(data, "Cursor", "hooks.json") };
  }
  if (platform === "darwin") {
    return { claude: "/Library/Application Support/ClaudeCode/managed-settings.json", gemini: "/etc/gemini-cli/settings.json", copilot: "/etc/github-copilot/policy.d", cursor: "/Library/Application Support/Cursor/hooks.json" };
  }
  return { claude: "/etc/claude-code/managed-settings.json", gemini: "/etc/gemini-cli/settings.json", copilot: "/etc/github-copilot/policy.d", cursor: "/etc/cursor/hooks.json" };
}

/**
 * Every place an agent reads hooks from: { agent, scope, file | dir, format, install }.
 * `env` and `platform` say which machine; `project` is the folder the person works in (absolute).
 */
export function locations(agent, { env = process.env, platform = process.platform, project } = {}) {
  const P = pathFor(platform);
  const home = homeDir(env, platform);
  const sys = systemRoots(env, platform);
  const proj = (...parts) => P.join(project, ...parts);
  const abs = (v, fallback) => (v ? P.resolve(project || ".", v) : fallback);
  const out = [];
  const add = (scope, where, format = "json", install = false) => out.push({ agent, scope, ...where, format, install });
  switch (agent) {
    case "claude-code": {
      const cfg = abs(env.CLAUDE_CONFIG_DIR, P.join(home, ".claude"));
      add("user", { file: P.join(cfg, "settings.json") }, "json", true);
      if (project) {
        add("project", { file: proj(".claude", "settings.json") }, "json", true);
        add("local", { file: proj(".claude", "settings.local.json") });
      }
      add("managed", { file: sys.claude });
      break;
    }
    case "codex": {
      const cfg = abs(env.CODEX_HOME, P.join(home, ".codex"));
      add("user", { file: P.join(cfg, "hooks.json") }, "json", true);
      add("user", { file: P.join(cfg, "config.toml") }, "toml");
      if (project) {
        add("project", { file: proj(".codex", "hooks.json") }, "json", true);
        add("project", { file: proj(".codex", "config.toml") }, "toml");
      }
      break;
    }
    case "gemini-cli": {
      const base = abs(env.GEMINI_CLI_HOME, home);
      add("user", { file: P.join(base, ".gemini", "settings.json") }, "json", true);
      if (project) add("project", { file: proj(".gemini", "settings.json") }, "json", true);
      add("managed", { file: env.GEMINI_CLI_SYSTEM_SETTINGS_PATH || sys.gemini });
      break;
    }
    case "copilot-cli": {
      const cfg = abs(env.COPILOT_HOME, P.join(home, ".copilot"));
      add("user", { file: P.join(cfg, "hooks", "everyhook.json") }, "json", true);
      add("user", { dir: P.join(cfg, "hooks") });
      add("user", { file: P.join(cfg, "settings.json") });
      if (project) {
        add("project", { file: proj(".github", "hooks", "everyhook.json") }, "json", true);
        add("project", { dir: proj(".github", "hooks") });
        add("project", { file: proj(".github", "copilot", "settings.json") });
        add("local", { file: proj(".github", "copilot", "settings.local.json") });
        add("project", { file: proj(".claude", "settings.json"), crossTool: "claude-code" });
        add("local", { file: proj(".claude", "settings.local.json"), crossTool: "claude-code" });
      }
      add("managed", { dir: sys.copilot });
      break;
    }
    case "cursor": {
      add("user", { file: P.join(home, ".cursor", "hooks.json") }, "json", true);
      if (project) add("project", { file: proj(".cursor", "hooks.json") }, "json", true);
      add("managed", { file: sys.cursor });
      break;
    }
    default:
      throw new Error(`unknown agent ${agent}`);
  }
  return out;
}

/** The one file `install` writes for an agent and a scope. */
export function installFile(agent, scope, opts) {
  const loc = locations(agent, opts).find((l) => l.install && l.scope === scope && l.file);
  return loc ? loc.file : null;
}
