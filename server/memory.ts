import path from "node:path";

/** Claude names a project's folder after its working directory with every `/` and `.` turned into `-`. */
export const claudeProjectKey = (cwd: string): string => cwd.replace(/[/.]/g, "-");

/** Where Claude keeps the memory of an agent working in `cwd`: `<home>/.claude/projects/<key>/memory`. */
export const memoryDir = (cwd: string, home: string): string => path.join(home, ".claude", "projects", claudeProjectKey(cwd), "memory");

/**
 * Claude permission rules for the Assistant's memory. Path rules are `Edit(...)` and `Read(...)`: an `Edit` rule
 * covers every built-in tool that changes files (Write, Edit, NotebookEdit, MultiEdit), and a path rule written
 * for `Write` is never matched. `//` anchors at the filesystem root. A bare `Write` or `Edit` deny would remove
 * the tool altogether, and deny beats allow, so it cannot be combined with an allowed folder: everything else is
 * left to the permission prompt (the mode is "Always Ask", the Assistant cannot answer prompts) and the places
 * that matter most are denied outright. `!` carve-outs cannot reach an anchored rule, so no deny covers the memory.
 */
export function memoryRules(cwd: string, home: string): { allow: string[]; deny: string[]; dir: string } {
  const dir = memoryDir(cwd, home);
  const anchored = `/${dir}/**`; // "/" + "/abs/path" gives the `//` prefix
  return {
    dir,
    allow: [`Edit(${anchored})`, `Read(${anchored})`],
    deny: ["Edit(./**)", "Edit(~/.paseo/**)", "Edit(~/src/**)", "Edit(~/.ssh/**)", "Edit(~/.claude/settings.json)", "Edit(~/.claude/settings.local.json)", "Edit(~/.claude/CLAUDE.md)"],
  };
}
