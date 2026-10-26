import path from "node:path";

/** Claude names a project's folder after its working directory with every `/` and `.` turned into `-`. */
export const claudeProjectKey = (cwd: string): string => cwd.replace(/[/.]/g, "-");

/** Where Claude keeps the memory of an agent working in `cwd`: `<home>/.claude/projects/<key>/memory`. */
export const memoryDir = (cwd: string, home: string): string => path.join(home, ".claude", "projects", claudeProjectKey(cwd), "memory");

/**
 * Claude permission rules for the Assistant's memory, for a session that runs in bypassPermissions mode.
 *
 * Path rules are `Edit(...)` and `Read(...)`: an `Edit` rule covers every built-in tool that changes files (Write,
 * Edit, NotebookEdit, MultiEdit), and a path rule written for `Write` is never matched. `//` anchors at the filesystem
 * root, `~/` at the home directory, `./` at the working directory.
 *
 * Deny rules block in every mode, including bypassPermissions (the Agent SDK documents that `disallowedTools`
 * entries are deny rules that bypass does not skip); allow rules have no effect in bypass and nothing prompts. So
 * the protection is the deny list: the working directory, the credential and configuration places, the shell
 * start-up files and the system directories. Writes anywhere else are NOT stopped. A bare `Write` or `Edit` deny
 * would remove the tools, deny beats allow, and `!` carve-outs cannot reach an anchored rule, so no deny may cover
 * the memory folder (the allow below is what a non-bypass session would need).
 */
export function memoryRules(cwd: string, home: string): { allow: string[]; deny: string[]; dir: string } {
  const dir = memoryDir(cwd, home);
  const anchored = `/${dir}/**`; // "/" + "/abs/path" gives the `//` prefix
  return {
    dir,
    allow: [`Edit(${anchored})`, `Read(${anchored})`],
    deny: [...EDIT_DENIED, ...READ_DENIED.map((p) => `Read(${p})`)],
  };
}

const HOME_DIRS = ["~/.paseo", "~/src", "~/.ssh", "~/.aws", "~/.kube", "~/.config"];
const HOME_FILES = ["~/.gitconfig", "~/.bashrc", "~/.profile", "~/.zshrc", "~/.bash_profile", "~/.claude/settings.json", "~/.claude/settings.local.json", "~/.claude/CLAUDE.md"];
const SYSTEM_DIRS = ["//etc", "//usr", "//opt", "//var", "//root"];

/** Everything the Assistant may not write: its working directory, credentials and config, shell start-up files, system folders. */
const EDIT_DENIED = ["Edit(./**)", ...[...HOME_DIRS, ...SYSTEM_DIRS].map((d) => `Edit(${d}/**)`), ...HOME_FILES.map((f) => `Edit(${f})`)];

/** Places it may not read either: credentials and configuration. */
const READ_DENIED = ["~/.ssh/**", "~/.aws/**", "~/.kube/**", "~/.config/**", "~/.gitconfig", "//root/**"];

/**
 * Whether one of these rules (the forms used above: `Tool(//abs/**)`, `Tool(~/dir/**)`, `Tool(~/file)`, `Tool(//abs)`)
 * covers an absolute path, for tests and diagnostics. Not a general matcher.
 */
export function ruleCovers(rule: string, tool: "Edit" | "Read", absPath: string, home: string, cwd: string): boolean {
  const m = new RegExp(`^${tool}\\((.*)\\)$`).exec(rule);
  if (!m) return false;
  let pattern = m[1];
  if (pattern.startsWith("//")) pattern = pattern.slice(1);
  else if (pattern.startsWith("~/")) pattern = path.join(home, pattern.slice(2));
  else if (pattern.startsWith("./")) pattern = path.join(cwd, pattern.slice(2));
  if (pattern.endsWith("/**")) {
    const root = pattern.slice(0, -3);
    return absPath === root || absPath.startsWith(`${root}/`);
  }
  return absPath === pattern;
}
